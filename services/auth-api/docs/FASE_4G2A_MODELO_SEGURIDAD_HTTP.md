# SITECORP — FASE 4G.2A: MODELO DE SEGURIDAD HTTP

- **Servicio**: `@sitecorp/auth-api` (`services/auth-api/`)
- **Rama**: `inicio-de-sesion-en-backend`
- **Commit Base**: `50b567f8804b7e0e61243939a49593b65617398d`
- **Estado**: Diseño de Seguridad Auditado y Cerrado (Fase 4G.2A.1 — sin implementación productiva)

---

## 1. ESTRATEGIA DE TOKENS, SESIÓN Y COOKIES EN NAVEGADOR

### 1.1 Comparación de Estrategias Evaluadas

| Criterio | Opción A (Seleccionada): Access Token en Memoria (`Authorization: Bearer`) + Refresh Token en Cookie `HttpOnly` (`sitecorp_rt`) | Opción B (Descartada): Sesión puramente por Cookie `HttpOnly` para todas las peticiones | Opción C (Prohibida): Refresh Token en `localStorage` / `sessionStorage` |
| :--- | :--- | :--- | :--- |
| **Exposición del Refresh Token ante XSS** | **Nula.** La cookie `sitecorp_rt` (`HttpOnly`) es inaccesible desde `document.cookie` o scripts inyectados. | **Nula.** | **Crítica.** Un único vector XSS exfiltra el refresh token de 14 días y permite persistencia fuera del navegador. |
| **Superficie de ataque CSRF** | **Acotada a los 2 únicos endpoints que leen la cookie `sitecorp_rt`** (`POST /api/v1/auth/refresh` y `POST /api/v1/auth/logout`). El resto de la API exige `Authorization: Bearer <jwt>`, que el navegador jamás adjunta automáticamente. | **Total.** Todas las rutas mutadoras de la plataforma requerirían protección CSRF estricta. | **Nula**, pero a costa de vulnerabilidad crítica ante XSS. |
| **Compatibilidad con la SPA de SiteCorp** | **Directa.** El cliente mantiene el `accessToken` en un closure de memoria (jamás en `localStorage`) y lo envía en `Authorization: Bearer`. | Requiere reescribir todos los clientes HTTP del frontend. | Incompatible con los estándares de seguridad de SiteCorp. |
| **Revocación inmediata en servidor** | **Sí.** Cada JWT incluye `sid` (`sess_<uuid>`) verificado contra `sitecorp_auth.sessions` mediante `verifyAccessTokenSessionState()`. | **Sí.** | **Sí**, pero no evita la clonación previa del refresh token. |

### 1.2 Topología de Despliegue tras Proxy Inverso (Sin Asumir Dominio Fijo)

El diseño no asume ni codifica ningún dominio final de producción. Los orígenes permitidos se inyectan obligatoriamente mediante `SITECORP_HTTP_ALLOWED_ORIGINS`.

#### Topología Primaria Recomendada: Same-Origin tras Reverse Proxy (Nginx / Caddy)
- Un único origen HTTPS sirve tanto la SPA como el prefijo `/api/v1/auth/*` (enrutado internamente a `http://127.0.0.1:4010`).
- **Ventajas de seguridad:**
  - Permite `SameSite=Strict` en `sitecorp_rt` y `__Host-sitecorp_csrf` sin verse afectado por el bloqueo de cookies de terceros (*Third-Party Cookie Deprecation*).
  - Ambas cookies operan como *Host-Only* (sin atributo `Domain`), impidiendo que cualquier subdominio hermano lea o inyecte cookies.

#### Topología Secundaria Soportada: Subdominios Hermanos (*Same-Site, Cross-Origin*)
- Si el frontend y `auth-api` se alojan en subdominios distintos bajo el mismo *eTLD+1*, se mantiene `SameSite=Lax` o `Strict`, sin fijar `Domain` en `sitecorp_rt` (ya que sólo el host de `auth-api` debe recibirla), y se habilita CORS estricto con `Access-Control-Allow-Credentials: true` exclusivamente para los orígenes declarados en `SITECORP_HTTP_ALLOWED_ORIGINS`.

---

## 2. AUDITORÍA Y ESPECIFICACIÓN EXACTA DE COOKIES

### 2.1 Por qué `sitecorp_rt` usa `Path=/api/v1/auth` y `__Host-sitecorp_csrf` usa `Path=/`

- Según **RFC 6265bis (Sección 4.1.3.2)**, cualquier cookie con el prefijo `__Host-` **debe obligatoriamente** cumplir tres invariantes: `Secure`, ausencia de atributo `Domain`, y **`Path=/`**. Si un servidor envía `__Host-sitecorp_rt` con `Path=/api/v1/auth`, los navegadores rechazan silenciosamente la cookie.
- Por principio de mínimo privilegio en tránsito, el Refresh Token (`sitecorp_rt`) **no debe enviarse en todas las peticiones a `/`**, sino únicamente a `/api/v1/auth`. Por tanto:
  1. La cookie de Refresh Token se denomina **`sitecorp_rt`** con `Path=/api/v1/auth`, `HttpOnly`, `Secure` (en HTTPS), `SameSite=Strict` (o `Lax`) y **sin atributo `Domain`** (*Host-Only*).
  2. La cookie CSRF se denomina **`__Host-sitecorp_csrf`** en HTTPS con `Path=/`, `Secure`, `SameSite=Strict` y **sin atributo `Domain`**, cumpliendo al 100% los requisitos del prefijo `__Host-`.

### 2.2 Tabla de Atributos Exactos de Cookies

| Atributo | Cookie de Refresh Token (`sitecorp_rt`) | Cookie CSRF en HTTPS (`__Host-sitecorp_csrf`) | Cookie CSRF en Test/Dev HTTP (`sitecorp_csrf`) |
| :--- | :--- | :--- | :--- |
| **Nombre** | `sitecorp_rt` | `__Host-sitecorp_csrf` | `sitecorp_csrf` *(sólo cuando `AUTH_COOKIE_SECURE=false` en loopback)* |
| **Contenido** | `sct_<43 chars base64url>` (256 bits CSPRNG) | `<nonce>.<iat>.<hmac_sha256>` (Token CSRF firmado vinculado a `sid`; **sin secretos**) | `<nonce>.<iat>.<hmac_sha256>` |
| **`HttpOnly`** | **`true`** (inaccesible a JS) | **`false`** (permitido para lectura same-origin si se requiere, además de viajar en el body JSON) | **`false`** |
| **`Secure`** | **`true`** en HTTPS (`false` sólo en loopback HTTP) | **`true`** (obligatorio por `__Host-`) | **`false`** |
| **`SameSite`** | **`Strict`** (por defecto) o `Lax` | **`Strict`** (por defecto) o `Lax` | **`Lax`** |
| **`Path`** | **`/api/v1/auth`** | **`/`** (obligatorio por `__Host-`) | **`/`** |
| **`Domain`** | **Omitido (*Host-Only*)** | **Omitido (*Host-Only*, obligatorio por `__Host-`)** | **Omitido (*Host-Only*)** |
| **`Max-Age`** | Segundos restantes hasta `refreshToken.expiresAt` (`1209600` s = 14 días al emitirse) | Igual al `Max-Age` de `sitecorp_rt` | Igual al `Max-Age` de `sitecorp_rt` |
| **`Expires`** | Fecha UTC de `refreshToken.expiresAt` | Fecha UTC de `refreshToken.expiresAt` | Fecha UTC de `refreshToken.expiresAt` |

### 2.3 Regla Estricta de Borrado de Cookies (Compatibilidad Exacta de `Path` y Atributos)
Un navegador **jamás borra una cookie** si la directiva `Set-Cookie` de limpieza (`Max-Age=0`) utiliza un `Path` o `Domain` diferente al usado al crearla. Por consiguiente, la función `clearAuthCookies(reply, config)` enviará siempre dos cabeceras `Set-Cookie` con correspondencia exacta:
1. Para `sitecorp_rt`:
   `Set-Cookie: sitecorp_rt=; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT` *(sin `Domain`)*.
2. Para `__Host-sitecorp_csrf`:
   `Set-Cookie: __Host-sitecorp_csrf=; Path=/; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT` *(sin `Domain`)*.

### 2.4 Comportamiento en Escenarios Críticos del Ciclo de Vida de Cookies

1. **Inicio de sesión con contraseña temporal (`pending_password_change` / `mustChangePassword === true`):**
   - **No se emite refresh token en base de datos ni se envía la cookie `sitecorp_rt` ni `__Host-sitecorp_csrf`**.
   - Si el navegador envió cookies de una sesión anterior en la petición `/login`, el servidor **revoca la sesión previa** y envía las cabeceras de **borrado (`Max-Age=0`)** para `sitecorp_rt` (`Path=/api/v1/auth`) y `__Host-sitecorp_csrf` (`Path=/`).
   - El cliente recibe únicamente el `accessToken` en memoria con `role: "pending_password_change"` y `scope: "auth:change_password"` (TTL 15 minutos) para invocar `POST /api/v1/auth/change-password`.
2. **Inicio de sesión cuando el navegador ya tiene una sesión anterior (`sitecorp_rt` presente en `POST /api/v1/auth/login`):**
   - Antes de establecer las nuevas cookies del usuario autenticado, el controlador extrae el `sitecorp_rt` antiguo (si existe), calcula su hash SHA-256 y ejecuta la revocación silenciosa (*best-effort*) de la sesión y familia anterior en PostgreSQL (`LogoutUseCase.execute({ rawRefreshToken: oldCookieToken })`), evitando dejar sesiones huérfanas abiertas en base de datos.
   - Si el nuevo login **falla** (`401 INVALID_CREDENTIALS`, `403 USER_SUSPENDED`, `423 ACCOUNT_LOCKED`), **no** se emiten nuevas cookies.
3. **Sesión expirada, revocada o detección de reutilización de Refresh Token en `POST /api/v1/auth/refresh`:**
   - Ante `TokenExpiredError`, `TokenInvalidError`, `SessionInvalidError`, `TokenReuseDetectedError` o `UserSuspendedError`:
     - En caso de `ALREADY_REVOKED`, `PostgresSessionRepository.rotateRefreshTokenAtomic` confirma (`COMMIT`) de forma irreversible la revocación de toda la familia de tokens y de la sesión (`revoke_reason = 'TOKEN_REUSE_DETECTED'`).
     - El servidor responde `401 Unauthorized` (o `403` si está suspendido) e incluye obligatoriamente `clearAuthCookies(reply)` (`Max-Age=0` con `Path=/api/v1/auth` y `Path=/`) para purgar inmediatamente las credenciales muertas del navegador.

---

## 3. AUDITORÍA CSRF: TOKEN FIRMADO VINCULADO A SESIÓN VS. DOUBLE-SUBMIT INGENUO

### 3.1 Análisis: Token Firmado y Vinculado a `sid` (Seleccionado) frente a Double-Submit Ingenuo

| Aspecto | Double-Submit Cookie Ingenuo (Descartado) | Signed Session-Bound Double-Submit Token — HMAC-SHA256 (Seleccionado) |
| :--- | :--- | :--- |
| **Funcionamiento** | Genera un valor aleatorio `R` y solo comprueba que `Cookie == Header`. | Genera un token `T = <nonce>.<iat>.<hmac>` firmado con `HMAC-SHA256(CSRF_HMAC_SECRET, "csrf_v1:" + sid + ":" + nonce + ":" + iat)`. Verifica que `Cookie == Header` **y** que la firma HMAC corresponda al `sid` de la sesión activa. |
| **Resistencia a Cookie Fixation / Subdomain Injection** | Débil si un atacante logra fijar la cookie en un entorno sin `__Host-` o mediante un proxy intermedio mal configurado, ya que cualquier par `Cookie == Header` fijado por el atacante sería aceptado. | **Total.** Incluso si un atacante pudiera fijar una cookie, no conoce `CSRF_HMAC_SECRET` ni puede falsificar un HMAC válido para el `sid` de la víctima. |
| **Almacenamiento en servidor** | Stateless. | **Stateless.** Se verifica criptográficamente con el `sid` que ya se obtiene al validar el refresh token o el JWT, sin añadir tablas ni lecturas SQL adicionales. |
| **Exposición de secretos en la cookie CSRF** | Ninguna. | **Ninguna.** Ni el `CSRF_HMAC_SECRET` ni el `refreshToken` ni siquiera el `sid` en texto claro necesitan viajar expuestos si se calcula el HMAC sobre el `sid` resuelto en el servidor (`<nonce_16B_b64url>.<iat_hex>.<hmac_32B_b64url>`). |
| **Requiere leer cookie `HttpOnly` desde JS** | No. | **No.** El cliente recibe `csrfToken` en el cuerpo JSON de `/login` y `/refresh` (y en `__Host-sitecorp_csrf` con `HttpOnly=false`) y lo envía en la cabecera `X-CSRF-Token`. |

### 3.2 Especificación Criptográfica del `CsrfTokenService`

1. **Secreto del Servidor (`SITECORP_CSRF_HMAC_SECRET`):**
   - Clave simétrica de al menos 32 bytes (256 bits) de entropía cargada desde variables de entorno en `loadHttpConfigFromEnv()` (separada de las claves Ed25519 de JWT).
2. **Generación (`generateToken(sessionId: string, nowSeconds: number)`):**
   - `nonce`: `crypto.randomBytes(16).toString("base64url")` (128 bits CSPRNG).
   - `iatHex`: `nowSeconds.toString(16)`.
   - `macInput`: `"sitecorp_csrf_v1|" + sessionId + "|" + nonce + "|" + iatHex`.
   - `signature`: `crypto.createHmac("sha256", secretKey).update(macInput, "utf8").digest("base64url")`.
   - Token resultante: `${nonce}.${iatHex}.${signature}`.
3. **Validación en Tiempo Constante (`verifyToken(headerToken, cookieToken, expectedSessionId, maxAgeSeconds)`):**
   - **Paso A:** Verificar que `headerToken` y `cookieToken` sean strings no vacíos de idéntica longitud byte a byte y compararlos con `crypto.timingSafeEqual(Buffer.from(headerToken, "utf8"), Buffer.from(cookieToken, "utf8"))`.
   - **Paso B:** Separar `nonce`, `iatHex` y `signature` (exactamente 3 segmentos). Verificar que `nowSeconds - parseInt(iatHex, 16) <= maxAgeSeconds` (14 días).
   - **Paso C:** Recalcular `expectedSignature = HMAC-SHA256(secretKey, "sitecorp_csrf_v1|" + expectedSessionId + "|" + nonce + "|" + iatHex)` y comparar los buffers de firma mediante `crypto.timingSafeEqual`.
   - Cualquier fallo devuelve `403 Forbidden` (`CSRF_INVALID`).
4. **Rotación e Invalidación:**
   - Se emite un nuevo token CSRF en cada `POST /api/v1/auth/login` (para usuarios `active`) y se **rota** en cada `POST /api/v1/auth/refresh`.
   - Se invalida y borra (`Max-Age=0`) en `POST /api/v1/auth/logout`, `POST /api/v1/auth/change-password` y ante cualquier error `401`/`403` en `POST /api/v1/auth/refresh`.

### 3.3 Política de `Origin` y `Referer` y Protección Diferenciada por Endpoint

1. **Extracción y Validación de Origen (`verifyRequestOrigin`):**
   - Se lee primero la cabecera `Origin`.
   - Si `Origin` no está presente, se intenta extraer el `origin` (`scheme + "://" + host`) de la cabecera `Referer`.
   - El origen extraído debe pertenecer exactamente al conjunto inmutable `allowedOrigins: ReadonlySet<string>` configurado en `SITECORP_HTTP_ALLOWED_ORIGINS`.
2. **Comportamiento cuando falta `Origin` y `Referer`:**
   - **En endpoints autenticados por cookie (`POST /api/v1/auth/refresh`, y `POST /api/v1/auth/logout` cuando incluye cookie `sitecorp_rt`):** Los navegadores compatibles envían siempre `Origin` en peticiones `POST` (`fetch`). Por tanto, si faltan tanto `Origin` como `Referer`, la petición se **rechaza de forma cerrada (`403 CSRF_INVALID`)**.
   - **En endpoints autenticados exclusivamente por cabecera `Authorization: Bearer` (`GET /me`, `POST /change-password`, `/admin/*`) o en `POST /login` desde clientes no-navegador / CLI de administración:** Si `Origin` o `Referer` están presentes, deben coincidir con `allowedOrigins` (`403 CSRF_INVALID` si provienen de un origen cruzado no autorizado); si ambas cabeceras están ausentes y la petición no depende de la cookie `sitecorp_rt`, se permite continuar siempre que cumpla `Content-Type: application/json` y `Authorization: Bearer`.
3. **Matriz de Protección CSRF por Endpoint:**

| Endpoint | Credencial Utilizada | `Content-Type: application/json` | Validación `Origin` / `Referer` | Validación Token CSRF Firmado (`X-CSRF-Token` == `__Host-sitecorp_csrf` + HMAC `sid`) |
| :--- | :--- | :---: | :---: | :---: |
| **`POST /api/v1/auth/login`** | `email` + `password` en JSON | Obligatorio (`415` si no) | Obligatoria si `Origin`/`Referer` están presentes | No aplica al entrar (aún no hay sesión); emite `__Host-sitecorp_csrf` al salir si `active`. |
| **`POST /api/v1/auth/refresh`** | Cookie `HttpOnly` `sitecorp_rt` | Obligatorio si hay body | **Obligatoria (Fail-Closed si falta)** | **Obligatoria (vinculada al `sid` del refresh token)** |
| **`POST /api/v1/auth/logout`** | Cookie `sitecorp_rt` y/o `Bearer` | Obligatorio si hay body | **Obligatoria si hay cookie `sitecorp_rt`** | **Obligatoria si hay cookie `sitecorp_rt`** |
| **`POST /api/v1/auth/change-password`** | `Authorization: Bearer` | Obligatorio (`415` si no) | Obligatoria si `Origin`/`Referer` están presentes | No requerida (usa `Bearer` no enviado automáticamente por el navegador). |
| **`GET /api/v1/auth/me`** | `Authorization: Bearer` | — | Obligatoria si `Origin` está presente (CORS) | No requerida (método `GET` + `Bearer`). |
| **`/api/v1/auth/admin/*`** | `Authorization: Bearer` | Obligatorio (`415` si no) | Obligatoria si `Origin`/`Referer` están presentes | No requerida (usa `Bearer`). |

---

## 4. AUDITORÍA DE AUTORIZACIÓN Y PIPELINE DE 7 PASOS

### 4.1 Brecha Detectada en la Auditoría sobre Roles Administrativos y Solución Definitiva

Al inspeccionar `sitecorp_auth.users` (`0001_sitecorp_auth_schema.design.sql`), `AuthUser` (`src/domain/user.entity.ts`) y `LoginUseCase` (`src/application/use-cases/login.use-case.ts`), se verificó que:
1. La tabla `sitecorp_auth.users` **no tiene columna `role`**; únicamente almacena el estado del ciclo de vida (`status`: `'active' | 'suspended' | 'pending_password_change' | 'deleted'`) y `must_change_password`.
2. `LoginUseCase` y `RefreshSessionUseCase` firman el JWT asignando `claims.role = isPendingPasswordChange ? "pending_password_change" : "authenticated"`.
3. `AdminCreateUserUseCase` y `AdminUpdateStatusUseCase` reciben un `operator: AuthenticatedPrincipal` (`{ userId, email, permissions: ReadonlySet<string>, isPlatformAdmin?: boolean, mustChangePassword?: boolean, role?: string }`) y delegan la decisión en `IAuthorizationPolicyService` (`canManageUsers`, `canSuspendUser`, `canDeleteUser`).

#### Solución Arquitectónica para Garantizar Revocación Inmediata de Privilegios Administrativos:
- **Nunca confiar en un rol o permiso estático embebido en un JWT antiguo** para autorizar `/api/v1/auth/admin/*`.
- En el **Paso 6** del pipeline HTTP, para cualquier ruta administrativa (`/admin/*`), el hook `requireAdminPrincipalHook` invoca un puerto `IOperatorPrincipalResolver.resolvePrincipal(user: AuthUser): Promise<AuthenticatedPrincipal>` antes de llamar al caso de uso:
  - `IOperatorPrincipalResolver` construye el `AuthenticatedPrincipal` en tiempo real para el `user.id` ya validado en el Paso 5 (`user.status === 'active'` y `user.mustChangePassword === false`), consultando la fuente autoritativa de permisos/administradores configurada en el backend (p. ej. tabla/consulta de permisos en PostgreSQL o conjunto inmutable de UUIDs/correos de administradores de plataforma en `AuthHttpConfig` mientras el esquema `sitecorp_auth` no incorpore tabla RBAC propia).
  - Si un operador pierde sus privilegios administrativos o su cuenta pasa a `suspended`/`deleted`/`pending_password_change`, la **siguiente petición HTTP a `/admin/*` es rechazada en el acto (`403 FORBIDDEN` o `401 SESSION_INVALID`)**, incluso aunque su JWT de 15 minutos siga vigente.

### 4.2 Pipeline Obligatorio de 7 Pasos en Endpoints Protegidos

```text
[Petición HTTP a Ruta Protegida]
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 1: Extracción Estricta de Credencial Bearer                        │
│ - Leer cabecera `Authorization`.                                        │
│ - Exigir formato exacto `^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$`.│
│ - Si falta o es inválido -> 401 UNAUTHORIZED.                           │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 2: Verificación Criptográfica Ed25519 (`EdDSA`)                    │
│ - Invocar `tokenService.verifyAccessToken(rawJwt)`.                     │
│ - Valida algoritmo `EdDSA`, `kid` en llavero activo/histórico y firma.  │
│ - Fallo -> 401 TOKEN_INVALID / TOKEN_EXPIRED.                           │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 3: Validación Estructural de Claims                                │
│ - Confirmar `iss`, `aud`, `sub` (UserId UUID v4), `sid` (`sess_<uuid>`),│
│   `role` (`authenticated` | `pending_password_change`), `scope`, `exp`. │
│ - Fallo -> 401 TOKEN_INVALID.                                           │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 4: Consulta de Estado de Sesión Persistida (`sid`)                 │
│ - Invocar `verifyAccessTokenSessionState(claims, sessionRepo, userRepo)`│
│ - Consulta `sessionRepo.findSessionById(claims.sid)`.                   │
│ - Verifica `session !== null`, `!session.isRevoked`,                    │
│   `session.expiresAt > now`, y `session.userId === claims.sub`.         │
│ - Fallo -> 401 SESSION_INVALID / TOKEN_INVALID.                         │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 5: Verificación en Vivo del Usuario en PostgreSQL                  │
│ - Dentro de `verifyAccessTokenSessionState`:                            │
│   - Consulta `userRepo.findById(claims.sub)`.                           │
│   - Si `!user || user.status === 'deleted' || user.deletedAt !== null`  │
│     -> 401 SESSION_INVALID.                                             │
│   - Invoca `user.ensureCanAuthenticate(now)`:                           │
│     - Si `status === 'suspended'` -> 403 USER_SUSPENDED.                │
│     - Si `isLocked(now)` -> 423 ACCOUNT_LOCKED.                         │
│   - Verifica coherencia: si `user.mustChangePassword` es true pero el   │
│     token tenía `scope === 'api:full'` -> 401 SESSION_INVALID.          │
│   - Adicionalmente, si `user.mustChangePassword === false` pero el      │
│     token antiguo aún tenía `scope === 'auth:change_password'`          │
│     -> 401 SESSION_INVALID (obliga a usar sesión post-cambio).          │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 6: Confinamiento de Scope y Autorización en Tiempo Real            │
│ - En todas las rutas excepto `/change-password` y `/logout` (incluyendo │
│   `GET /me` y `/admin/*`):                                              │
│   - Exigir `claims.scope === 'api:full'`, `claims.role === 'authenticated'`│
│     y `!user.mustChangePassword`.                                       │
│   - Si el usuario está en `pending_password_change`                     │
│     -> 403 PASSWORD_CHANGE_REQUIRED.                                    │
│ - En rutas `/admin/*`:                                                  │
│   - Resolver `operator = await principalResolver.resolvePrincipal(user)`│
│     en vivo (sin confiar en roles de un JWT antiguo).                   │
│   - Verificar `authPolicy.canManageUsers` / `canSuspendUser` /          │
│     `canDeleteUser` -> 403 FORBIDDEN si se deniega.                     │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PASO 7: Ejecución del Caso de Uso                                       │
│ - Adjunta `req.authContext = Object.freeze({ user, session, claims,     │
│   operator })` y ejecuta el controlador.                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. DIMENSIONAMIENTO DE CONCURRENCIA ARGON2ID Y RATE LIMITING

### 5.1 Fórmula de Dimensionamiento de `Argon2ConcurrencyGate` para el VPS

No se debe asumir un valor fijo arbitrario (como `maxConcurrent = 4`) sin considerar la memoria real del VPS. Cada operación de Argon2id reserva memoria nativa en C++ fuera del heap de V8 (`memoryCostKiB = 19456 KiB` = `19 MiB` por defecto, pudiendo calibrarse hasta `64 MiB` según el hardware).

La fórmula de dimensionamiento seguro para calcular el número máximo de operaciones Argon2id simultáneas por proceso (`maxConcurrent`) es:

$$\text{maxConcurrent} = \max\left(1,\ \left\lfloor \frac{\text{RAM}_{\text{disponible\_auth}} \times (1 - \sigma_{\text{margen}}) - N_{\text{proc}} \cdot \left(\text{RAM}_{\text{NodeBase}} + C_{\text{pgPool}} \cdot \text{RAM}_{\text{pgConn}}\right)}{N_{\text{proc}} \cdot M_{\text{Argon2id}} \cdot \gamma_{\text{nativo}}} \right\rfloor\right)$$

Donde:
- $\text{RAM}_{\text{disponible\_auth}}$: Memoria RAM en MiB asignada exclusivamente a `services/auth-api` (descontando el sistema operativo Linux y el motor PostgreSQL si comparten el mismo VPS).
- $\sigma_{\text{margen}} = 0.25$ (**25% de margen de seguridad** libre para picos de recolector de basura V8 y buffers de red).
- $N_{\text{proc}}$: Número de procesos Node.js de `auth-api` ejecutándose en la máquina (por defecto `1`).
- $\text{RAM}_{\text{NodeBase}} \approx 90\text{ MiB}$: Consumo base del proceso Node.js + Fastify + librerías en reposo.
- $C_{\text{pgPool}}$: Tamaño máximo del pool de conexiones PostgreSQL (`poolMax`, p. ej. `10`).
- $\text{RAM}_{\text{pgConn}} \approx 2\text{ MiB}$: Sobrecarga de buffers por cliente `pg` en Node.js.
- $M_{\text{Argon2id}} = \text{memoryCostKiB} / 1024$ (`19 MiB` con la configuración base auditada).
- $\gamma_{\text{nativo}} = 1.25$: Factor de sobrecarga de asignador nativo y hilos de `libuv`.

#### Ejemplos de Calibración Realista:
| Perfil de VPS / Contenedor | $\text{RAM}_{\text{disponible\_auth}}$ | $N_{\text{proc}}$ | Coste Argon2id ($M_{\text{Argon2id}}$) | Cálculo disponible para Argon2id | `maxConcurrent` Seguro Recomendado | `maxQueueSize` Recomendado |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **VPS Pequeño / Contenedor 256 MiB** | `256 MiB` | `1` | `19 MiB` | `256 * 0.75 - 110 = 82 MiB` | **`2`** (`~47.5 MiB` pico) | **`8`** |
| **VPS Medio / Contenedor 512 MiB** | `512 MiB` | `1` | `19 MiB` | `512 * 0.75 - 110 = 274 MiB` | **`4`** (`~95 MiB` pico) | **`16`** |
| **VPS Dedicado 1 GiB (2 workers)** | `1024 MiB` | `2` | `32 MiB` | `(768 - 220) / 2 = 274 MiB/proc` | **`4` por proceso** | **`16` por proceso** |

#### Valores Conservadores por Defecto en `AuthHttpConfig`:
- **`maxConcurrent`**: **`2`** por defecto (`SITECORP_ARGON2_MAX_CONCURRENT`, rango permitido `1..16`). Garantiza que incluso en un contenedor restringido de `256 MiB` el consumo pico de Argon2id nunca supere `~38-48 MiB`.
- **`maxQueueSize`**: **`8`** peticiones en espera FIFO (`SITECORP_ARGON2_MAX_QUEUE`, rango `0..64`).
- **`acquireTimeoutMs`**: **`2500` ms** (`SITECORP_ARGON2_QUEUE_TIMEOUT_MS`, rango `500..10000` ms).
- **Mecanismo de rechazo ante saturación:** Si `active >= maxConcurrent` y `queue.length >= maxQueueSize` (o expira `acquireTimeoutMs`), se rechaza inmediatamente sin ejecutar Argon2id ni abrir transacción SQL, devolviendo **`503 Service Unavailable`** (`error.code = "AUTH_SERVER_BUSY"`, cabecera `Retry-After: 5`).

### 5.2 Rate Limiting Dual, Cota de Memoria y Comportamiento Multi-Proceso

1. **Dos dimensiones independientes de limitación:**
   - **Por IP (`req.ip`):** Frena ataques volumétricos desde una misma dirección de origen antes de tocar la base de datos o el `Argon2ConcurrencyGate`.
   - **Por Cuenta / Usuario / Token:** Frena ataques distribuidos (*botnets* rotando IPs contra una cuenta específica):
     - En `POST /login`: límite en memoria de `5 req / 60 s` por `SHA-256(email_normalizado)` **más** el bloqueo persistente en PostgreSQL (`incrementFailedAttemptsAtomic` con `FOR UPDATE` en `sitecorp_auth.users`, que bloquea la cuenta durante 15 minutos al 5.º fallo independientemente de cuántas IPs o procesos intervengan).
2. **Memoria máxima acotada (`maxEntries = 10_000` con desalojo LRU):**
   - Cada entrada de `InMemoryRateLimiter` almacena únicamente `{ count: number, resetAtMs: number }` (~64 bytes).
   - Con `maxEntries = 10_000`, el consumo máximo de memoria del rate limiter está estrictamente acotado a **`< 2 MiB`**, impidiendo ataques de agotamiento de RAM mediante millones de direcciones IP falsificadas o correos aleatorios.
3. **Qué ocurre si el sistema utiliza más de un proceso o instancia ($N_{\text{proc}} > 1$):**
   - **Bloqueo de cuenta por fallos de contraseña:** Al estar persistido atómicamente en `sitecorp_auth.users` (`failed_login_attempts`, `locked_until`), es **100% compartido y exacto** entre todos los procesos/instancias sin configuración adicional.
   - **Cuotas de ventana corta por IP:** En modo `InMemoryRateLimiter`, cada proceso mantiene su propio contador en memoria (por lo que con $N$ procesos tras round-robin el umbral efectivo por IP sería $\le N \times \text{limit}$).
   - ** Contrato `IRateLimiter` asíncrono:** El puerto `IRateLimiter` se define asíncrono (`consume(key, limit, windowMs): Promise<RateLimitResult>`). Si se despliegan múltiples instancias, se puede conmutar por configuración a un adaptador respaldado en PostgreSQL (tabla UNLOGGED de contadores con expiración) o Redis sin modificar ningún controlador ni hook HTTP.
