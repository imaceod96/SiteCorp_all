# SITECORP — FASE 4G.2A: PLAN DE PRUEBAS HTTP Y CRITERIOS DE ACEPTACIÓN

- **Servicio**: `@sitecorp/auth-api` (`services/auth-api/`)
- **Rama**: `inicio-de-sesion-en-backend`
- **Commit Base**: `50b567f8804b7e0e61243939a49593b65617398d`
- **Estado**: Plan de Pruebas y Criterios de Aceptación Auditados y Cerrados (Fase 4G.2A.1)

---

## 1. ESTRATEGIA Y NIVELES DE PRUEBA

Para garantizar que la capa HTTP de `services/auth-api` se verifique con **persistencia PostgreSQL real y criptografía real** sin depender de servicios externos ni afectar el frontend de SiteCorp, la suite de pruebas de la Fase 4G.2B se estructura en tres niveles complementarios:

### Nivel 1: Pruebas de Integración HTTP Inyectadas (`fastify.inject()` + `PGlite` + Criptografía Real)
- **Ubicación:** `services/auth-api/tests/http/*.http.spec.ts`
- **Infraestructura real utilizada en cada test:**
  - Instancia aislada de PostgreSQL en memoria (`@electric-sql/pglite`) con la migración `0001_sitecorp_auth_schema.design.sql` aplicada.
  - `PostgresTransactionManager` real y todos los repositorios PostgreSQL reales (`PostgresUserRepository`, `PostgresCredentialRepository`, `PostgresSessionRepository`, `PostgresSecurityAuditService`).
  - `Argon2idPasswordHasher` real (con parámetros auditados `19 MiB, t=2, p=1`).
  - `JoseTokenService` real con par de claves `Ed25519` efímero generado al inicio de la suite (`generateEphemeralEd25519KeyPair`) y `requireSessionId: true`.
  - `CsrfTokenService` real (HMAC-SHA256 vinculado a `sid`), `Argon2ConcurrencyGate` real y `InMemoryRateLimiter` real.
- **Ventaja:** Ejecuta todo el pipeline de Fastify (routing, `bodyLimit`, JSON Schema Ajv con `additionalProperties: false`, CORS, CSRF firmado, cookies `sitecorp_rt` y `__Host-sitecorp_csrf`, hooks de autenticación de 7 pasos, casos de uso, transacciones SQL y serialización de respuesta) sin abrir puertos TCP del sistema operativo.

### Nivel 2: Pruebas Unitarias Focalizadas de Seguridad HTTP y Concurrencia
- **Ubicación:** `services/auth-api/tests/http/unit/*.spec.ts`
- **Alcance:**
  - Pruebas deterministas de saturación de `Argon2ConcurrencyGate` (verificando concurrencia máxima `maxConcurrent`, orden FIFO de `maxQueueSize`, vencimiento de `acquireTimeoutMs` y respuesta `503 AUTH_SERVER_BUSY` con `Retry-After: 5`).
  - Pruebas de `InMemoryRateLimiter` (ventana deslizante, expiración, cota máxima de memoria `maxEntries = 10_000` con desalojo LRU contra IP spoofing, cabeceras `Retry-After`).
  - Pruebas criptográficas de `CsrfTokenService` (generación HMAC-SHA256 vinculada a `sid`, rechazo ante alteración de un solo bit, rechazo si se presenta con el `sid` de otra sesión, comparación en tiempo constante `timingSafeEqual`).
  - Pruebas del mapeador `errorHandler` garantizando que ningún `DatabaseError` o error inesperado filtre detalles SQL, stack traces o secretos.

### Nivel 3: Pruebas sobre PostgreSQL Externo / Multi-Proceso (Fase de Despliegue VPS)
- **Alcance:**
  - Concurrencia real de conexiones TCP simultáneas (`pg.Pool`) ejecutando `SELECT ... FOR UPDATE` en paralelo sobre la misma fila en `POST /api/v1/auth/refresh` y `POST /api/v1/auth/login`.

---

## 2. MATRIZ EXHAUSTIVA DE CASOS DE PRUEBA (FASE 4G.2B)

Cada una de las siguientes 16 categorías obligatorias deberá contar con tests automatizados en `services/auth-api/tests/http/`:

### Categoría 1: Login Válido y Reemplazo de Sesión Previa (`POST /api/v1/auth/login`)
- **HTTP-LOG-01:** Usuario `active` con email (incluyendo mayúsculas/espacios que se normalizan) y contraseña correcta recibe `200 OK`, `accessToken` JWT Ed25519 con `role: "authenticated"`, `scope: "api:full"` y `sid` válido, `csrfToken` firmado en `data.csrfToken`, cookie `sitecorp_rt` (`HttpOnly`, `Path=/api/v1/auth`, `SameSite=Strict`, `Max-Age=1209600`), cookie `__Host-sitecorp_csrf` (`Path=/`, `Secure`, `SameSite=Strict`), y **nunca** recibe `refreshToken` en el cuerpo JSON.
- **HTTP-LOG-02:** Verifica que el evento `LOGIN_SUCCESS` queda registrado en `sitecorp_auth.security_audit_events` con `ipAddress`, `userAgent` y `sessionId`.
- **HTTP-LOG-03 (Sesión previa en navegador):** Si el navegador envía una cookie `sitecorp_rt` de una sesión anterior durante un nuevo `/login` exitoso, la sesión anterior queda revocada en PostgreSQL (`is_revoked = true`) y las cookies se sobrescriben con la nueva sesión.

### Categoría 2: Login Inválido y Bloqueo por Fuerza Bruta
- **HTTP-LOG-04:** Contraseña incorrecta para usuario existente devuelve `401 Unauthorized` (`INVALID_CREDENTIALS`), incrementa atómicamente `failed_login_attempts` en PostgreSQL y no emite cookies.
- **HTTP-LOG-05:** Email inexistente devuelve exactamente el mismo código `401 Unauthorized` (`INVALID_CREDENTIALS`) tras ejecutar `Argon2idPasswordHasher.verify(password, DUMMY_HASH)` contra enumeración por tiempos.
- **HTTP-LOG-06:** Al alcanzar 5 intentos fallidos consecutivos, la cuenta queda bloqueada (`locked_until > now`), se registra `ACCOUNT_LOCKED` en `security_audit_events` y devuelve `423 Locked` (`ACCOUNT_LOCKED`) con `details.lockedUntil`.

### Categoría 3: Login de Usuario Eliminado o Suspendido
- **HTTP-LOG-07:** Usuario con `status = 'suspended'` recibe `403 Forbidden` (`USER_SUSPENDED`), sin crear fila en `sitecorp_auth.sessions` ni emitir cookies.
- **HTTP-LOG-08:** Usuario con `status = 'deleted'` o `deleted_at !== null` recibe `401 Unauthorized` (`INVALID_CREDENTIALS` — anti-enumeración) tras ejecutar `DUMMY_HASH`, registrando `LOGIN_FAILED` (`USER_DELETED_ATTEMPT`) sin crear sesión.

### Categoría 4: Login con Contraseña Temporal (`pending_password_change`) y Confinamiento de Scope
- **HTTP-TMP-01:** Usuario con `status = 'pending_password_change'` / `must_change_password = true` hace login y recibe `200 OK` con `mustChangePassword: true`, un `accessToken` con `role: "pending_password_change"` y `scope: "auth:change_password"`, `csrfToken: null`, **ningún refresh token creado ni enviado**, y si el navegador traía cookies de una sesión anterior, recibe cabeceras `Set-Cookie` con `Max-Age=0` borrando `sitecorp_rt` (`Path=/api/v1/auth`) y `__Host-sitecorp_csrf` (`Path=/`).
- **HTTP-TMP-02:** Si ese usuario intenta invocar `GET /api/v1/auth/me`, `POST /api/v1/auth/admin/users` o `PATCH /api/v1/auth/admin/users/:id/status` con su token `auth:change_password`, el Paso 6 del guard HTTP lo rechaza con **`403 Forbidden` (`PASSWORD_CHANGE_REQUIRED`)**.
- **HTTP-TMP-03:** Ese mismo token sí es aceptado en `POST /api/v1/auth/change-password` y en `POST /api/v1/auth/logout`; tras cambiar la contraseña a una definitiva válida, el usuario pasa a `status = 'active'` y `must_change_password = false`, y todas sus sesiones previas quedan revocadas.

### Categoría 5: Refresh Válido, Expirado y Reutilizado (`POST /api/v1/auth/refresh`)
- **HTTP-REF-01 (Rotación válida):** Petición con cookie `sitecorp_rt` válida, `Origin` permitido y cabecera `X-CSRF-Token` coincidente con `__Host-sitecorp_csrf` (y firma HMAC válida para ese `sid`) devuelve `200 OK`, nuevo `accessToken`, nuevo `csrfToken` firmado y rota `sitecorp_rt` a un nuevo token CSPRNG distinto del anterior manteniendo el mismo `sid`.
- **HTTP-REF-02 (Refresh expirado o sesión expirada):** Devuelve `401 Unauthorized` (`TOKEN_EXPIRED` o `SESSION_INVALID`) y envía cabeceras `Set-Cookie` con `Max-Age=0` y los `Path` exactos (`/api/v1/auth` y `/`) para limpiar las cookies del navegador.
- **HTTP-REF-03 (Detección de robo / reutilización de Refresh Token):** Si se vuelve a enviar el refresh token anterior (`T1`) tras haber sido rotado a `T2`, el servidor detecta `ALREADY_REVOKED`, **confirma (`COMMIT`) la revocación de toda la familia de tokens y de la sesión** en PostgreSQL (`revoke_reason = 'TOKEN_REUSE_DETECTED'`), registra el evento `TOKEN_REUSE_DETECTED`, limpia las cookies (`Max-Age=0`) y devuelve `401 Unauthorized` (`TOKEN_REUSE_DETECTED`). El token `T2` y cualquier `accessToken` de esa sesión dejan de funcionar inmediatamente.

### Categoría 6: Logout (`POST /api/v1/auth/logout`)
- **HTTP-OUT-01:** Petición con `Authorization: Bearer` y/o cookie `sitecorp_rt` (con CSRF válido) marca `is_revoked = true` en `sitecorp_auth.sessions` y `refresh_tokens`, registra `LOGOUT`, devuelve `200 OK` (`{ data: { loggedOut: true } }`) y limpia `sitecorp_rt` (`Path=/api/v1/auth`, `Max-Age=0`) y `__Host-sitecorp_csrf` (`Path=/`, `Max-Age=0`).
- **HTTP-OUT-02:** Petición con `{ "allDevices": true }` y `Authorization: Bearer` válido revoca todas las sesiones del usuario (`revokeAllUserSessions`) y limpia cookies.
- **HTTP-OUT-03:** Petición repetida de logout (idempotencia) limpia cookies y devuelve `200 OK` sin error `500`.

### Categoría 7: Revocación Inmediata de Access Token en Todos los Vectores
- **HTTP-REV-01 (Tras Logout):** Un `accessToken` recién emitido es rechazado inmediatamente con `401 Unauthorized` (`SESSION_INVALID`) en `GET /api/v1/auth/me` tras ejecutar `POST /api/v1/auth/logout`.
- **HTTP-REV-02 (Tras Cambio de Contraseña):** Dos sesiones activas del mismo usuario (`S1` y `S2`) con sus respectivos `accessToken` quedan inmediatamente invalidadas (`401 SESSION_INVALID`) tras ejecutar `POST /api/v1/auth/change-password`.
- **HTTP-REV-03 (Tras Suspensión o Eliminación Administrativa):** Un `accessToken` válido de un usuario es rechazado inmediatamente (`403 USER_SUSPENDED` o `401 SESSION_INVALID`) en `GET /api/v1/auth/me` en cuanto un administrador ejecuta `PATCH /api/v1/auth/admin/users/:id/status` con `status: 'suspended'` o `'deleted'`.
- **HTTP-REV-04 (Tras Reutilización de Refresh Token):** Un `accessToken` activo vinculado a `sid` queda invalidado inmediatamente (`401 SESSION_INVALID`) cuando se detecta reutilización de refresh token en esa sesión.

### Categoría 8: JWT Inválido, Expirado, Algoritmo Incorrecto o `sid` Malicioso
- **HTTP-JWT-01:** JWT firmado con otra clave Ed25519, con `alg: "HS256"` / `"none"`, o con payload manipulado -> `401 Unauthorized` (`TOKEN_INVALID`).
- **HTTP-JWT-02:** JWT con `exp` vencido o `iss` / `aud` incorrectos -> `401 Unauthorized` (`TOKEN_EXPIRED` / `TOKEN_INVALID`).
- **HTTP-JWT-03:** JWT criptográficamente válido cuyo claim `sid` no existe en `sitecorp_auth.sessions` o pertenece a otro `userId` (`session.userId !== claims.sub`) -> `401 Unauthorized` (`SESSION_INVALID` / `TOKEN_INVALID`).

### Categoría 9: Autorización en Tiempo Real en Endpoints Admin (`/api/v1/auth/admin/*`)
- **HTTP-ADM-01:** Usuario autenticado sin permisos en `IOperatorPrincipalResolver` / `IAuthorizationPolicyService` que invoca `POST /api/v1/auth/admin/users` o `PATCH /api/v1/auth/admin/users/:id/status` recibe `403 Forbidden` (`FORBIDDEN`).
- **HTTP-ADM-02 (Revocación inmediata de privilegios administrativos):** Si a un operador con un JWT activo se le retiran sus permisos en el `IOperatorPrincipalResolver` (o pasa a `suspended`), la siguiente llamada a `/api/v1/auth/admin/*` falla en el acto con `403 FORBIDDEN`, demostrando que no se confía ciegamente en claims estáticos del JWT.
- **HTTP-ADM-03 (Anti auto-suspensión / auto-eliminación):** Un administrador que intenta ejecutar `PATCH /api/v1/auth/admin/users/:id/status` con `status: 'suspended'` o `'deleted'` sobre su propio `userId` recibe `403 Forbidden` (`FORBIDDEN`).
- **HTTP-ADM-04 (Rechazo de escalada por parámetros HTTP):** Enviar un campo no permitido como `"role": "super_admin"` o `"isPlatformAdmin": true` en `POST /api/v1/auth/admin/users` es rechazado con `400 Bad Request` (`VALIDATION_ERROR`) por `additionalProperties: false`.

### Categoría 10: Protección CSRF Firmada y Vinculada a Sesión
- **HTTP-CSRF-01:** `POST /api/v1/auth/refresh` o `POST /api/v1/auth/logout` con cookie `sitecorp_rt` pero **sin** cabecera `X-CSRF-Token` -> `403 Forbidden` (`CSRF_INVALID`).
- **HTTP-CSRF-02:** `POST /api/v1/auth/refresh` con `X-CSRF-Token` distinto de la cookie `__Host-sitecorp_csrf` o con firma HMAC manipulada -> `403 Forbidden` (`CSRF_INVALID`).
- **HTTP-CSRF-03 (Cross-Session CSRF Token Swap):** Presentar en la Sesión B un par (`__Host-sitecorp_csrf` + `X-CSRF-Token`) legítimamente firmado pero emitido para la Sesión A (`sid_A !== sid_B`) es rechazado con `403 Forbidden` (`CSRF_INVALID`).
- **HTTP-CSRF-04:** `POST /api/v1/auth/refresh` con `Origin: https://evil.example` o sin `Origin` ni `Referer` -> `403 Forbidden` (`CSRF_INVALID`).

### Categoría 11: Política CORS y Proxy (`trustProxy`)
- **HTTP-CORS-01:** Preflight `OPTIONS /api/v1/auth/login` desde un origen incluido en `SITECORP_HTTP_ALLOWED_ORIGINS` devuelve `204` con `Access-Control-Allow-Origin` exacto y `Access-Control-Allow-Credentials: true`.
- **HTTP-CORS-02:** Petición desde origen no incluido en la lista blanca no recibe cabeceras `Access-Control-Allow-Origin` ni `Access-Control-Allow-Credentials`.
- **HTTP-PRX-01:** Con `trustProxy: false` (o IP externa no confiable), un cliente que envía `X-Forwarded-For: 203.0.113.99` no logra falsificar `req.ip` ni evadir el Rate Limiter por IP.

### Categoría 12: Auditoría de Atributos de Cookies (`Set-Cookie`)
- **HTTP-CK-01:** Inspección de `res.headers['set-cookie']` verificando que `sitecorp_rt` incluye siempre `HttpOnly`, `Path=/api/v1/auth`, `SameSite=Strict` (o `Lax`), `Max-Age`, y `Secure` cuando `AUTH_COOKIE_SECURE=true`, sin atributo `Domain`.
- **HTTP-CK-02:** Cuando `AUTH_COOKIE_SECURE=true`, la cookie CSRF se denomina `__Host-sitecorp_csrf` e incluye `Path=/`, `Secure`, `SameSite=Strict` y ningún atributo `Domain`.
- **HTTP-CK-03:** Al borrar cookies (`/logout`, `/change-password`, error `401` en `/refresh`), las directivas `Set-Cookie` con `Max-Age=0` conservan exactamente `Path=/api/v1/auth` para `sitecorp_rt` y `Path=/` para `__Host-sitecorp_csrf`.

### Categoría 13: Rate Limiting Dual (IP y Cuenta) y Memoria Acotada
- **HTTP-RL-01:** Superar el umbral por IP en `POST /api/v1/auth/login` devuelve `429 Too Many Requests` (`RATE_LIMIT_EXCEEDED`) con cabecera `Retry-After` antes de ejecutar Argon2id.
- **HTTP-RL-02:** Superar el umbral por cuenta (`email`) rotando distintas IPs devuelve `429 Too Many Requests`.
- **HTTP-RL-03:** Insertar más de `maxEntries` (`10_000`) claves en `InMemoryRateLimiter` desaloja las más antiguas (LRU) sin superar la cota máxima de entradas en memoria.

### Categoría 14: Concurrencia y Saturación de Argon2id (`Argon2ConcurrencyGate`)
- **HTTP-CONC-01:** Lanzar peticiones concurrentes de login dentro de `maxConcurrent + maxQueueSize` las procesa respetando estrictamente `active <= maxConcurrent`.
- **HTTP-CONC-02:** Superar `maxConcurrent + maxQueueSize` o exceder `acquireTimeoutMs` rechaza las peticiones sobrantes con `503 Service Unavailable` (`AUTH_SERVER_BUSY`) y `Retry-After: 5`.

### Categoría 15: Manejo de Errores de PostgreSQL y Validación de Esquemas
- **HTTP-ERR-01:** Enviar JSON malformado, campos adicionales (`additionalProperties: false`), `Content-Type: text/plain` (`415`) o un payload mayor a `4 KiB` (`413`) devuelve el código HTTP exacto con la estructura `{ error: { code, message, requestId, details } }`.
- **HTTP-ERR-02:** Simular un fallo SQL en un repositorio devuelve `500 Internal Server Error` (`INTERNAL_SERVER_ERROR`) o `503` en `/health/ready`, sin exponer jamás sentencias SQL, nombres de tablas ni `stack`.

### Categoría 16: Garantía de Cero Fuga de Secretos en Respuestas y Logs
- **HTTP-SEC-01:** Ninguna respuesta HTTP (exitosa o de error) contiene `password_hash`, `token_hash`, claves privadas PEM, ni el `refreshToken` en el cuerpo JSON.
- **HTTP-SEC-02:** Capturar el stream del logger Pino durante `/login`, `/refresh` y `/change-password` y verificar mediante aserción que ni `password`, ni `newPassword`, ni `Authorization`, ni `Cookie`, ni `Set-Cookie` aparecen en claro en los logs.

---

## 3. CRITERIOS DE ACEPTACIÓN VERIFICABLES PARA LA FASE 4G.2B

La futura implementación de la **Fase 4G.2B** sólo se considerará completada si supera simultáneamente los siguientes 10 criterios de aceptación verificables:

1. **CA-01 (Aislamiento Total):** Cero archivos modificados fuera de `services/auth-api/`. El `package.json` raíz y el frontend de SiteCorp permanecen intactos.
2. **CA-02 (Tipado Estricto):** `npm run typecheck` (`tsc --noEmit`) dentro de `services/auth-api/` finaliza con `0` errores.
3. **CA-03 (No Regresión):** Todas las suites existentes de las fases anteriores (dominio, casos de uso, persistencia PostgreSQL/PGlite y criptografía Argon2id/Ed25519) siguen pasando al 100%.
4. **CA-04 (Cobertura de las 16 Categorías HTTP):** La nueva suite `tests/http/` implementa y aprueba el 100% de los casos `HTTP-LOG-*`, `HTTP-TMP-*`, `HTTP-REF-*`, `HTTP-OUT-*`, `HTTP-REV-*`, `HTTP-JWT-*`, `HTTP-ADM-*`, `HTTP-CSRF-*`, `HTTP-CORS-*`, `HTTP-PRX-*`, `HTTP-CK-*`, `HTTP-RL-*`, `HTTP-CONC-*`, `HTTP-ERR-*` y `HTTP-SEC-*`.
5. **CA-05 (Conformidad RFC 6265bis de Cookies):** Verificación automatizada de que `sitecorp_rt` usa `Path=/api/v1/auth; HttpOnly` sin `Domain`, `__Host-sitecorp_csrf` usa `Path=/; Secure` sin `Domain`, que el borrado (`Max-Age=0`) respeta exactamente ambos `Path`, y que los usuarios `pending_password_change` jamás reciben `sitecorp_rt`.
6. **CA-06 (CSRF Firmado y Vinculado a `sid`):** Verificación automatizada de que un token CSRF válido en una sesión es rechazado (`403 CSRF_INVALID`) si se intenta reutilizar con la cookie `sitecorp_rt` de otra sesión distinta.
7. **CA-07 (Revocación Inmediata en los 4 Vectores):** Verificación automatizada de que `verifyAccessTokenSessionState()` invalida inmediatamente cualquier `accessToken` tras logout, cambio de contraseña, suspensión/baja administrativa y detección de reuso de refresh token.
8. **CA-08 (Autorización Administrativa en Tiempo Real):** Verificación automatizada de que la revocación de permisos de un operador en `IOperatorPrincipalResolver` bloquea inmediatamente el acceso a `/api/v1/auth/admin/*` sin esperar a que expire su JWT.
9. **CA-09 (Protección Anti-OOM de Argon2id):** Verificación automatizada de que `Argon2ConcurrencyGate` limita la concurrencia activa a `maxConcurrent` (`2` por defecto) y responde `503 AUTH_SERVER_BUSY` cuando la cola (`maxQueueSize`) se satura.
10. **CA-10 (Cero Fuga de Secretos):** Verificación automatizada sobre cuerpos HTTP y salida de logs Pino confirmando la ausencia total de contraseñas, hashes, refresh tokens crudos y claves privadas.
