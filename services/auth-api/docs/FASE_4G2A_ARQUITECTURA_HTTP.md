# SITECORP — FASE 4G.2A: ARQUITECTURA DE LA CAPA HTTP DE AUTENTICACIÓN PROPIA

- **Servicio**: `@sitecorp/auth-api` (`services/auth-api/`)
- **Rama**: `inicio-de-sesion-en-backend`
- **Commit base**: `50b567f8804b7e0e61243939a49593b65617398d`
- **Estado**: Diseño Arquitectónico Auditado y Cerrado (Fase 4G.2A.1 — sin implementación productiva)

---

## 1. Objetivo y Principios Arquitectónicos

El objetivo de la Fase 4G.2A / 4G.2A.1 es cerrar el diseño arquitectónico y de seguridad de la capa de transporte HTTP para el backend propio de autenticación de SiteCorp (`services/auth-api/`), manteniendo estricto aislamiento respecto al frontend actual y sin depender de Supabase Auth, GoTrue, Keycloak ni Ory Kratos.

### Principios rectores:
1. **Separación estricta de capas (Clean / Hexagonal Architecture)**:
   - **`domain/`**: Entidades (`AuthUser`, `AuthSession`, `RefreshToken`, `SecurityEvent`), objetos de valor (`UserId`, `Email`, `PasswordPolicy`) y errores de dominio (`DomainError` y subclases). Cero acoplamiento a HTTP.
   - **`application/`**: Casos de uso (`LoginUseCase`, `RefreshSessionUseCase`, `LogoutUseCase`, `ChangePasswordUseCase`, `AdminCreateUserUseCase`, `AdminUpdateStatusUseCase` y el caso de uso de consulta `GetAuthenticatedIdentityUseCase` documentado para `/me`) y DTOs. Cero conocimiento de cabeceras HTTP, cookies o códigos de estado.
   - **`infrastructure/`**: Adaptadores PostgreSQL (`PostgresTransactionManager`, repositorios SQL), adaptadores criptográficos (`Argon2idPasswordHasher`, `JoseTokenService`, `verifyAccessTokenSessionState`), adaptador de política de autorización respaldado por base de datos y configuración (`crypto-config.ts`, `http-config.ts`).
   - **`presentation/http/` (futura capa en 4G.2B)**: Servidor Fastify, esquemas de validación de entrada/salida (Ajv), hooks de autenticación/autorización de 7 pasos, gestión de cookie `HttpOnly` (`sitecorp_rt`), protección CSRF firmada (`__Host-sitecorp_csrf`), control de concurrencia de Argon2id (`Argon2ConcurrencyGate`), rate-limiting dual y mapeo canónico de errores a respuestas JSON.
2. **Arranque seguro (Fail-Closed Bootstrapping)**:
   - El servidor HTTP no podrá iniciar ni abrir el socket de escucha si `loadCryptoConfigFromEnv()`, `loadHttpConfigFromEnv()` o la verificación de conectividad/esquema de PostgreSQL fallan.
   - En entorno `"production"`:
     - `requireSessionId: true` es obligatorio e imposible de desactivar.
     - `SITECORP_HTTP_ALLOWED_ORIGINS` debe definir explícitamente la lista blanca de orígenes HTTPS válidos (nunca `*` ni vacío).
     - `SITECORP_CSRF_HMAC_SECRET` debe ser un secreto criptográfico de al menos 32 bytes (256 bits) de entropía.
3. **Testabilidad determinista sin abrir puertos de red (`fastify.inject()`)**:
   - La factoría de la aplicación HTTP (`buildAuthHttpServer(deps)`) recibirá todas sus dependencias inyectadas, permitiendo ejecutar la batería de pruebas HTTP en memoria (`fastify.inject()`) contra `PGlite` + `Argon2idPasswordHasher` + `JoseTokenService` sin abrir puertos TCP del sistema operativo.

---

## 2. Evaluación y Selección del Framework HTTP: Fastify v5

Se selecciona **Fastify v5** como framework HTTP para `services/auth-api/`.

### 2.1 Justificación técnica frente a alternativas

| Criterio | Fastify v5 (Seleccionado) | Express 4/5 (Descartado) | Node `http` puro (Descartado) |
| :--- | :--- | :--- | :--- |
| **Compatibilidad TypeScript y ESM** | Nativa, tipado estricto de `FastifyRequest`, `FastifyReply` y soporte ESM completo. | Tipado externo (`@types/express`), manejo frágil de promesas en middlewares legacy. | Requiere construir router, body parser, serializador y validación desde cero. |
| **Validación de entrada y serialización** | Integración nativa con **JSON Schema (Ajv)** compilado en el arranque + `additionalProperties: false` y `removeAdditional: false` por ruta. | Requiere middlewares manuales por ruta; propenso a omisiones. | Manual. |
| **Ciclo de vida de petición (Hooks)** | Ciclo determinista (`onRequest` -> `preParsing` -> `preValidation` -> `preHandler` -> `handler` -> `onSend` -> `onError` -> `onResponse`). | Cadena lineal `next(err)` propensa a ejecuciones accidentales tras enviar respuesta. | No existe. |
| **Gestión centralizada de errores** | `setErrorHandler` y `setNotFoundHandler` asíncronos y tipados que garantizan que ningún error interno devuelva `200 OK` ni filtre stack traces. | Frágil ante promesas no capturadas. | Manual. |
| **Cookies seguras y cabeceras** | `@fastify/cookie`, `@fastify/helmet`, `@fastify/cors` mantenidos oficialmente por Fastify. | `cookie-parser` sin aislamiento de ciclo de vida. | Manual. |
| **Logging estructurado sin secretos** | **Pino** integrado con soporte nativo de `redact` (censura automática de `req.headers.authorization`, `req.headers.cookie`, `reply.headers["set-cookie"]`, `password`, `rawRefreshToken`, etc.) y correlación `requestId`. | Sin logger estructurado nativo. | Sin logger. |
| **Huella en VPS** | Bajo consumo de RAM/CPU y alto throughput, ideal para un VPS autogestionado con memoria acotada. | Mayor sobrecarga por cadena de middlewares. | Mínimo consumo, pero alto riesgo al reimplementar parsers HTTP. |

### 2.2 Dependencias previstas para la Fase 4G.2B (sin instalar en 4G.2A / 4G.2A.1)

En `services/auth-api/package.json` se documenta la futura incorporación (exclusivamente cuando se autorice la Fase 4G.2B) de:
- `fastify` (`^5.x`): Motor HTTP principal, validación JSON Schema con Ajv y logger Pino integrado.
- `@fastify/cookie` (`^11.x`): Lectura y escritura segura de cookies (`HttpOnly`, `Secure`, `SameSite`, `Path`).
- `@fastify/cors` (`^10.x`): Control estricto de CORS por lista blanca de orígenes permitidos.
- `@fastify/helmet` (`^13.x`): Cabeceras de endurecimiento HTTP (`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy`).

---

## 3. Estructura de Directorios Unificada (Fase 4G.2B)

Todos los documentos de diseño utilizan de forma uniforme la siguiente ubicación dentro de `services/auth-api/`:

```text
services/auth-api/
├── src/
│   ├── domain/                         # Entidades, Value Objects, PasswordPolicy, DomainError
│   ├── interfaces/                     # Contratos de repositorios, servicios y autorización
│   ├── application/                    # Casos de uso (Login, Refresh, Logout, ChangePassword, Admin, GetMe)
│   ├── infrastructure/
│   │   ├── config/
│   │   │   ├── crypto-config.ts        # Configuración Argon2id y Ed25519 JWT
│   │   │   └── http-config.ts          # (4G.2B) Configuración HTTP, proxy, cookies, CSRF, CORS y límites
│   │   ├── crypto/                     # Argon2idPasswordHasher, JoseTokenService, SessionStateVerifier
│   │   └── postgres/                   # PostgresTransactionManager, repositorios SQL y AuthPolicy
│   └── presentation/                   # (Nueva capa aislada para Fase 4G.2B)
│       └── http/
│           ├── server.ts               # Factoría buildAuthHttpServer(deps) y ciclo de vida (start/stop)
│           ├── types.ts                # Augmentation de FastifyRequest (authContext, requestId)
│           ├── schemas/                # Esquemas estrictos JSON Schema (Ajv) con additionalProperties: false
│           ├── plugins/
│           │   ├── security-headers.ts # Helmet, Cache-Control: no-store, X-Request-Id
│           │   ├── cookies-csrf.ts     # Emisión/borrado de sitecorp_rt y __Host-sitecorp_csrf + HMAC CSRF
│           │   ├── error-handler.ts    # Mapeo uniforme DomainError -> HTTP Status + JSON seguro
│           │   └── auth-guard.ts       # Pipeline de 7 pasos: verifyAccessToken + verifyAccessTokenSessionState
│           ├── concurrency/
│           │   ├── argon2-concurrency-gate.ts # Semáforo y cola FIFO acotada anti-OOM para Argon2id
│           │   └── rate-limiter.ts     # Rate limiter dual (IP + cuenta/usuario/cookie) con cota LRU
│           └── routes/
│               ├── auth.routes.ts      # /api/v1/auth/{login,refresh,logout,change-password,me}
│               ├── admin.routes.ts     # /api/v1/auth/admin/users, /api/v1/auth/admin/users/:id/status
│               └── health.routes.ts    # /health/live, /health/ready
```

---

## 4. Composición de Dependencias (Dependency Injection Explícito)

No se utilizarán contenedores basados en reflexión ni decoradores (`inversify`, `tsyringe`), manteniendo composición explícita y tipada en TypeScript:

```text
[Variables de Entorno VPS / Configuración]
       │
       ├──► loadCryptoConfigFromEnv(env) ──► AuthCryptoConfig (Fail-Closed)
       ├──► loadHttpConfigFromEnv(env)   ──► AuthHttpConfig   (Fail-Closed)
       └──► loadPgPoolConfigFromEnv(env) ──► pg.Pool
                                                │
                                                ▼
                                   PostgresTransactionManager
                                    /      |         |       \
                                   ▼       ▼         ▼        ▼
                             UserRepo  CredRepo  SessionRepo  AuditService
                                   \       |         |        /
     Argon2idPasswordHasher ────────► [ Casos de Uso (Application) ] ◄──── JoseTokenService
               │                                │                                │
               ▼                                ▼                                ▼
     Argon2ConcurrencyGate            buildAuthHttpServer(deps)      verifyAccessTokenSessionState
```

### Contenedor `AuthHttpDependencies`:
```ts
export interface AuthHttpDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly auditService: ISecurityAuditService;
  readonly authPolicy: IAuthorizationPolicyService;
  readonly principalResolver: IOperatorPrincipalResolver;
  readonly loginUseCase: ILoginUseCase;
  readonly refreshSessionUseCase: IRefreshSessionUseCase;
  readonly logoutUseCase: ILogoutUseCase;
  readonly changePasswordUseCase: IChangePasswordUseCase;
  readonly adminCreateUserUseCase: IAdminCreateUserUseCase;
  readonly adminUpdateStatusUseCase: IAdminUpdateStatusUseCase;
  readonly argon2Gate: Argon2ConcurrencyGate;
  readonly rateLimiter: IRateLimiter;
  readonly csrfTokenService: CsrfTokenService;
  readonly readinessCheck?: () => Promise<boolean>;
}
```

---

## 5. Topología de Proxy Inverso, `trustProxy` y Orígenes

### 5.1 Configuración segura de `trustProxy` (Prevención de IP/Protocol Spoofing)
- **Prohibición de `trustProxy: true` global**: Configurar `trustProxy: true` en Fastify permitiría a cualquier cliente externo falsificar `X-Forwarded-For` o `X-Forwarded-Proto` si el puerto del proceso llegara a ser alcanzable directamente o a través de una ruta no filtrada, neutralizando el rate limiting por IP.
- **Política estricta**:
  - Por defecto, `trustProxy` es `false` (conexión directa en tests o desarrollo local).
  - En producción tras Nginx o Caddy, `SITECORP_HTTP_TRUSTED_PROXIES` debe especificar explícitamente las direcciones IP o subredes CIDR del proxy inverso local (por ejemplo `127.0.0.1,::1`), y el servidor Fastify escuchará únicamente en loopback (`SITECORP_HTTP_HOST=127.0.0.1`).
  - El proxy inverso (Nginx/Caddy) debe **sobrescribir** (nunca concatenar a ciegas sin validación) `X-Forwarded-For` con `$remote_addr` (o `X-Real-IP`) y fijar `X-Forwarded-Proto $scheme`.

### 5.2 Plantilla de referencia para Nginx / Caddy (Sin asumir dominio final fijo)
Dado que el dominio definitivo de producción se define por configuración de despliegue, `services/auth-api` no codifica ningún dominio fijo en el código fuente:
- Todos los orígenes permitidos se leen de `SITECORP_HTTP_ALLOWED_ORIGINS` (lista separada por comas de orígenes exactos con esquema `https://`, sin barra final ni comodines `*`).
- Configuración requerida en Nginx para el bloque `/api/v1/auth/`:
  ```nginx
  location /api/v1/auth/ {
      proxy_pass http://127.0.0.1:4010;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Request-Id $request_id;
      client_max_body_size 16k;
  }
  ```

---

## 6. Ciclo de Vida del Proceso: Arranque, Readiness, Liveness y Cierre Ordenado

### 6.1 Secuencia de Arranque (Fail-Closed Startup)
1. **Validación de configuración y secretos**:
   - Invoca `loadCryptoConfigFromEnv(process.env)` y `loadHttpConfigFromEnv(process.env)`.
   - Si falta alguna clave Ed25519 en producción, si la clave pública no corresponde a la privada, si `requireSessionId` no es `true`, si falta `SITECORP_CSRF_HMAC_SECRET` (>= 32 bytes), o si `SITECORP_HTTP_ALLOWED_ORIGINS` es inválido o contiene `*`, el proceso aborta inmediatamente (`exit(1)`).
2. **Inicialización y verificación de PostgreSQL**:
   - Crea el `pg.Pool` con timeouts estrictos (`connectionTimeoutMillis: 5000`, `idleTimeoutMillis: 30000`, `statement_timeout: 10000`).
   - Ejecuta `SELECT 1` y verifica la tabla `sitecorp_auth.schema_migrations` antes de aceptar tráfico.
3. **Apertura del servidor Fastify**:
   - Registra plugins de cabeceras, CORS, cookies, CSRF, manejador de errores y rutas.
   - Escucha en `127.0.0.1:<PORT>`.

### 6.2 Endpoints Operativos Internos (Health Checks)
- **`GET /health/live` (Liveness)**:
  - Sin autenticación ni consultas a base de datos. Devuelve `200 OK` (`{ "status": "ok" }`).
- **`GET /health/ready` (Readiness)**:
  - Ejecuta `SELECT 1` con timeout de `1500 ms` contra PostgreSQL y comprueba que el servidor no esté en `shuttingDown`.
  - Devuelve `200 OK` (`{ "status": "ready" }`) o `503 Service Unavailable` (`{ "status": "not_ready" }`) sin filtrar información interna.

### 6.3 Cierre Ordenado (Graceful Shutdown)
Ante señales `SIGTERM` o `SIGINT`:
1. Marca `shuttingDown = true` (`GET /health/ready` pasa a devolver `503`).
2. Invoca `await fastify.close()` para dejar de aceptar nuevas conexiones y drenar peticiones en curso (timeout máximo `10 s`).
3. Cierra `Argon2ConcurrencyGate` esperando a los hashes activos y rechazando la cola pendiente.
4. Cierra el pool de conexiones PostgreSQL (`await pgPool.end()`).
5. Finaliza con código `0`.
