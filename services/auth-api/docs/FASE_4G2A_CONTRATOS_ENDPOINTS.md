# SITECORP — FASE 4G.2A: CONTRATOS DE ENDPOINTS HTTP (`/api/v1/auth`)

- **Prefijo base versionado**: `/api/v1/auth`
- **Estado**: Diseño Auditado y Cerrado (Fase 4G.2A.1 — alineado con los casos de uso reales de `services/auth-api/src/`)
- **Formato de intercambio**: `application/json; charset=utf-8` (excepto el transporte del Refresh Token en la cookie `HttpOnly` `sitecorp_rt`).
- **Cabeceras presentes en todas las respuestas**:
  - `X-Request-Id: <uuid-v4>`
  - `Cache-Control: no-store, no-cache, must-revalidate, private`
  - `Pragma: no-cache`
  - `X-Content-Type-Options: nosniff`

---

## 1. Matriz de Compatibilidad con los Casos de Uso y Contratos Reales Existentes

Tras auditar el código real en `services/auth-api/src/application/`, `src/domain/` y `src/interfaces/`, se establece la matriz exacta de compatibilidad entre los contratos actuales de la capa de aplicación y los endpoints HTTP:

| Endpoint HTTP | Caso de Uso / Servicio Existente | Firma y Campos Disponibles Hoy en Código | Campos Ausentes o Discrepancias Detectadas | Adaptación Necesaria en Fase 4G.2B | Riesgo si No se Corrige | Decisión Arquitectónica Definitiva |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`POST /api/v1/auth/login`** | `LoginUseCase.execute(dto: LoginDto): Promise<LoginResult>` | **Entrada (`LoginDto`)**: `{ email, password, ipAddress?, userAgent? }`.<br>**Salida (`LoginResult`)**: `{ user: AuthUser, accessToken, tokenType: "Bearer", expiresInSeconds, refreshToken, mustChangePassword }`. | 1. Cuando `user.mustChangePassword === true` (`pending_password_change`), `LoginUseCase` hoy crea igualmente un registro `RefreshToken` en BD y devuelve `refreshToken`.<br>2. `LoginResult` no expone `sessionId` (`sid`) ni `refreshTokenExpiresAt` directamente (aunque `sid` va dentro del `accessToken`). | En 4G.2B: **(a)** En `LoginUseCase`, omitir la creación de `RefreshToken` cuando `isPendingPasswordChange === true` (devolviendo `refreshToken: null`) e incluir `sessionId` en `LoginResult` para firmar el token CSRF vinculado a `sid`; **(b)** En el controlador HTTP, nunca emitir `sitecorp_rt` ni `__Host-sitecorp_csrf` si `mustChangePassword === true`, y enviar cabeceras de borrado (`Max-Age=0`) para limpiar cualquier sesión previa del navegador. | Si un usuario `pending_password_change` recibiera `sitecorp_rt`, tendría un token de refresco de 14 días antes de cambiar su clave temporal. | **No emitir `sitecorp_rt` en `pending_password_change`** y limpiar cookies previas en `/login`. Incluir `sessionId` en `LoginResult`. |
| **`POST /api/v1/auth/refresh`** | `RefreshSessionUseCase.execute(dto: RefreshSessionDto): Promise<RefreshSessionResult>` | **Entrada (`RefreshSessionDto`)**: `{ rawRefreshToken, ipAddress?, userAgent? }`.<br>**Salida (`RefreshSessionResult`)**: `{ accessToken, tokenType: "Bearer", expiresInSeconds, newRefreshToken }`. | 1. `RefreshSessionResult` no incluye `sessionId` (`sid`) ni la fecha `refreshTokenExpiresAt` / `sessionExpiresAt` para calcular el `Max-Age` restante y firmar el nuevo token CSRF vinculado a `sid`.<br>2. `RefreshSessionUseCase` permite refrescar si el usuario está en `pending_password_change`, pero como no se emite `sitecorp_rt` a usuarios en ese estado, en condiciones normales no tendrán cookie. | En 4G.2B: Añadir `readonly sessionId: string` y `readonly refreshTokenExpiresAt: Date` a `RefreshSessionResult` (datos que `RefreshSessionUseCase` ya tiene en memoria en la línea 131 de `refresh-session.use-case.ts` a través de `session.id` y `result.newToken.expiresAt`), y rechazar el refresh si `user.mustChangePassword === true`. | Sin `sessionId` ni `refreshTokenExpiresAt`, el controlador tendría que decodificar el JWT recién emitido o usar un `Max-Age` fijo que no respeta el tiempo restante del token. | **Ampliar `RefreshSessionResult` con `sessionId` y `refreshTokenExpiresAt`** (cambio retrocompatible de 2 propiedades de salida) y bloquear refresh para `pending_password_change`. |
| **`POST /api/v1/auth/logout`** | `LogoutUseCase.execute(dto: LogoutDto): Promise<void>` | **Entrada (`LogoutDto`)**: `{ sessionId?, rawRefreshToken?, userId?, allDevices? }`.<br>**Salida**: `void`. | Ninguna en el caso de uso. Si se invoca con `allDevices: true`, `LogoutUseCase` exige `dto.userId` (línea 30). | El controlador HTTP extraerá `userId = claims.sub` y `sessionId = claims.sid` cuando venga `Authorization: Bearer`, y/o `rawRefreshToken` de la cookie `sitecorp_rt`. Para `allDevices: true` exigirá `Authorization: Bearer` válido. Siempre enviará `Set-Cookie` de borrado (`Max-Age=0`). | Si un cliente envía `allDevices: true` sólo con cookie sin `userId` resuelto, la rama `allDevices` no se ejecutaría. | **Soportar logout dual (`Bearer` y/o cookie `sitecorp_rt`)**, exigir `Bearer` para `allDevices: true`, y devolver `200 OK` `{ data: { loggedOut: true } }` limpiando siempre las cookies. |
| **`POST /api/v1/auth/change-password`** | `ChangePasswordUseCase.execute(dto: ChangePasswordDto): Promise<void>` | **Entrada (`ChangePasswordDto`)**: `{ userId: UserId, currentPassword, newPassword }`.<br>**Salida**: `void`. | Ninguna en el caso de uso. Revoca todas las sesiones del usuario (`revokeAllUserSessions`) y limpia `mustChangePassword`. | El controlador HTTP toma `userId` exclusivamente de `req.authContext.user.id` (`claims.sub`), jamás del body JSON, e incluye cabeceras `Set-Cookie` con `Max-Age=0` para borrar `sitecorp_rt` y `__Host-sitecorp_csrf`. | Si se leyera `userId` del body, existiría vulnerabilidad crítica IDOR de cambio de clave de terceros. | **`userId` tomado exclusivamente de `req.authContext.user.id`** + limpieza obligatoria de cookies tras el cambio. |
| **`GET /api/v1/auth/me`** | `verifyAccessTokenSessionState(claims, sessionRepo, userRepo, now)` | Devuelve `VerifiedSessionState`: `{ user: AuthUser, session: AuthSession, claims: AccessTokenPayload }`. No existe una clase `GetMeUseCase` separada en `src/application/`. | El guard HTTP (`verifyAccessTokenSessionState`) ya consulta `user` y `session` en PostgreSQL en el Paso 4 y 5 del pipeline. | Documentar el contrato `IGetAuthenticatedIdentityUseCase` (o proyección directa de `req.authContext` ya validado por `verifyAccessTokenSessionState` + `sessionRepo.touch` opcional). Exigir `scope === "api:full"` (bloqueando `pending_password_change` con `403 PASSWORD_CHANGE_REQUIRED`). | Duplicar consultas SQL (`findById` + `findSessionById`) dos veces en la misma petición si un caso de uso vuelve a consultar lo que el guard ya cargó. | **Reutilizar el `VerifiedSessionState` cargado en el Paso 4-5 del guard HTTP** y bloquear tokens `pending_password_change` (`403 PASSWORD_CHANGE_REQUIRED`). |
| **`POST /api/v1/auth/admin/users`** | `AdminCreateUserUseCase.execute(dto: AdminCreateUserDto, operator?: AuthenticatedPrincipal): Promise<AuthUser>` | **Entrada (`AdminCreateUserDto`)**: `{ email: string, initialPassword?: string, mustChangePassword?: boolean }`.<br>**Operador**: `AuthenticatedPrincipal`.<br>**Salida**: `AuthUser`. | 1. `AdminCreateUserDto` **NO tiene campo `role`** ni `temporaryPassword` (el campo real se llama `initialPassword`).<br>2. `sitecorp_auth.users` y `AuthUser` **NO almacenan roles ni permisos**; `AdminCreateUserUseCase` valida permisos mediante `IAuthorizationPolicyService.canManageUsers(operator)`. | 1. El contrato HTTP de `/api/v1/auth/admin/users` recibe exactamente `{ email, initialPassword, mustChangePassword }` alineado con `AdminCreateUserDto`.<br>2. El Paso 6 del guard administrativo construye `AuthenticatedPrincipal` consultando un `IOperatorPrincipalResolver` en vivo (nunca confiando sólo en claims del JWT). | Si el contrato HTTP pidiera `role` o `temporaryPassword`, no coincidiría con `AdminCreateUserDto` y prometería persistir un rol que no existe en `sitecorp_auth.users`. | **Alinear el body HTTP exactamente con `AdminCreateUserDto` (`{ email, initialPassword, mustChangePassword }`)** y resolver los permisos del operador en vivo en el guard. |
| **`PATCH /api/v1/auth/admin/users/:id/status`** | `AdminUpdateStatusUseCase.execute(dto: AdminUpdateStatusDto, operator?: AuthenticatedPrincipal): Promise<AuthUser>` | **Entrada (`AdminUpdateStatusDto`)**: `{ userId: UserId, status: "active" \| "suspended" \| "deleted" }`.<br>**Operador**: `AuthenticatedPrincipal`.<br>**Salida**: `AuthUser`. | `AdminUpdateStatusDto` no tiene campo `reason` y retorna la entidad `AuthUser` actualizada. | El contrato HTTP recibe `params.id` (`UserId`) y body `{ status: "active" \| "suspended" \| "deleted" }`, devolviendo la proyección pública de `AuthUser`. | Desalineación entre esquema HTTP y DTO de aplicación. | **Alinear entrada y salida exactamente con `AdminUpdateStatusDto` y `AuthUser`**. |

---

## 2. Formato Uniforme de Respuestas y Errores

### 2.1 Sobre de Éxito (`200 OK` / `201 Created`)
Todas las respuestas exitosas devuelven un objeto JSON con estructura determinista:
```json
{
  "data": { ... },
  "meta": {
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "timestamp": "2026-11-07T18:30:00.000Z"
  }
}
```

### 2.2 Sobre Estándar de Error (`4xx` / `5xx`)
Ningún error devuelve jamás `200 OK`, ni incluye stack traces, sentencias SQL, nombres de tablas, hashes Argon2id ni tokens:
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Credenciales de autenticación incorrectas.",
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "details": null
  }
}
```

### 2.3 Tabla de Mapeo Canónico `DomainError` -> HTTP Status (Unificada)

| Error de Dominio / Infraestructura | `error.code` | HTTP Status | Mensaje Público / Observaciones |
| :--- | :--- | :---: | :--- |
| Error de validación de esquema Ajv / JSON malformado | `VALIDATION_ERROR` | `400` | Describe el campo inválido sin reflejar jamás valores secretos (`password`, tokens). |
| `InvalidEmailError` / `InvalidUserIdError` | `INVALID_EMAIL` / `INVALID_USER_ID` | `400` | Formato de identificador o correo inválido (en rutas administrativas; en `/login` se transforma en `INVALID_CREDENTIALS` tras dummy hash). |
| `WeakPasswordError` | `WEAK_PASSWORD` | `400` | Incluye `reasons` de `PasswordPolicy` en `error.details`. |
| `SamePasswordError` | `SAME_PASSWORD` | `400` | `"La nueva contraseña debe ser diferente a la contraseña actual."` |
| `InvalidCredentialsError` (usuario no existe, eliminado o clave errónea) | `INVALID_CREDENTIALS` | `401` | Idéntico código y mensaje en todos los casos (anti-enumeración). |
| `UnauthorizedError` / `TokenInvalidError` / `SessionInvalidError` | `UNAUTHORIZED` / `TOKEN_INVALID` / `SESSION_INVALID` | `401` | Limpia las cookies `sitecorp_rt` y `__Host-sitecorp_csrf` si procede en `/refresh`. |
| `TokenExpiredError` | `TOKEN_EXPIRED` | `401` | En rutas `Bearer` indica que el access token expiró; en `/refresh` limpia las cookies. |
| `TokenReuseDetectedError` | `TOKEN_REUSE_DETECTED` | `401` | Alerta crítica: familia y sesión revocadas en PostgreSQL; limpia inmediatamente las cookies. |
| `UserSuspendedError` | `USER_SUSPENDED` | `403` | Cuenta suspendida administrativamente. |
| `UserDeletedError` | `USER_DELETED` | `403` | En rutas administrativas (p. ej. intentar reactivar un usuario eliminado); en `/login` se enmascara como `401 INVALID_CREDENTIALS`. |
| Acceso con token `pending_password_change` a ruta que exige `api:full` | `PASSWORD_CHANGE_REQUIRED` | `403` | Bloquea el acceso a cualquier endpoint distinto de `/change-password` y `/logout`. |
| Fallo de validación CSRF (`Origin`/`Referer` o token HMAC) | `CSRF_INVALID` | `403` | Petición rechazada en `preValidation`/`preHandler` antes de tocar PostgreSQL. |
| `ForbiddenError` (permisos insuficientes en `/admin/*` o sesión ajena) | `FORBIDDEN` | `403` | Operador sin permisos requeridos por `IAuthorizationPolicyService`. |
| `UserNotFoundError` (sólo en rutas `/admin/*`) | `USER_NOT_FOUND` | `404` | El usuario objetivo no existe en `sitecorp_auth.users`. |
| `DuplicateEmailError` | `DUPLICATE_EMAIL` | `409` | El correo normalizado ya está registrado. |
| `ConcurrentCredentialModificationError` | `CONCURRENT_CREDENTIAL_MODIFICATION` | `409` | La credencial cambió en paralelo durante el cambio de contraseña. |
| Payload superior a `bodyLimit` | `PAYLOAD_TOO_LARGE` | `413` | Rechazado antes de parsear el cuerpo completo. |
| `Content-Type` distinto de `application/json` en POST/PATCH con cuerpo | `UNSUPPORTED_MEDIA_TYPE` | `415` | Mitigación adicional contra envíos de formularios HTML cross-site. |
| `AccountLockedError` | `ACCOUNT_LOCKED` | `423` | Incluye `{ lockedUntil: "<ISO-8601>" }` en `error.details`. |
| Exceso de peticiones (Rate Limiter por IP o cuenta) | `RATE_LIMIT_EXCEEDED` | `429` | Incluye cabecera `Retry-After: <segundos>`. |
| Cola de `Argon2ConcurrencyGate` llena o timeout vencido | `AUTH_SERVER_BUSY` | `503` | Incluye cabecera `Retry-After: 5`; protege la RAM del VPS frente a OOM. |
| Error inesperado de base de datos o interno | `INTERNAL_SERVER_ERROR` | `500` | Mensaje genérico sin detalles SQL ni trazas de pila. |

---

## 3. Especificación Detallada de Endpoints

### 3.1 `POST /api/v1/auth/login`
Autentica a un usuario mediante correo y contraseña (`LoginUseCase.execute`).

- **Autenticación requerida**: Ninguna (endpoint público).
- **Protección de Origen y Formato**:
  - Exige `Content-Type: application/json`.
  - Si la petición incluye cabecera `Origin` (o `Referer`), debe coincidir con un origen permitido en `SITECORP_HTTP_ALLOWED_ORIGINS` (`403 CSRF_INVALID` en caso contrario).
- **Límite de tamaño de body (`bodyLimit`)**: `4096` bytes (4 KiB).
- **Rate Limiting (ejecutado ANTES de `Argon2ConcurrencyGate`)**:
  - Por IP (`req.ip`): máx. `10` peticiones / 60 segundos.
  - Por cuenta (`SHA-256(email_normalizado)`): máx. `5` peticiones / 60 segundos en memoria + bloqueo transaccional en PostgreSQL al 5.º intento fallido (`AccountLockedError`, 15 minutos).
- **Concurrencia Argon2id**: Ejecución protegida por `Argon2ConcurrencyGate.run()`.
- **Esquema de entrada (`additionalProperties: false`)**:
  ```json
  {
    "email": "operador@sitecorp.cu",
    "password": "ClaveSegura#2026!"
  }
  ```
  - `email`: string (`3..254` caracteres).
  - `password`: string (`1..128` bytes UTF-8).
- **Comportamiento de Cookies en respuesta `200 OK`**:
  - **Caso A — Usuario activo (`mustChangePassword === false`)**:
    - Si el navegador envió en la petición una cookie `sitecorp_rt` correspondiente a una sesión anterior, el servidor revoca silenciosamente (best-effort) esa sesión previa en PostgreSQL antes de emitir la nueva.
    - Establece la cookie `HttpOnly` de Refresh Token:
      `Set-Cookie: sitecorp_rt=<rawRefreshToken>; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=1209600` (14 días, o segundos hasta `refreshToken.expiresAt`).
    - Establece la cookie CSRF firmada (vinculada a `sid` con HMAC-SHA256):
      `Set-Cookie: __Host-sitecorp_csrf=<signedCsrfToken>; Path=/; Secure; SameSite=Strict; Max-Age=1209600` (en entorno local HTTP sin TLS se nombra `sitecorp_csrf` sin `Secure`).
    - Devuelve `csrfToken: "<signedCsrfToken>"` en `data` para que el cliente SPA lo almacene en memoria junto al `accessToken`.
    - **Nunca** incluye `refreshToken` en el cuerpo JSON.
  - **Caso B — Usuario con cambio obligatorio de contraseña (`mustChangePassword === true` / `status === "pending_password_change"`)**:
    - **NO emite cookie `sitecorp_rt` ni `__Host-sitecorp_csrf`**.
    - Si el navegador tenía cookies previas (`sitecorp_rt` o `__Host-sitecorp_csrf`), envía explícitamente cabeceras `Set-Cookie` con `Max-Age=0` y el `Path` exacto (`/api/v1/auth` y `/`) para borrarlas, revocando cualquier sesión previa asociada.
    - Devuelve únicamente el `accessToken` restringido (`role: "pending_password_change"`, `scope: "auth:change_password"`) y `csrfToken: null`.
- **Esquema de salida (`200 OK`)**:
  ```json
  {
    "data": {
      "accessToken": "eyJhbGciOiJFZERTQSI...",
      "tokenType": "Bearer",
      "expiresInSeconds": 900,
      "mustChangePassword": false,
      "csrfToken": "r8k2...9a.672d1f00.X9pL...3Q",
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "email": "operador@sitecorp.cu",
        "status": "active",
        "mustChangePassword": false
      }
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T18:30:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `200 OK`, `400 Bad Request`, `401 Unauthorized` (`INVALID_CREDENTIALS`), `403 Forbidden` (`USER_SUSPENDED`, `CSRF_INVALID`), `413 Payload Too Large`, `415 Unsupported Media Type`, `423 Locked` (`ACCOUNT_LOCKED`), `429 Too Many Requests`, `503 Service Unavailable` (`AUTH_SERVER_BUSY`).
- **Eventos de auditoría (`sitecorp_auth.security_audit_events`)**:
  - `LOGIN_SUCCESS`, `LOGIN_FAILED` (`USER_NOT_FOUND`, `USER_DELETED_ATTEMPT`, `INVALID_PASSWORD`), `ACCOUNT_LOCKED`.

---

### 3.2 `POST /api/v1/auth/refresh`
Rota atómicamente el Refresh Token opaco y emite un nuevo Access Token Ed25519 manteniendo el mismo `sid` (`RefreshSessionUseCase.execute`).

- **Autenticación requerida**: Cookie `HttpOnly` `sitecorp_rt` (`Path=/api/v1/auth`).
- **Autorización necesaria**: Sesión activa, token vigente no revocado y usuario en estado `active` (`mustChangePassword === false`).
- **Protección CSRF (Obligatoria)**:
  1. Verificación estricta de `Origin` (o `Referer` si `Origin` está ausente) contra `SITECORP_HTTP_ALLOWED_ORIGINS`. Si ambos faltan o no pertenecen a la lista blanca -> `403 Forbidden` (`CSRF_INVALID`).
  2. Verificación de coincidencia en tiempo constante (`crypto.timingSafeEqual`) entre la cabecera `X-CSRF-Token` y la cookie `__Host-sitecorp_csrf` (o `sitecorp_csrf` en HTTP local).
  3. Verificación criptográfica HMAC-SHA256 del token CSRF comprobando que su firma corresponde al `sid` de la sesión que se está rotando.
- **Límite de tamaño de body (`bodyLimit`)**: `1024` bytes (1 KiB). Cuerpo `{}` o vacío.
- **Rate Limiting**:
  - Por IP: `20` peticiones / 60 segundos.
  - Por hash de cookie (`SHA-256(sitecorp_rt)`): `10` peticiones / 60 segundos.
- **Comportamiento de Cookies**:
  - En `200 OK`: reemplaza `sitecorp_rt` (`Path=/api/v1/auth`) con `result.newRefreshToken` (`Max-Age` calculado con los segundos restantes hasta `result.refreshTokenExpiresAt`), y rota `__Host-sitecorp_csrf` (`Path=/`) con un nuevo token firmado para el mismo `sid`.
  - En cualquier error `401 Unauthorized` (`TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REUSE_DETECTED`, `SESSION_INVALID`) o `403 USER_SUSPENDED`: borra inmediatamente ambas cookies enviando `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT` con sus `Path` exactos (`Path=/api/v1/auth` para `sitecorp_rt` y `Path=/` para `__Host-sitecorp_csrf`).
- **Esquema de salida (`200 OK`)**:
  ```json
  {
    "data": {
      "accessToken": "eyJhbGciOiJFZERTQSI...",
      "tokenType": "Bearer",
      "expiresInSeconds": 900,
      "csrfToken": "k4m9...1z.672d2284.B7vW...8M"
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T18:45:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `200 OK`, `401 Unauthorized` (`TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REUSE_DETECTED`, `SESSION_INVALID`), `403 Forbidden` (`CSRF_INVALID`, `USER_SUSPENDED`), `423 Locked` (`ACCOUNT_LOCKED`), `429 Too Many Requests`.
- **Eventos de auditoría**: `TOKEN_ROTATED`, `TOKEN_REUSE_DETECTED`.

---

### 3.3 `POST /api/v1/auth/logout`
Revoca la sesión actual (o todas las sesiones del usuario si `allDevices: true`) y limpia las cookies de sesión (`LogoutUseCase.execute`).

- **Autenticación requerida**:
  - **Modalidad A (`Authorization: Bearer <accessToken>`)**: Extrae `userId = claims.sub` y `sessionId = claims.sid` tras verificar el JWT y la sesión. Admite tanto `scope: "api:full"` como `scope: "auth:change_password"`. Es obligatoria cuando se solicita `allDevices: true`.
  - **Modalidad B (Cookie `sitecorp_rt`)**: Permite cerrar la sesión actual incluso cuando el `accessToken` de 15 minutos ya expiró, pasando `rawRefreshToken` a `LogoutUseCase.execute`.
  - Si no se proporciona ni un `Bearer` válido ni la cookie `sitecorp_rt`, la operación es idempotente: limpia las cookies por precaución y devuelve `200 OK` `{ data: { loggedOut: true } }` (salvo que falle la validación CSRF cuando sí había cookie presente).
- **Protección CSRF**: Exigida siempre que la petición transporte la cookie `sitecorp_rt` (`Origin`/`Referer` + `X-CSRF-Token` == `__Host-sitecorp_csrf`).
- **Límite de tamaño de body (`bodyLimit`)**: `2048` bytes (2 KiB).
- **Rate Limiting**: `30` peticiones / 60 segundos por IP y `15` / 60 segundos por usuario/cookie.
- **Esquema de entrada (`additionalProperties: false`)**:
  ```json
  {
    "allDevices": false
  }
  ```
  *(Opcional; por defecto `allDevices: false`).*
- **Comportamiento de Cookies**: Envía **siempre** las cabeceras `Set-Cookie` de borrado (`Max-Age=0`) para `sitecorp_rt` (`Path=/api/v1/auth`) y `__Host-sitecorp_csrf` (`Path=/`).
- **Esquema de salida (`200 OK`)**:
  ```json
  {
    "data": {
      "loggedOut": true
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T18:50:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `200 OK`, `400 Bad Request`, `401 Unauthorized` (si pide `allDevices: true` sin `Bearer` válido), `403 Forbidden` (`CSRF_INVALID`, `FORBIDDEN`), `429 Too Many Requests`.
- **Eventos de auditoría**: `LOGOUT`.

---

### 3.4 `POST /api/v1/auth/change-password`
Cambia la contraseña del usuario autenticado, incrementa `credential.version`, limpia `mustChangePassword` (`status` pasa a `"active"`) y revoca todas las sesiones y refresh tokens previos (`ChangePasswordUseCase.execute`).

- **Autenticación requerida**: `Authorization: Bearer <accessToken>` verificado criptográficamente (`verifyAccessToken`) + verificación stateful de sesión (`verifyAccessTokenSessionState`).
- **Autorización necesaria**:
  - Admite tanto `scope: "api:full"` (`role: "authenticated"`) como `scope: "auth:change_password"` (`role: "pending_password_change"`).
  - El `userId` pasado a `ChangePasswordDto` se toma **exclusivamente** de `req.authContext.user.id` (`claims.sub`), jamás del body JSON.
- **Protección de Origen**: Si la cabecera `Origin` está presente, debe pertenecer a `SITECORP_HTTP_ALLOWED_ORIGINS`.
- **Límite de tamaño de body (`bodyLimit`)**: `4096` bytes (4 KiB).
- **Rate Limiting (ejecutado ANTES de `Argon2ConcurrencyGate`)**:
  - Por IP: `10` peticiones / 60 segundos.
  - Por usuario (`claims.sub`): `5` peticiones / 300 segundos (5 minutos).
- **Concurrencia Argon2id**: Ejecución protegida por `Argon2ConcurrencyGate.run()`.
- **Esquema de entrada (`additionalProperties: false`)**:
  ```json
  {
    "currentPassword": "TempPassword#2026_SiteCorp!",
    "newPassword": "NuevaClave#Definitiva_2026!"
  }
  ```
  - `currentPassword`: string (`1..128` bytes UTF-8).
  - `newPassword`: string (`12..128` bytes UTF-8, validado por `PasswordPolicy`).
- **Comportamiento de Cookies**:
  - En `200 OK`, envía cabeceras `Set-Cookie` de borrado (`Max-Age=0`) para `sitecorp_rt` (`Path=/api/v1/auth`) y `__Host-sitecorp_csrf` (`Path=/`), dado que todas las sesiones anteriores han quedado revocadas en PostgreSQL.
- **Esquema de salida (`200 OK`)**:
  ```json
  {
    "data": {
      "passwordChanged": true,
      "sessionsRevoked": true,
      "reauthenticationRequired": true
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T18:55:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `200 OK`, `400 Bad Request` (`WEAK_PASSWORD`, `SAME_PASSWORD`), `401 Unauthorized` (`INVALID_CREDENTIALS`, `TOKEN_INVALID`, `SESSION_INVALID`), `409 Conflict` (`CONCURRENT_CREDENTIAL_MODIFICATION`), `429 Too Many Requests`, `503 Service Unavailable` (`AUTH_SERVER_BUSY`).
- **Eventos de auditoría**: `PASSWORD_CHANGED`, `LOGIN_FAILED` (`CHANGE_PASSWORD_FAILED`).

---

### 3.5 `GET /api/v1/auth/me`
Devuelve la identidad autenticada y el estado actual de la sesión a partir del `VerifiedSessionState` obtenido en el guard HTTP (`verifyAccessToken` + `verifyAccessTokenSessionState`).

- **Autenticación requerida**: `Authorization: Bearer <accessToken>` + `verifyAccessTokenSessionState()`.
- **Autorización necesaria**:
  - **Exige `claims.scope === "api:full"` y `claims.role === "authenticated"`** (además de `user.status === "active"` y `user.mustChangePassword === false`).
  - Si un usuario en estado `pending_password_change` (con token `scope: "auth:change_password"`) invoca `GET /api/v1/auth/me`, el Paso 6 del guard HTTP lo rechaza con **`403 Forbidden` (`PASSWORD_CHANGE_REQUIRED`)**, garantizando que un token temporal no pueda acceder a ningún endpoint de perfil o negocio (`api:full`).
- **Rate Limiting**: `60` peticiones / 60 segundos por IP y `60` / 60 segundos por `userId` (`claims.sub`).
- **Esquema de salida (`200 OK`)**:
  ```json
  {
    "data": {
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "email": "operador@sitecorp.cu",
        "status": "active",
        "mustChangePassword": false,
        "createdAt": "2026-11-01T10:00:00.000Z",
        "updatedAt": "2026-11-07T12:00:00.000Z"
      },
      "session": {
        "id": "sess_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "role": "authenticated",
        "scope": "api:full",
        "expiresAt": "2026-12-07T12:00:00.000Z",
        "lastActivityAt": "2026-11-07T12:00:00.000Z"
      }
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T19:00:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `200 OK`, `401 Unauthorized` (`TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_INVALID`), `403 Forbidden` (`PASSWORD_CHANGE_REQUIRED`, `USER_SUSPENDED`), `423 Locked` (`ACCOUNT_LOCKED`), `429 Too Many Requests`.

---

### 3.6 `POST /api/v1/auth/admin/users`
Crea administrativamente una nueva cuenta de usuario con contraseña inicial/temporal (`AdminCreateUserUseCase.execute`).

- **Autenticación requerida**: `Authorization: Bearer <accessToken>` + `verifyAccessTokenSessionState()`.
- **Autorización necesaria**:
  - Exige `claims.role === "authenticated"` y `claims.scope === "api:full"` (bloqueado con `403 PASSWORD_CHANGE_REQUIRED` para `pending_password_change`).
  - El Paso 6 del guard resuelve en vivo el `AuthenticatedPrincipal` del operador (`IOperatorPrincipalResolver.resolve(user)`) y verifica `authPolicy.canManageUsers(operator) === true` (verificado también dentro de `AdminCreateUserUseCase`).
- **Límite de tamaño de body (`bodyLimit`)**: `4096` bytes (4 KiB).
- **Rate Limiting**: `30` peticiones / 60 segundos por IP y `15` creaciones / 60 segundos por operador (`claims.sub`).
- **Concurrencia Argon2id**: Ejecución protegida por `Argon2ConcurrencyGate.run()`.
- **Esquema de entrada (`additionalProperties: false` — alineado 1:1 con `AdminCreateUserDto`)**:
  ```json
  {
    "email": "nuevo.especialista@sitecorp.cu",
    "initialPassword": "TempPassword#2026_SiteCorp!",
    "mustChangePassword": true
  }
  ```
  - `email`: string, formato email (`3..254` caracteres).
  - `initialPassword`: string (`12..128` bytes UTF-8, obligatorio en la frontera HTTP y validado por `PasswordPolicy`).
  - `mustChangePassword`: boolean opcional (por defecto `true`, creando al usuario en estado `pending_password_change`).
  - *(Nota: No se acepta ningún campo `role` ni `permissions` en el body, impidiendo cualquier intento de asignación o escalada de privilegios por parámetros HTTP).*
- **Esquema de salida (`201 Created`)**:
  ```json
  {
    "data": {
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440099",
        "email": "nuevo.especialista@sitecorp.cu",
        "status": "pending_password_change",
        "mustChangePassword": true,
        "createdAt": "2026-11-07T18:30:00.000Z",
        "updatedAt": "2026-11-07T18:30:00.000Z"
      }
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T18:30:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `201 Created`, `400 Bad Request` (`VALIDATION_ERROR`, `INVALID_EMAIL`, `WEAK_PASSWORD`), `401 Unauthorized`, `403 Forbidden` (`FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`), `409 Conflict` (`DUPLICATE_EMAIL`), `429 Too Many Requests`, `503 Service Unavailable` (`AUTH_SERVER_BUSY`).
- **Eventos de auditoría**: `USER_CREATED` (incluyendo `createdByOperatorId` y `mustChangePassword`).

---

### 3.7 `PATCH /api/v1/auth/admin/users/:id/status`
Modifica administrativamente el estado de una cuenta (`active`, `suspended`, `deleted`) y revoca todas sus sesiones y refresh tokens si pasa a `suspended` o `deleted` (`AdminUpdateStatusUseCase.execute`).

- **Autenticación requerida**: `Authorization: Bearer <accessToken>` + `verifyAccessTokenSessionState()`.
- **Autorización necesaria**:
  - Exige `claims.role === "authenticated"` y `claims.scope === "api:full"`.
  - Resuelve en vivo el `AuthenticatedPrincipal` del operador (`IOperatorPrincipalResolver.resolve(user)`).
  - Si `status === "deleted"`: exige `authPolicy.canDeleteUser(operator, targetUserId)`.
  - Si `status === "suspended"` o `"active"`: exige `authPolicy.canSuspendUser(operator, targetUserId)`.
  - Prohibición estricta de auto-suspensión o auto-eliminación (`operator.userId !== targetUserId`, garantizada en `IAuthorizationPolicyService`).
- **Límite de tamaño de body (`bodyLimit`)**: `2048` bytes (2 KiB).
- **Rate Limiting**: `30` peticiones / 60 segundos por IP y `30` / 60 segundos por operador (`claims.sub`).
- **Parámetros de ruta (`params`)**:
  - `id`: UUID v4 válido (`createUserId(params.id)`).
- **Esquema de entrada (`additionalProperties: false` — alineado 1:1 con `AdminUpdateStatusDto`)**:
  ```json
  {
    "status": "suspended"
  }
  ```
  - `status`: enum estricto `"active" | "suspended" | "deleted"`.
- **Esquema de salida (`200 OK`)**:
  ```json
  {
    "data": {
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440099",
        "email": "nuevo.especialista@sitecorp.cu",
        "status": "suspended",
        "mustChangePassword": true,
        "updatedAt": "2026-11-07T18:35:00.000Z",
        "deletedAt": null
      }
    },
    "meta": {
      "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-11-07T18:35:00.000Z"
    }
  }
  ```
- **Códigos HTTP**: `200 OK`, `400 Bad Request` (`INVALID_USER_ID`, `VALIDATION_ERROR`), `401 Unauthorized`, `403 Forbidden` (`FORBIDDEN`, `USER_DELETED`, `PASSWORD_CHANGE_REQUIRED`), `404 Not Found` (`USER_NOT_FOUND`), `429 Too Many Requests`.
- **Eventos de auditoría**: `USER_SUSPENDED`, `USER_DELETED`, `USER_ACTIVATED`.
