# SITECORP — FASE 4G.8: VALIDACIÓN REAL DE INFRAESTRUCTURA AUTÓNOMA

**Rama exclusiva:** `inicio-de-sesion-en-backend`  
**Base de partida verificada:** `2aaff4e1250584e4572a6659803ec6953880e690`  
**Rama `main` intacta:** `c4a2875c4acf6ba06e1de9cc181af5822651a93f`  
**Motor de base de datos validado:** `PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2) on x86_64-pc-linux-gnu`

---

## 1. Validación Real sobre PostgreSQL 16 Convencional

Se desplegó y ejecutó un servidor **PostgreSQL 16.15 nativo real** (`127.0.0.1:54332`) —sin utilizar Supabase Cloud ni presentar PGlite como sustituto— aplicando las migraciones `0001` a `0006` sobre una base de datos vacía:

| Métrica | Resultado Verificado en PostgreSQL 16.15 |
|---|---|
| Versión del servidor | `PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2)` |
| Migraciones aplicadas | `0001_sitecorp_auth_schema` a `0006_sitecorp_complete_submodules` (6/6) |
| Tablas base en `public` | **136 tablas** |
| Tablas base en `sitecorp_auth` | **8 tablas** (`users`, `user_credentials`, `sessions`, `account_activation_tokens`, `operator_permissions`, `security_audit_events`, `schema_migrations`, `transactional_email_outbox`) |
| Total de tablas base | **144 tablas** |
| Índices creados | **259 índices** |
| Constraints (PK, FK, UNIQUE, CHECK) | **1.308 constraints** |
| Triggers PL/pgSQL activos | **29 triggers** |
| Rollback y reejecución idempotente (`0006`) | Verificado (`0` tablas de `0006` tras rollback; `24` tablas restauradas tras reaplicar; `0` migraciones pendientes en segunda pasada) |
| Bloqueos concurrentes (`SELECT ... FOR UPDATE`) | Verificado con 2 conexiones TCP independientes (`pg.PoolClient`), confirmando error SQLSTATE `55P03` (`lock_not_available`) bajo `lock_timeout = '150ms'` |
| Respaldo y restauración (`pg_dump` + `pg_restore`) | Verificado en formato custom (`-Fc`) restaurando sobre una base limpia (`sitecorp_pg16_fase4g8_restored`) con **144 tablas** y **100 % de coincidencia SHA-256** |

---

## 2. Auditoría y Endurecimiento de la Pasarela Autónoma (`src/lib/supabase.ts` y `/api/v1/submodules/*`)

### 2.1 Rutas Expuestas y Aliases Compatibles
- `POST /api/v1/submodules/query/:table` (y alias `POST /api/v1/domain/rest/:tableName`)
- `POST /api/v1/submodules/rpc/:rpcName` (y alias `POST /api/v1/domain/rpc/:rpcName`)
- `POST /api/v1/submodules/edge/:functionName` (y alias `POST /api/v1/domain/functions/:functionName`)

### 2.2 Controles de Seguridad en Servidor (`PostgresSubmodulesRepository`)
1. **Denegación por defecto de tablas (`ALLOWED_REST_TABLES`)**:
   - Solo las tablas de negocio explícitamente registradas están permitidas.
   - Cualquier intento de consultar tablas internas (`sitecorp_auth.users`, `user_credentials`, `account_activation_tokens`, `pg_shadow` o tablas arbitrarias) devuelve **`403 FORBIDDEN` (`FORBIDDEN_GATEWAY_TABLE`)**.
2. **Validación estricta de identificadores y columnas contra `information_schema.columns`**:
   - Todo nombre de columna en `select`, `filters`, `order` o `values` se valida contra `/^[a-z_][a-z0-9_]*$/` y contra el catálogo real de columnas de la tabla en `information_schema.columns`.
   - Cualquier columna inexistente o intento de inyección SQL devuelve **`400 BAD_REQUEST` (`INVALID_GATEWAY_OPERATION`)**.
3. **Aislamiento multiempresa obligatorio por ámbito (`scope`)**:
   - `company`: exige `companyClientId` válido y membresía activa verificada mediante `runAuthorizedCompanyOperation`, inyectando `company_client_id = $N` en el predicado SQL.
   - `catalog`: lectura para usuarios autenticados; escritura restringida a administradores de plataforma (`security.admin`).
   - `user`: restringe automáticamente `user_id = <authenticatedUserId>` en lecturas y escrituras.
   - `platform`: restringido a operadores con `security.admin`.
4. **Lista blanca cerrada de RPC (`ALLOWED_AUTONOMOUS_RPCS`) y funciones (`ALLOWED_AUTONOMOUS_EDGE_FUNCTIONS`)**:
   - Cualquier RPC o función fuera de la lista blanca devuelve **`403 FORBIDDEN` (`FORBIDDEN_GATEWAY_RPC` / `FORBIDDEN_GATEWAY_EDGE_FUNCTION`)**.
5. **Rechazo explícito de características PostgREST no soportadas (`UNSUPPORTED_POSTGREST_FEATURE`)**:
   - Si una consulta solicita joins embebidos de PostgREST (`tabla_relacionada(col1, col2)`), el puente rechaza la operación explícitamente con código **`UNSUPPORTED_POSTGREST_FEATURE` (HTTP 400)** en lugar de fallar silenciosamente.

---

## 3. Operaciones Operativas y Seguridad de Despliegue (`services/auth-api/ops/`)

- `services/auth-api/ops/bootstrap-local-pg16.sh`: Aprovisiona e inicia el servidor PostgreSQL 16.15 aislado en `127.0.0.1:54332`.
- `services/auth-api/ops/postgres16-least-privilege.sql`: Define y verifica los roles separados `sitecorp_migrator` (DDL de migraciones) y `sitecorp_app_runtime` (DML estricto en tiempo de ejecución, sin permisos DDL ni borrado de `schema_migrations`).
- `services/auth-api/ops/nginx-https-etecsa-vps.conf`: Configuración de proxy inverso Nginx con TLS 1.2/1.3, HSTS, cabeceras de seguridad, ocultación de puertos internos (`4000` y `5432`) y enrutamiento de `/api/v1/` hacia el backend autónomo en el VPS de ETECSA.
- `services/auth-api/ops/backup-and-restore-pg16.sh`: Script ejecutable de copia de seguridad (`pg_dump -Fc`), verificación de catálogo (`pg_restore --list`), checksum SHA-256 y restauración verificada.
- `services/auth-api/ops/docker-compose.pg16.yml`: Topología reproducible para despliegue contenerizado con PostgreSQL 16-alpine y `sitecorp-auth-api`.
