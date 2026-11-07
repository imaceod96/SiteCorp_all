# SITECORP — FASE 4G.5: AUDITORÍA REAL DE SUPABASE CLOUD Y PLAN TÉCNICO DE MIGRACIÓN COMPLETA

- **Fecha de ejecución**: Noviembre 2026
- **Proyecto objetivo Supabase**: `SiteCorp` (`ref: xvswjkpoeccgpiewptur`)
- **Región**: `us-east-1`
- **Motor PostgreSQL Cloud**: `17.6.1.166`
- **Rama Git exclusiva**: `inicio-de-sesion-en-backend`
- **Estado de producción**: Solo lectura / Introspección no destructiva verificada. Cero alteraciones sobre datos productivos.

---

## 1. RESUMEN EJECUTIVO Y HALLAZGOS DE LA INSTANCIA REAL

A través de la API de gestión de Supabase y consultas SQL de solo lectura parametrizadas, se auditó exhaustivamente la infraestructura productiva real de SiteCorp. Se contrastaron las definiciones del repositorio con el estado real de la base de datos en la nube.

### Métricas Principales de Producción
| Componente | Conteo Real | Observaciones Críticas |
| :--- | :---: | :--- |
| **Usuarios en `auth.users`** | 5 | 4 confirmados, 0 baneados, 4 con correo confirmado. |
| **Perfiles en `public.profiles`** | 4 | Correspondencia 1:1 con cuentas activas de personal. |
| **Inquilinos / Empresas (`company_clients`)** | 2 | SiteCorp opera actualmente como multiempresa con 2 clientes dados de alta. |
| **Trabajadores (`workers`)** | 186 | 186 fichas completas de trabajadores activos y formalizados. |
| **Contratos Laborales (`employment_contracts`)** | 196 | Contratos individuales con condiciones salariales y cláusulas. |
| **Movimientos Vacacionales (`worker_vacation_movements`)** | 756 | Historial transaccional intensivo de devengos y descansos. |
| **Tablas Base en `public`** | 82 | Tablas relacionales con integridad referencial estricta. |
| **Políticas RLS en `public`** | 368 | Políticas activas de control de acceso a nivel de fila. |
| **Funciones Almacenadas / RPC** | 120+ | Procedimientos `SECURITY DEFINER` y helpers de autorización. |
| **Triggers en `public`** | 70+ | Disparadores automáticos de consistencia y jerarquía. |
| **Buckets de Storage** | 5 | `avatars`, `document-templates`, `documents`, `platform_documents`, `worker_documents`. |
| **Archivos en Storage** | 16 | 8 plantillas, 5 documentos generales, 2 plataforma, 1 expediente trabajador. |
| **Edge Functions Desplegadas** | 7 | `create-platform-admin`, `create-sitecorp-user`, `analyze-document-template`, `delete-workspace`, `generate-document-batch-zip`, `change-initial-password`, `delete-platform-user`. |

---

## 2. DISCREPANCIAS DETECTADAS Y RECONCILIACIÓN TÉCNICA

### Discrepancia 1: Credenciales Heredadas en `public.user_credentials`
- **Hallazgo Real**: Se detectaron 4 registros en `public.user_credentials` con prefijo de hash `$2a$10$` (Bcrypt, costo 10) y una tabla accesoria `public.user_password_lifecycle`.
- **Riesgo**: SiteCorp ha adoptado el estándar superior **Argon2id v19** (`memoryCost: 19456 KiB, timeCost: 2, parallelism: 1`) en `sitecorp_auth.credentials`. Intentar validar contraseñas directamente sobre hashes Argon2id sin un mecanismo de transición bloquearía a los usuarios migrados.
- **Solución Implementada**: Mecanismo de **tokens criptográficos de un solo uso para activación** (`sitecorp_auth.activation_tokens`). No se asume que los usuarios conozcan contraseñas temporales ni se transmiten contraseñas en claro por correo electrónico. Al consumir el enlace único, se genera el hash definitivo Argon2id y se registra la sesión inicial.

### Discrepancia 2: Despliegue de Edge Functions vs Endpoints de Backend Propio
- **Hallazgo Real**: En Supabase Cloud coexisten 7 Edge Functions en Deno:
  1. `create-platform-admin`: Creación de administradores.
  2. `create-sitecorp-user`: Alta de usuarios institucionales.
  3. `change-initial-password`: Cambio forzado de credencial inicial.
  4. `delete-platform-user`: Baja lógica o revocación de operadores.
  5. `analyze-document-template`: Análisis sintáctico y extracción de variables en plantillas de documentos.
  6. `generate-document-batch-zip`: Compresión y empaquetado de lotes documentales en ZIP.
  7. `delete-workspace`: Eliminación en cascada de espacios de trabajo y tenencias.
- **Reconciliación**:
  - Las funciones 1, 2, 3 y 4 quedan **completamente absorbidas y superadas** por la API Fastify de SiteCorp (`POST /api/v1/auth/admin/users`, `PATCH /api/v1/auth/admin/users/:id/status`, `POST /api/v1/auth/activate` y `POST /api/v1/auth/change-password`).
  - Las funciones 5, 6 y 7 serán integradas como controladores asíncronos en los módulos de backend de documentos y nómina (`services/document-engine`), eliminando la dependencia de Deno Deploy / Supabase Edge Runtime.

### Discrepancia 3: Jerarquía Multiempresa (`company_client_id` vs `organization_entity_id`)
- **Hallazgo Real**:
  - Tablas de nivel empresa (`workers`, `employment_contracts`, `audit_events`, `candidates`, `company_client_roles`) portan `company_client_id UUID NOT NULL REFERENCES company_clients(id)`.
  - Tablas de nivel estructura organizativa (`organization_positions`, `organization_areas`) portan `organization_entity_id UUID NOT NULL REFERENCES organization_entities(id)`.
- **Reconciliación**:
  - En `sitecorp_auth.users` se añadió la columna `tenant_id UUID NULL` mediante la migración versionada `0003_sitecorp_auth_activation_tokens.design.sql`. Esto vincula a cada operador con su empresa cliente correspondiente para aislar las consultas a nivel de transporte y persistencia.

---

## 3. ARQUITECTURA DE MIGRACIÓN DE USUARIOS: TOKENS DE UN SOLO USO

Para cumplir estrictamente con el principio de mínima exposición y no asumir que los usuarios conocen una clave temporal ni transmitir contraseñas por correo:

```
[Administrador / Script de Migración]
       │
       ▼
POST /api/v1/auth/admin/users/:id/activation-token
       │
       ├── Genera 32 bytes de entropía CSPRNG (base64url)
       ├── Calcula SHA-256(rawToken)
       ├── Invalida tokens previos pendientes para el usuario
       ├── Inserta en `sitecorp_auth.activation_tokens` (expira en 24h, used_at = NULL)
       └── Retorna enlace seguro de activación: https://app.sitecorp.cu/activar?token=<rawToken>

[Usuario Migrado]
       │
       ▼ Abre enlace seguro en navegador
       ▼ Introduce nueva contraseña personal (mínimo 12 caracteres, mayúsculas, dígitos, símbolos)
POST /api/v1/auth/activate { token, newPassword }
       │
       ├── Rate Limiting por IP (anti-fuerza bruta)
       ├── Verificación de hash SHA-256 en `sitecorp_auth.activation_tokens`
       ├── Comprobación fail-closed: token existe, no ha expirado y used_at IS NULL
       ├── Validación contra `PasswordPolicy` (entropía mínima)
       │
       └── Transacción ACID única:
             ├── Marca `used_at = now()`, IP y User-Agent
             ├── Genera hash Argon2id v19 para la nueva contraseña
             ├── Actualiza `sitecorp_auth.credentials` (versión incrementada)
             ├── Actualiza `sitecorp_auth.users`: must_change_password = false, status = 'active'
             ├── Revoca todas las sesiones anteriores
             └── Emite evento de auditoría `USER_ACTIVATED` y `PASSWORD_CHANGED`
```

### Propiedades de Seguridad Garantizadas
1. **Anti-Replay**: Un token consumido (`used_at IS NOT NULL`) es rechazado de inmediato con `400 TOKEN_ALREADY_USED`.
2. **Expiración Estricta**: Tokens con más de 24 horas son rechazados con `401 TOKEN_EXPIRED`.
3. **Cero Secretos en Claro**: La base de datos almacena únicamente el hash SHA-256. Un atacante con acceso a la base de datos no puede activar cuentas ajenas.
4. **Resistencia a Ataques de Fuerza Bruta**: Con 256 bits de entropía CSPRNG, la probabilidad de colisión es inferior a $2^{-128}$. Adicionalmente, el endpoint cuenta con limitador de tasa a nivel de transporte (10 intentos por minuto por IP).

---

## 4. INVENTARIO REAL DE BUCKETS Y ESTRATEGIA DE MIGRACIÓN DE STORAGE

| Bucket | Visibilidad | Límite Tamaño | MIME Types | Total Objetos Reales | Destino en VPS / On-Premise |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `avatars` | Privado | 2 MB | `image/png`, `jpeg`, `webp` | 0 | Directorio `/var/lib/sitecorp/storage/avatars` |
| `document-templates` | Privado | 10 MB | Cualquiera | 8 | Directorio `/var/lib/sitecorp/storage/templates` |
| `documents` | Privado | Sin límite | Cualquiera | 5 | Directorio `/var/lib/sitecorp/storage/documents` |
| `platform_documents`| Privado | Sin límite | Cualquiera | 2 | Directorio `/var/lib/sitecorp/storage/platform` |
| `worker_documents` | Privado | Sin límite | Cualquiera | 1 | Directorio `/var/lib/sitecorp/storage/workers` |

### Procedimiento de Descarga y Reconciliación (Sin Interrupción de Servicio)
1. **Extracción Segura**:
   - Mediante script Node.js con streaming directo desde la API de Storage (`storage/v1/object/authenticated/...`), se descargan los 16 objetos calculando su hash SHA-256 en origen.
2. **Almacenamiento Local S3-Compatible**:
   - Despliegue de MinIO o servicio de ficheros local con cuotas de disco en el VPS de ETECSA.
3. **Verificación de Integridad Cero-Corrupción**:
   - Re-cálculo de SHA-256 tras la copia local y verificación contra el inventario de Supabase.

---

## 5. EQUIVALENTES SEGUROS DE RLS Y REEMPLAZO DE PROCEDIMIENTOS RPC

En el entorno soberano PostgreSQL:
1. **Aislamiento Multi-Inquilino**:
   - La capa HTTP Fastify autentica la petición y establece el contexto de transacción en PostgreSQL mediante variables de sesión locales:
     ```sql
     SET LOCAL sitecorp.current_user_id = '<user-uuid>';
     SET LOCAL sitecorp.current_tenant_id = '<company-client-uuid>';
     ```
   - Las consultas filtran de forma determinista por `company_client_id` o `organization_entity_id`, garantizando que ninguna empresa pueda leer o mutar datos de otra.
2. **Reemplazo de Funciones RPC**:
   - Las 7 funciones de acceso a plantilla (`link_worker_to_position`, etc.) se ejecutan en servicios TypeScript con transacciones ACID controladas (`ITransactionManager.runInTransaction`), manteniendo pruebas unitarias y logging estructurado Pino.

---

## 6. CONSULTAS SQL DE AUDITORÍA ENTREGADAS

Se generó el archivo parametrizado de solo lectura:
- **Ruta**: `services/auth-api/scripts/audit-supabase-queries.sql`
- **Permisos requeridos**: Únicamente privilegios de lectura (`SELECT`) sobre catálogos del sistema e `information_schema`.
- **Garantías**:
  - No ejecuta `INSERT`, `UPDATE`, `DELETE`, `DROP` ni `ALTER`.
  - No adquiere bloqueos exclusivos de tabla.
  - Ofusca o trunca cualquier campo sensible (prefijo de hashes, conteo de filas, etc.).

---

## 7. MATRIZ DE RIESGOS Y MEDIDAS DE MITIGACIÓN

| Riesgo Identificado | Nivel | Mitigación Implementada |
| :--- | :---: | :--- |
| **Credenciales Bcrypt heredadas en Supabase** | Alto | Implementación de flujo de activación con tokens CSPRNG y actualización transparente a Argon2id v19. |
| **Fugas de aislamiento entre empresas** | Crítico | Validación estricta de `tenant_id` en migración `0003`, índices dedicados y suite de pruebas de aislamiento multiempresa. |
| **Pérdida de archivos de expedientes** | Medio | Verificación previa del inventario real (16 objetos) con doble verificación SHA-256. |
| **Bloqueo de usuarios con `mustChangePassword`** | Medio | Ingesta de tokens de activación individuales que reemplazan la necesidad de recordar claves temporales. |
