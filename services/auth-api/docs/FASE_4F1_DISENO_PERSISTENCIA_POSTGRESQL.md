# SITECORP AUTH API — ARQUITECTURA DE PERSISTENCIA POSTGRESQL Y SEGURIDAD TRANSACCIONAL (FASE 4F.1.1)

**Estado:** Diseño Técnico Auditado y Endurecido (Sin ejecución ni conexión a base de datos)  
**Rama:** `inicio-de-sesion-en-backend`  
**Esquema objetivo:** `sitecorp_auth`  
**Motor objetivo:** PostgreSQL estándar autogestionado (infraestructura ETECSA)

---

## 1. AUDITORÍA DEL DISEÑO Y HALLAZGOS CORREGIDOS (FASE 4F.1 $\rightarrow$ 4F.1.1)

Antes de escribir una sola línea de código de adaptadores SQL, se realizó una auditoría crítica del diseño inicial de la Fase 4F.1, identificando y corrigiendo los siguientes defectos arquitectónicos:

1. **[CRÍTICO] Falta de propagación de contexto transaccional (`TransactionContext`) entre repositorios:**
   - *Hallazgo:* En los casos de uso actuales (`LoginUseCase`, `ChangePasswordUseCase`, `AdminCreateUserUseCase`, `AdminUpdateStatusUseCase`), cada método de repositorio (`userRepo.update`, `credentialRepo.update`, `sessionRepo.revokeAllUserSessions`, `auditService.recordEvent`) se invocaba de forma independiente sin recibir una referencia a una transacción compartida (`tx`). Si cada repositorio abriera y confirmara su propia conexión del pool, un fallo en el paso 3 dejaría confirmados los pasos 1 y 2.
   - *Corrección:* Se diseña el contrato `ITransactionManager` y `TransactionContext` (o propagación mediante `AsyncLocalStorage` / cliente transaccional explícito) para que todas las escrituras de un caso de uso compartan exactamente la misma conexión física de PostgreSQL (`PoolClient`) bajo un único bloque `BEGIN ... COMMIT / ROLLBACK`.

2. **[ALTA] Condición de carrera entre `RefreshSessionUseCase`, `AdminUpdateStatusUseCase` (Suspensión) y `ChangePasswordUseCase`:**
   - *Hallazgo:* En el diseño inicial de `rotateRefreshTokenAtomic`, se bloqueaba `sessions` y `refresh_tokens`, pero la verificación del estado del usuario (`user.ensureCanAuthenticate`) ocurría **después** de rotar el token y sin haber bloqueado `users`. Si un administrador suspendía al usuario exactamente en paralelo con un refresh, o si el bloqueo `SELECT ... FOR UPDATE OF s, rt` se adquiría sin un orden determinista sobre `users`, podía producirse una emisión de token para un usuario recién suspendido o una carrera en la invalidación de la familia.
   - *Corrección:* Se establece el **Orden Canónico Estricto de Bloqueos** (`users` $\rightarrow$ `user_credentials` $\rightarrow$ `sessions` [ordenado por `id ASC`] $\rightarrow$ `refresh_tokens` [ordenado por `id ASC`]). Además, en `rotateRefreshTokenAtomic`, el `SELECT ... FOR UPDATE` inicial incluye `sitecorp_auth.users u` (`FOR UPDATE OF u, s, rt`), verificando que `u.status` sea válido **dentro** de la misma ventana atómica antes de emitir el nuevo refresh token.

3. **[ALTA] Prevención de falsificación de `request.jwt.claim.sub` y aislamiento por transacción (`SET LOCAL` vs `SET`):**
   - *Hallazgo:* Si se utilizara `SET request.jwt.claim.sub = ...` a nivel de sesión en un pool de conexiones compartidas (`pg.Pool`), el identificador de usuario quedaría contaminado para la siguiente petición HTTP que reutilice esa conexión del pool, o un cliente que tuviera acceso directo a PostgREST sin validación previa podría falsificar cabeceras.
   - *Corrección:* Se diseña el protocolo obligatorio de **Contexto Autenticado por Transacción**:
     1. El servidor Node.js verifica criptográficamente la firma y expiración del JWT antes de tocar el pool de base de datos.
     2. PostgreSQL no es accesible desde Internet ni directamente desde el navegador; solo acepta conexiones desde el backend autenticado.
     3. Toda consulta que dependa de RLS/RPC ejecuta `SELECT set_config('request.jwt.claim.sub', $1, true)` (donde el tercer parámetro `is_local = true` equivale a `SET LOCAL`), garantizando que el contexto desaparezca automáticamente al finalizar la transacción (`COMMIT` o `ROLLBACK`) y jamás contamine el pool de conexiones.

4. **[MEDIA] Endurecimiento de restricciones de integridad e índices en `sitecorp_auth`:**
   - *Hallazgos y correcciones en SQL:*
     - Se cambió `ON DELETE CASCADE` a `ON DELETE RESTRICT` en las claves foráneas desde `user_credentials` y `sessions` hacia `sitecorp_auth.users(id)` para impedir que un `DELETE` físico accidental borre usuarios productivos en cascada (la baja de usuarios es estrictamente lógica: `status = 'deleted'`, `deleted_at = NOW()`). Se conserva `ON DELETE CASCADE` únicamente de `refresh_tokens` hacia `sessions` para permitir la purga programada de sesiones expiradas hace más de 30 días.
     - Se añadió el índice parcial `idx_sitecorp_auth_refresh_tokens_replaced_by` sobre `replaced_by_token_id` para evitar *Sequential Scans* al eliminar o actualizar tokens.
     - Se reforzó `chk_refresh_tokens_hash_format` con expresión regular hexadecimal `token_hash ~ '^[0-9a-f]{64}$'`.
     - Se añadieron restricciones de consistencia de revocación (`chk_sessions_revocation_consistency`, `chk_refresh_tokens_revocation_consistency`) y consistencia de cambio de clave (`chk_users_pending_password_consistency`).
     - Se protegió el script de rollback de diseño (`0001_sitecorp_auth_schema.rollback.design.sql`) con una guarda `sitecorp.allow_destructive_rollback`, cláusulas `RESTRICT` (sin `CASCADE`) y terminación `ROLLBACK;` por defecto.

---

## 2. INTEGRIDAD DEL ESQUEMA `sitecorp_auth`

### 2.1 Diagrama Entidad-Relación y Políticas de Borrado

```text
+--------------------------------------------------+
|               sitecorp_auth.users                |
|--------------------------------------------------|
| PK  id (UUID)                                    |
|     email (VARCHAR(255))                         |
| UQ  email_normalized (VARCHAR(255))              |
|     status ('active'|'suspended'|                |
|             'pending_password_change'|'deleted') |
|     must_change_password (BOOLEAN)               |
|     failed_login_attempts (INTEGER >= 0)         |
|     locked_until (TIMESTAMPTZ NULL)              |
|     created_at, updated_at, deleted_at           |
+------------------------+-------------------------+
                         |
       +-----------------+-----------------+-------------------------------+
       | 1:1 (ON DELETE RESTRICT)          | 1:N (ON DELETE RESTRICT)      | 1:N (ON DELETE SET NULL)
       v                                   v                               v
+------------------------------+ +------------------------------+ +----------------------------------+
| sitecorp_auth.               | | sitecorp_auth.sessions       | | sitecorp_auth.                   |
| user_credentials             | |------------------------------| | security_audit_events            |
|------------------------------| | PK  id (VARCHAR(64))         | |----------------------------------|
| PK  id (VARCHAR(64))         | | FK  user_id (UUID)           | | PK  id (UUID)                    |
| FK  user_id (UUID) [UNIQUE]  | |     ip_address, user_agent   | | FK  user_id (UUID NULL)          |
|     algorithm ('argon2id'    | |     is_revoked (BOOLEAN)     | |     event_type (VARCHAR(64))     |
|                |'bcrypt')    | |     revoked_at, revoke_reason| |     ip_address, user_agent       |
|     password_hash (TEXT)     | |     created_at, expires_at   | |     metadata (JSONB object)      |
|     version (INTEGER >= 1)   | +--------------+---------------+ |     occurred_at (TIMESTAMPTZ)   |
|     created_at, updated_at   |                |                 +----------------------------------+
+------------------------------+                | 1:N (ON DELETE CASCADE)
                                                v
                                 +-----------------------------------+
                                 | sitecorp_auth.refresh_tokens      |
                                 |-----------------------------------|
                                 | PK  id (VARCHAR(64))              |
                                 | FK  session_id (VARCHAR(64))      |
                                 | UQ  token_hash (CHAR(64) hex)     |
                                 | IX  family_id (VARCHAR(64))       |
                                 |     is_revoked (BOOLEAN)          |
                                 |     revoked_at (TIMESTAMPTZ NULL) |
                                 | FK  replaced_by_token_id (SELF)   |
                                 |     created_at, expires_at        |
                                 +-----------------------------------+
```

### 2.2Invariantes Garantizadas a Nivel de Motor SQL (`CHECK` & `UNIQUE`)

1. **Unicidad Canónica de Correos (`users`):**
   - `chk_users_email_normalized`: Exige que `email_normalized = lower(btrim(email))` y longitud entre 3 y 255 caracteres.
   - `uq_sitecorp_auth_users_email_normalized`: Índice `UNIQUE` B-Tree sobre `email_normalized`. Impide cualquier condición de carrera en creación concurrente de usuarios con variaciones de mayúsculas o espacios.
2. **Coherencia de Estados de Usuario (`users`):**
   - `chk_users_deleted_consistency`: `(status = 'deleted' AND deleted_at IS NOT NULL) OR (status <> 'deleted' AND deleted_at IS NULL)`.
   - `chk_users_pending_password_consistency`: `status <> 'pending_password_change' OR must_change_password = TRUE`.
3. **Coherencia de Revocación (`sessions` y `refresh_tokens`):**
   - `chk_sessions_revocation_consistency`: `(is_revoked = TRUE AND revoked_at IS NOT NULL) OR (is_revoked = FALSE AND revoked_at IS NULL AND revoke_reason IS NULL)`.
   - `chk_refresh_tokens_revocation_consistency`: `(is_revoked = TRUE AND revoked_at IS NOT NULL) OR (is_revoked = FALSE AND revoked_at IS NULL AND replaced_by_token_id IS NULL)`.
   - Esto garantiza que ningún token activo pueda tener `replaced_by_token_id` poblado, y ningún token revocado carezca de marca temporal `revoked_at`.
4. **Formato Estricto de Hash de Refresh Token (`refresh_tokens`):**
   - `chk_refresh_tokens_hash_format`: `token_hash ~ '^[0-9a-f]{64}$'`. Garantiza que jamás se almacene por error un token en claro (que lleva prefijo `sct_`) en la columna `token_hash`.

---

## 3. ATOMICIDAD ENTRE REPOSITORIOS: DISEÑO DEL `TransactionManager`

### 3.1 El Problema de las Confirmaciones Parciales
Si `UserRepository`, `CredentialRepository`, `SessionRepository` y `SecurityAuditService` ejecutan cada `INSERT` o `UPDATE` pidiendo una conexión independiente al pool (`pool.query(...)`), cada llamada hace `AUTOCOMMIT`. Si un caso de uso ejecuta 4 llamadas y la tercera falla (por ejemplo, caída de conexión o violación de restricción), las 2 primeras quedan confirmadas permanentemente, corrompiendo invariantes de seguridad (ej. contraseña cambiada pero sesiones antiguas aún activas, o usuario creado sin fila en `user_credentials`).

### 3.2 Contrato de `ITransactionManager` y Propagación de Transacción

Para mantener los casos de uso limpios y 100% independientes del driver `pg`, se diseña un mecanismo de propagación de contexto transaccional en dos niveles compatibles entre sí:

```typescript
/**
 * Token opaco que representa una transacción activa.
 * En memoria es un objeto vacío/no-op; en PostgreSQL encapsula el `PoolClient` exclusivo
 * en el que ya se ejecutó `BEGIN`.
 */
export interface TransactionContext {
  readonly transactionId: string;
}

export interface ITransactionManager {
  /**
   * Ejecuta el callback `work` dentro de una transacción ACID (BEGIN ... COMMIT/ROLLBACK).
   * Si el callback lanza cualquier excepción, ejecuta ROLLBACK automático y relanza el error.
   * Si ya existe un `TransactionContext` activo (transacción anidada), reutiliza la misma
   * conexión o emplea un SAVEPOINT.
   */
  runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
```

#### Cómo comparten la transacción los repositorios:
En la implementación PostgreSQL (`src/infrastructure/postgres/`), el `PostgresTransactionManager` utiliza `AsyncLocalStorage<PgTransactionClient>` de `node:async_hooks` (además de aceptar `tx?: TransactionContext` opcional):
1. Cuando un caso de uso invoca `await this.transactionManager.runInTransaction(async (tx) => { ... })`:
   - `PostgresTransactionManager` adquiere un `client = await pool.connect()`, ejecuta `await client.query('BEGIN')` y almacena `client` en el `AsyncLocalStorage` del contexto asíncrono actual.
2. Todas las llamadas internas dentro del callback (`this.userRepo.update(user)`, `this.credentialRepo.update(cred)`, `this.sessionRepo.revokeAllUserSessions(user.id)`, `this.auditService.recordEvent(event)`) consultan `this.db.getExecutor()`:
   - Si hay un `client` transaccional activo en el contexto asíncrono, ejecutan sus sentencias SQL sobre **ese mismo `PoolClient`**.
   - Si el callback finaliza sin errores, `PostgresTransactionManager` ejecuta `await client.query('COMMIT')` y libera el cliente al pool (`client.release()`).
   - Si cualquier repositorio o regla de negocio lanza un error, `PostgresTransactionManager` captura la excepción, ejecuta `await client.query('ROLLBACK')`, libera el cliente y propaga el error.

### 3.3 Coordinación de las 4 Operaciones Compuestas Multi-Repositorio

1. **Cambio de contraseña, actualización de usuario y revocación (`ChangePasswordUseCase`):**
   - **Fuera de la transacción (CPU-bound):** Verificación Argon2id de `currentPassword`, verificación de no reutilización y cálculo del nuevo hash Argon2id (`newHash`).
   - **Dentro de `runInTransaction`:**
     1. `SELECT ... FROM sitecorp_auth.users WHERE id = $1 FOR UPDATE` (revalida que el usuario siga activo).
     2. `SELECT ... FROM sitecorp_auth.user_credentials WHERE user_id = $1 FOR UPDATE` (verifica que `version` no haya cambiado concurrentemente por otro cambio de clave en paralelo; si cambió, aborta con `ROLLBACK`).
     3. `credentialRepo.update(...)` $\rightarrow$ `UPDATE sitecorp_auth.user_credentials SET password_hash = $2, version = version + 1, updated_at = $3 WHERE user_id = $1`.
     4. `userRepo.update(...)` $\rightarrow$ `UPDATE sitecorp_auth.users SET must_change_password = FALSE, status = 'active', failed_login_attempts = 0, locked_until = NULL, updated_at = $3 WHERE id = $1`.
     5. `sessionRepo.revokeAllUserSessions(user.id)` $\rightarrow$ Bloquea las sesiones activas en `ORDER BY id ASC`, actualiza `sessions.is_revoked = TRUE` y actualiza `refresh_tokens.is_revoked = TRUE`.
     6. `auditService.recordEvent(...)` $\rightarrow$ `INSERT INTO sitecorp_auth.security_audit_events (...)`.
   - **Garantía:** O se aplican los 6 pasos conjuntamente (`COMMIT`), o no se aplica ninguno (`ROLLBACK`).

2. **Login exitoso y creación de sesión (`LoginUseCase`):**
   - **Fuera de la transacción:** Verificación Argon2id de la contraseña.
   - **Dentro de `runInTransaction`:**
     1. Bloquea la fila del usuario (`SELECT ... FROM sitecorp_auth.users WHERE id = $1 FOR UPDATE`) y verifica que `status` no haya pasado a `'suspended'` o `'deleted'` ni `locked_until > now` durante los ~100 ms que duró Argon2id.
     2. `userRepo.update(user)` $\rightarrow$ Reinicia `failed_login_attempts = 0, locked_until = NULL`.
     3. `sessionRepo.createSession(session)` $\rightarrow$ Inserta la nueva sesión en `sitecorp_auth.sessions`.
     4. `sessionRepo.createRefreshToken(refreshToken)` $\rightarrow$ Inserta el refresh token inicial en `sitecorp_auth.refresh_tokens`.
     5. `auditService.recordEvent(...)` $\rightarrow$ Inserta `LOGIN_SUCCESS`.

3. **Suspensión / Baja Lógica y revocación de sesiones (`AdminUpdateStatusUseCase`):**
   - **Dentro de `runInTransaction`:**
     1. Bloquea la fila del usuario (`SELECT ... FROM sitecorp_auth.users WHERE id = $1 FOR UPDATE`).
     2. `userRepo.update(user)` $\rightarrow$ Actualiza `status = 'suspended'` (o `'deleted'`, `deleted_at = $now`).
     3. `sessionRepo.revokeAllUserSessions(user.id)` $\rightarrow$ Bloquea y revoca todas las sesiones y refresh tokens del usuario.
     4. `auditService.recordEvent(...)` $\rightarrow$ Inserta `USER_SUSPENDED` (o `USER_DELETED`).

4. **Creación administrativa de usuario y credencial (`AdminCreateUserUseCase`):**
   - **Fuera de la transacción:** Generación de contraseña inicial y cálculo de su hash Argon2id.
   - **Dentro de `runInTransaction`:**
     1. `userRepo.save(user)` $\rightarrow$ `INSERT INTO sitecorp_auth.users (...)`. Si `email_normalized` colisiona, PostgreSQL lanza `23505` y toda la transacción hace `ROLLBACK`.
     2. `credentialRepo.save(credential)` $\rightarrow$ `INSERT INTO sitecorp_auth.user_credentials (...)`.
     3. `auditService.recordEvent(...)` $\rightarrow$ `INSERT INTO sitecorp_auth.security_audit_events (...)`.
   - **Garantía:** Es imposible que exista un usuario en `sitecorp_auth.users` sin su correspondiente fila en `sitecorp_auth.user_credentials`.

---

## 4. ROTACIÓN DE REFRESH TOKENS, ORDEN DE BLOQUEOS Y PREVENCIÓN DE DEADLOCKS

### 4.1 Por qué `SELECT ... FOR UPDATE` sobre el token NO basta por sí solo
Si una transacción de rotación únicamente hiciera `SELECT * FROM sitecorp_auth.refresh_tokens WHERE token_hash = $1 FOR UPDATE`:
1. **Tokens inexistentes:** Si el hash no existe, `SELECT ... FOR UPDATE` devuelve 0 filas y no adquiere ningún bloqueo.
2. **Operaciones a nivel de familia (`revokeTokenFamily`):** Mientras la petición A bloquea el Token 1 (`rt_1`), otra operación concurrente (por ejemplo, reutilización de un Token 0 anterior `rt_0` de la misma familia, o un `logout` de la sesión) podría bloquear `rt_0` e intentar hacer `UPDATE sitecorp_auth.refresh_tokens SET is_revoked = TRUE WHERE family_id = $fam`. Si dos transacciones actualizan múltiples filas de la misma familia en distinto orden, se produciría un **deadlock** (`SQLSTATE 40P01`) o una condición de carrera donde se inserta un token hijo nuevo justo después de que `revokeTokenFamily` actualizó los tokens existentes.
3. **Carrera con Suspensión de Usuario:** Si `rotateRefreshTokenAtomic` no bloquea o coordina con la fila de `users` y `sessions`, un administrador podría suspender al usuario en otra conexión mientras el refresh está en curso.

### 4.2 Jerarquía Canónica Global de Bloqueos (Libre de Deadlocks)

Toda operación en `sitecorp_auth` que adquiera bloqueos exclusivos (`FOR UPDATE` o `UPDATE`) sobre más de una entidad **debe** adquirirlos estrictamente de arriba hacia abajo en este grafo y, dentro de una misma tabla cuando se bloquean múltiples filas, ordenadas por `id ASC`:

```text
Nivel 1: sitecorp_auth.users            (bloqueo por user.id)
   │
   ▼
Nivel 2: sitecorp_auth.user_credentials (bloqueo por user_id)
   │
   ▼
Nivel 3: sitecorp_auth.sessions         (raíz/mutex de cada sesión y familia de tokens; ORDER BY id ASC)
   │
   ▼
Nivel 4: sitecorp_auth.refresh_tokens   (tokens de la sesión/familia; ORDER BY id ASC)
   │
   ▼
Nivel 5: sitecorp_auth.security_audit_events (solo INSERT al final, sin bloqueo de lectura)
```

*Demostración de ausencia de ciclo (Deadlock-Free):*
- **Suspensión / Cambio de Clave:** Bloquea Nivel 1 (`users`) $\rightarrow$ Nivel 2 (`user_credentials`) $\rightarrow$ Nivel 3 (`sessions` en `ORDER BY id ASC`) $\rightarrow$ Nivel 4 (`refresh_tokens` en `ORDER BY id ASC`).
- **Logout por Sesión / Refresh Token:** Resuelve primero el `user_id` y `session_id` (lectura sin bloqueo), y luego adquiere bloqueos en el mismo orden: Nivel 1 (`users`, `FOR SHARE` o `FOR UPDATE`) $\rightarrow$ Nivel 3 (`sessions`) $\rightarrow$ Nivel 4 (`refresh_tokens` en `ORDER BY id ASC`).
- **Rotación de Refresh Token (`rotateRefreshTokenAtomic`):**
  1. **Paso 0 (Búsqueda rápida de identidad sin bloqueo):**
     ```sql
     SELECT rt.id AS token_id, rt.session_id, rt.family_id, s.user_id
     FROM sitecorp_auth.refresh_tokens rt
     INNER JOIN sitecorp_auth.sessions s ON s.id = rt.session_id
     WHERE rt.token_hash = $1;
     ```
     - Si devuelve 0 filas: el token no existe (`NOT_FOUND`). No se abre transacción de escritura ni se adquieren bloqueos innecesarios.
  2. **Paso 1 (Adquisición de bloqueos en Orden Canónico Nivel 1 $\rightarrow$ Nivel 3 $\rightarrow$ Nivel 4):**
     Dentro de `BEGIN`:
     ```sql
     -- Nivel 1: Bloquear usuario para serializar contra suspensión/baja o cambio de clave concurrente
     SELECT id, status, must_change_password, locked_until, deleted_at
     FROM sitecorp_auth.users
     WHERE id = $1
     FOR UPDATE;

     -- Nivel 3: Bloquear la sesión (actúa como mutex de toda la familia de tokens de esa sesión)
     SELECT id, user_id, is_revoked, expires_at
     FROM sitecorp_auth.sessions
     WHERE id = $2
     FOR UPDATE;

     -- Nivel 4: Bloquear todos los tokens de la familia en orden determinista (id ASC)
     SELECT id, session_id, token_hash, family_id, is_revoked, replaced_by_token_id, created_at, expires_at
     FROM sitecorp_auth.refresh_tokens
     WHERE family_id = $3
     ORDER BY id ASC
     FOR UPDATE;
     ```
  3. **Paso 2 (Revalidación obligatoria de Usuario, Sesión, Familia y Token DESPUÉS de adquirir los bloqueos):**
     Una vez adquiridos los bloqueos `FOR UPDATE` en los niveles 1, 3 y 4 (ya que el estado pudo cambiar entre la pre-búsqueda del Paso 0 y el bloqueo efectivo del Paso 1), el repositorio revalida estrictamente dentro de la transacción:
     - **Usuario (`users`):** Verificar que la fila exista, `status NOT IN ('suspended', 'deleted')`, `deleted_at IS NULL` y `(locked_until IS NULL OR locked_until <= $now)`. Si el usuario fue suspendido, eliminado o bloqueado concurrentemente, se revoca la sesión y se aborta la emisión de nuevos tokens.
     - **Sesión (`sessions`):** Verificar que la fila exista, `is_revoked = FALSE` y `expires_at > $now`.
     - **Familia y Token (`refresh_tokens`):** Localizar el token objetivo dentro del conjunto bloqueado de `family_id`. Si no se encuentra (`NOT_FOUND`), abortar. Si `token.is_revoked = TRUE`, activar inmediatamente el protocolo de detección de reuso (`ALREADY_REVOKED`). Si `token.expires_at <= $now`, rechazar por expiración (`EXPIRED`).
  *Por qué este diseño elimina cualquier carrera en la familia:*
  - Al bloquear `users` (Nivel 1), `sessions` (Nivel 3) y los tokens de la `family_id` en `ORDER BY id ASC` (Nivel 4) y revalidar las 4 invariantes **después** de adquirir los bloqueos, cualquier otra petición concurrente de refresh sobre la misma familia, logout o suspensión administrativa espera en cola en el Nivel 1 o Nivel 3 sin posibilidad de inversión de orden de bloqueo (cero deadlocks) ni lecturas obsoletas (*time-of-check to time-of-use*).

### 4.3 Persistencia Irreversible de la Revocación ante Reuso (`ALREADY_REVOKED`)

Cuando en el Paso 2 se comprueba el estado del token objetivo (ya bloqueado):
- **Caso 1 (`token.is_revoked = TRUE` — Reutilización Detectada):**
  1. Se ejecuta `UPDATE sitecorp_auth.refresh_tokens SET is_revoked = TRUE, revoked_at = $now WHERE family_id = $famId AND is_revoked = FALSE`.
  2. Se ejecuta `UPDATE sitecorp_auth.sessions SET is_revoked = TRUE, revoked_at = $now, revoke_reason = 'TOKEN_REUSE_DETECTED' WHERE id = $sessionId AND is_revoked = FALSE`.
  3. Se ejecuta **`COMMIT` INMEDIATO** de esta transacción en `rotateRefreshTokenAtomic`.
  4. El método retorna `{ success: false, reason: 'ALREADY_REVOKED', familyId, session }` al caso de uso `RefreshSessionUseCase`.
  5. `RefreshSessionUseCase` registra el evento `TOKEN_REUSE_DETECTED` en `security_audit_events` (en su propia inserción confirmada) y finalmente lanza `throw new TokenReuseDetectedError(result.familyId)`.
  *Resultado:* Aunque el caso de uso termina lanzando la excepción de dominio `TokenReuseDetectedError`, **la revocación de toda la familia y de la sesión ya fue confirmada con `COMMIT` en PostgreSQL** y ningún manejador de errores superior puede revertirla.

---

## 5. SEGURIDAD DE RLS, CONTEXTO POR TRANSACCIÓN Y COMPATIBILIDAD FUTURA

> **ADVERTENCIA DE ESTADO (PROPUESTA NO VALIDADA EN PRODUCCIÓN):**  
> El mecanismo de compatibilidad con políticas RLS y funciones RPC descrito en esta sección constituye una **propuesta arquitectónica de diseño** que aún **no ha sido validada contra el esquema real de producción en Supabase Cloud ni en el entorno final de ETECSA**. No se debe crear ninguna función `auth.uid()` ni modificar políticas RLS existentes hasta realizar la auditoría del esquema vivo y las pruebas aisladas de integración.

### 5.1 Verificación de JWT y Prevención de Suplantación de `request.jwt.claim.sub`
En Supabase Cloud, PostgREST expone directamente tablas y funciones RPC al navegador, decodificando el JWT y estableciendo variables GUC (`request.jwt.claim.sub`). En una arquitectura autogestionada en ETECSA:
1. **Aislamiento de Red:** El puerto `5432` de PostgreSQL jamás se expone al exterior ni al navegador; solo el servicio backend de SiteCorp (en la red interna / loopback del VPS) puede abrir conexiones SQL.
2. **Prohibición de confiar en cabeceras del cliente:** El backend nunca copia parámetros enviados por el usuario hacia variables de sesión de PostgreSQL. Únicamente el middleware de autenticación del backend, tras verificar criptográficamente la firma del JWT (`verifyAccessToken`), su vigencia (`exp`), el emisor (`iss = 'sitecorp-auth-api'`) y que el rol no sea `pending_password_change` (salvo en el endpoint de cambio de clave), extrae el `sub` (UUID validado).
3. **Inyección Segura por Transacción (`set_config(..., true)`):**
   Cuando el backend de SiteCorp ejecute en el futuro consultas o funciones RPC de negocio que dependan de `auth.uid()` o políticas RLS, lo hará obligatoriamente dentro de una transacción (`BEGIN ... COMMIT`) estableciendo el contexto con ámbito **estrictamente local a la transacción**:
   ```sql
   BEGIN;
   -- El tercer argumento `true` equivale a SET LOCAL: el valor se destruye automáticamente
   -- en el COMMIT o ROLLBACK y NUNCA permanece en la conexión devuelta al pg.Pool.
   SELECT
     set_config('request.jwt.claim.sub', $1::text, true),
     set_config('request.jwt.claim.role', $2::text, true),
     set_config('request.jwt.claims', $3::text, true);

   -- Ejecución de la consulta o RPC de negocio...
   COMMIT;
   ```
4. **Separación de roles de base de datos:**
   - El servicio de autenticación (`services/auth-api`) operará con un rol de base de datos dedicado (`sitecorp_auth_service`) con permisos exclusivos sobre el esquema `sitecorp_auth` (sin `SUPERUSER` y sin `BYPASSRLS` sobre esquemas de negocio).

### 5.2 Dependencias de Supabase que Requieren Migración y Aspectos Pendientes de Verificación en Producción
1. **Dependencias verificadas en el repositorio (`/src` y `/src/db/migrations`):**
   - **Más de 40 invocaciones a `auth.uid()`** en funciones RPC y políticas RLS de vacaciones, contratos, pluriempleo, pagos por categoría docente y control de acceso por entidad.
   - **Claves foráneas hacia `auth.users(id)`** en `public.profiles`, `public.user_security_lifecycle`, `public.entity_level_access` y `public.entity_training_*`.
   - **5 Edge Functions** (`change-initial-password`, `create-sitecorp-user`, `delete-platform-user`, `delete-workspace`, `analyze-document-template` / `generate-document-batch-zip`).
   - **11 repositorios con `supabase.storage`** (`avatars`, `documents`, `worker_documents`, `expedientes`, `document_templates`, `platform_documents`).
2. **Aspectos que NO pueden validarse sin consultar el esquema real en producción (Supabase Cloud):**
   - Existencia de *triggers* manuales creados directamente desde el Dashboard de Supabase sobre `auth.users` (por ejemplo, `on_auth_user_created` hacia `public.profiles`) que no estén volcados en los archivos locales de `src/db/migrations/`.
   - Conteo exacto de usuarios activos en `auth.users`, posibles cuentas huérfanas sin fila en `public.profiles` o correos con formatos no normalizados.
   - Tamaño total en gigabytes de los buckets de Supabase Storage para dimensionar el disco del VPS ETECSA.

---

## 6. ESTRATEGIA DE MIGRACIONES VERSIONADAS, CONCURRENCIA Y RECUPERACIÓN

### 6.1 Ejecución Versionada y Verificación de Checksums
1. **Nomenclatura:** Cada migración consta de un archivo de avance (`NNNN_<nombre>.sql`) y su archivo de reversión (`NNNN_<nombre>.rollback.sql`).
2. **Cálculo de Checksum:** Antes de aplicar o validar migraciones, el ejecutor calcula el hash `SHA-256` del contenido normalizado (LF) de cada archivo `.sql`.
3. **Verificación de Integridad Histórica:** Para toda versión ya registrada con `status = 'applied'` en `sitecorp_auth.schema_migrations`, el ejecutor compara el `checksum_sha256` almacenado con el archivo en disco. Si difieren, aborta inmediatamente el arranque con un error fatal de integridad (`MIGRATION_CHECKSUM_MISMATCH`).

### 6.2 Prevención de Ejecuciones Concurrentes (`pg_try_advisory_lock`)
Si en el despliegue se inician 2 o más procesos del contenedor/servicio simultáneamente, ambos intentarían ejecutar las migraciones pendientes a la vez.
- El ejecutor de migraciones adquiere un bloqueo consultivo de nivel de sesión en PostgreSQL antes de leer `schema_migrations`:
  ```sql
  SELECT pg_try_advisory_lock(849201746201947201); -- ID numérico fijo reservado para sitecorp_auth_migrations
  ```
- Si devuelve `false`, otro proceso ya está aplicando migraciones; el proceso secundario espera con `pg_advisory_lock` (con `lock_timeout = '30s'`) y, al liberarse, re-verifica que todas las versiones ya fueron aplicadas. Al terminar, siempre ejecuta `SELECT pg_advisory_unlock(...)`.

### 6.3 Transacciones, Manejo de Migraciones Fallidas y Recuperación Comprobada
1. **Atomicidad DDL en PostgreSQL:** A diferencia de otros motores, PostgreSQL soporta DDL transaccional (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` dentro de `BEGIN ... COMMIT`).
2. **Comportamiento ante Fallo:**
   - Toda migración se ejecuta dentro de un bloque `BEGIN ... COMMIT`.
   - Si cualquier sentencia falla, PostgreSQL ejecuta `ROLLBACK` automático de toda la migración, dejando el esquema exactamente en la versión anterior sin tablas a medio crear (*migración parcialmente fallida evitada por diseño*).
   - Por ello, se prohíbe usar `CREATE INDEX CONCURRENTLY` dentro de migraciones estándar (ya que `CONCURRENTLY` no puede correr dentro de un bloque transaccional y puede dejar índices `INVALID` ante un corte).
3. **Copias de Seguridad, Autorización Explícita y Estrategia de Recuperación Comprobada (Backup & Restore):**
   - **Antes de aplicar cualquier migración o rollback en producción (ETECSA):** Ejecución obligatoria de `pg_dump --format=custom --schema=sitecorp_auth --file=backup_sitecorp_auth_<timestamp>.dump` y verificación de restauración del archivo `.dump` (`pg_restore --list`) para garantizar una estrategia de recuperación comprobada antes de tocar datos reales.
   - **Entorno de Pruebas vs. Producción:**
     - En entorno de pruebas/CI: Se ejecuta el ciclo completo *Up $\rightarrow$ Verificación de esquema $\rightarrow$ Down (con `SET LOCAL sitecorp.allow_destructive_rollback = 'true'`) $\rightarrow$ Up* sobre una instancia efímera.
     - En producción: Cualquier rollback destructivo está bloqueado por defecto (`ROLLBACK;` final y guarda `sitecorp.allow_destructive_rollback`) y requiere **autorización humana explícita**, ventana de mantenimiento y copia de seguridad previamente verificada.

---

## 7. PLAN DETALLADO PARA LA FASE 4F.2 (IMPLEMENTACIÓN DE ADAPTADORES POSTGRESQL)

Con el diseño auditado y endurecido, la **Fase 4F.2** implementará dentro de `services/auth-api/`:
1. `src/interfaces/transaction.interface.ts`: Contratos `TransactionContext`, `ITransactionManager` e `IDatabaseClient`.
2. `src/infrastructure/in-memory/in-memory-transaction.manager.ts`: Implementación en memoria (con snapshot/rollback real de los Maps en memoria ante excepciones) para mantener las pruebas unitarias ultrarrápidas.
3. `src/infrastructure/postgres/`:
   - `postgres-transaction.manager.ts` (basado en `AsyncLocalStorage` y `BEGIN ... COMMIT/ROLLBACK`).
   - `postgres-user.repository.ts`, `postgres-credential.repository.ts`, `postgres-session.repository.ts` (con el orden canónico de bloqueos Nivel 1 $\rightarrow$ Nivel 3 $\rightarrow$ Nivel 4 y `COMMIT` explícito en detección de reuso) y `postgres-security-audit.service.ts`.
4. Integración de `ITransactionManager` en `LoginUseCase`, `ChangePasswordUseCase`, `AdminCreateUserUseCase` y `AdminUpdateStatusUseCase`.
5. Pruebas automatizadas de atomicidad, rollback ante fallos forzados en pasos intermedios y concurrencia de rotación de refresh tokens.
