# SITECORP — PLAN DE MIGRACIÓN INTEGRAL DE SUPABASE A INFRAESTRUCTURA PROPIA
**Fase:** 4G.3 — Tarea 2: Plan de Migración Técnica  
**Estado:** Documento de Arquitectura y Procedimiento Operativo  
**Ubicación:** `services/auth-api/docs/FASE_4G3_PLAN_MIGRACION_SUPABASE.md`

---

## 1. RESUMEN EJECUTIVO Y OBJETIVOS ESTRATÉGICOS

Este documento establece la estrategia y el procedimiento técnico paso a paso para migrar el sistema **SiteCorp** desde **Supabase Cloud** hacia una infraestructura completamente soberana, auto-hospedada y gestionada sobre un servidor virtual privado (**VPS de ETECSA**) corriendo Linux Debian 12 / Ubuntu 22.04 LTS con PostgreSQL 16 y el backend autónomo Node.js/Fastify.

### Objetivos Clave
1. **Soberanía de Datos y Operatividad en Cuba:** Eliminar toda dependencia de servicios SaaS extranjeros sujetos a latencia de red, bloqueos geográficos o cambios unilaterales de términos.
2. **Preservación Estricta de la Integridad Relacional:** Conservar sin variación los identificadores UUID de usuarios, trabajadores, empresas, contratos y expedientes.
3. **Seguridad Endurecida:** Reemplazar el motor de autenticación por el stack criptográfico propio basado en **Argon2id** (RFC 9106) y tokens **Ed25519** (RFC 8037).
4. **Cero Pérdida de Información y Mínima Ventana de Inactividad:** Migración atómica con plan de contingencia y rollback validado.

---

## 2. PLAN DE MIGRACIÓN POR FASES TÉCNICAS

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     FASE 0      │    │     FASE 1      │    │     FASE 2      │
│  Aprovisionar   │───>│  Migración de   │───>│  Migración de   │
│  PostgreSQL en  │    │  Identidades y  │    │  Datos y Tablas │
│   VPS ETECSA    │    │   UUIDs Auth    │    │   del Negocio   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     FASE 3      │    │     FASE 4      │    │     FASE 5      │
│   Desacople y   │───>│  Migración de   │───>│  Conexión del   │
│ Compatibilidad  │    │   Archivos y    │    │  Frontend y     │
│       RLS       │    │     Storage     │    │   Corte Final   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

### FASE 0: PREPARACIÓN Y ENDURECIMIENTO DE LA BASE DE DATOS DESTINO

1. **Instalación de PostgreSQL 16 en el VPS:**
   - Base de datos configurada con codificación `UTF-8` y locale `C.UTF-8` o `es_CU.UTF-8`.
   - Parámetros de memoria optimizados para VPS de 4 GB RAM (`shared_buffers = 1GB`, `work_mem = 16MB`, `maintenance_work_mem = 256MB`).
2. **Creación de Esquemas:**
   - Esquema de autenticación propio: `CREATE SCHEMA IF NOT EXISTS sitecorp_auth;`
   - Esquema de dominio corporativo: `public`.
3. **Ejecución de Migraciones de Autenticación de SiteCorp:**
   ```bash
   cd /opt/sitecorp/services/auth-api
   npm run db:migrate
   ```
   Esto crea las tablas `sitecorp_auth.users`, `sitecorp_auth.user_credentials`, `sitecorp_auth.sessions`, `sitecorp_auth.operator_permissions` y `sitecorp_auth.security_audit_log` con sus constraints, índices y funciones criptográficas.

---

### FASE 1: MIGRACIÓN DE USUARIOS E IDENTIDADES

#### 1.1. Regla Mandatoria de Preservación de UUIDs
La tabla de dominio `profiles` y las referencias en `workers`, `audit_events`, etc., utilizan claves foráneas hacia el `id` original de `auth.users`.  
**Bajo ninguna circunstancia se generarán nuevos UUIDs para los usuarios existentes.**

#### 1.2. Solución a la Incompatibilidad Criptográfica de Contraseñas
- **El Problema:** Supabase almacena hashes de contraseñas utilizando el motor GoTrue (bcrypt con factores de costo variables y sales internas). Supabase no expone las claves en texto claro ni permite exportar directamente las sales de forma compatible con la nueva arquitectura Argon2id.
- **La Solución Arquitectónica:**
  1. Se exportan los metadatos de los usuarios desde Supabase: `id`, `email`, `created_at`, `confirmed_at`.
  2. Se insertan en `sitecorp_auth.users` preservando exactamente su `id (UUID)` y `email`.
  3. Se genera un registro en `sitecorp_auth.user_credentials` con una contraseña temporal de alta entropía hasheada con Argon2id, configurando:
     - `must_change_password = true`
     - `failed_login_attempts = 0`
  4. Los usuarios recibirán una notificación para activar su cuenta mediante un flujo de restablecimiento de contraseña de un solo uso o, en el primer inicio de sesión con su credencial temporal, el sistema interceptará la respuesta con el estado `mustChangePassword = true`, forzando el cambio inmediato de clave a través del endpoint `POST /api/v1/auth/change-password`.

#### 1.3. Script SQL de Ingesta de Identidades
```sql
-- Ejecución en la base de datos destino desde el CSV o volcado exportado de Supabase:
INSERT INTO sitecorp_auth.users (
    id, 
    email, 
    status, 
    created_at, 
    updated_at
)
SELECT 
    su.id, 
    lower(trim(su.email)), 
    CASE 
        WHEN su.banned_until IS NOT NULL THEN 'SUSPENDED'
        WHEN su.confirmed_at IS NOT NULL THEN 'ACTIVE'
        ELSE 'PENDING_VERIFICATION'
    END,
    su.created_at,
    now()
FROM staging_supabase_users su
ON CONFLICT (id) DO NOTHING;
```

---

### FASE 2: MIGRACIÓN DE DATOS RELACIONALES DEL NEGOCIO

1. **Extracción de Datos desde Supabase Cloud (pg_dump):**
   ```bash
   # Volcado exclusivo de datos del esquema public (excluyendo tablas internas de Supabase)
   pg_dump \
     --host="db.<project-ref>.supabase.co" \
     --port=5432 \
     --username="postgres" \
     --format=custom \
     --schema=public \
     --no-owner \
     --no-privileges \
     --file=sitecorp_public_data.dump \
     postgres
   ```
2. **Restauración en el PostgreSQL del VPS:**
   ```bash
   pg_restore \
     --dbname=sitecorp_db \
     --username=sitecorp_app \
     --no-owner \
     --data-only \
     --disable-triggers \
     sitecorp_public_data.dump
   ```
3. **Verificación de Consistencia:**
   - Comparación de número de filas por tabla entre origen y destino mediante consultas de agregación `SELECT count(*)`.
   - Comprobación de que no existan huérfanos entre `profiles` y `sitecorp_auth.users`.

---

### FASE 3: COMPATIBILIDAD Y DESACOPLE DE RLS (ROW LEVEL SECURITY)

Para mantener la seguridad multi-tenant de SiteCorp sin depender de la función interna `auth.uid()` de Supabase, se definen dos alternativas compatibles:

#### Estrategia Principal: Validación en la Capa de Servicios del Backend
1. Cada petición autenticada porta un JWT Ed25519 validado por Fastify.
2. Fastify inyecta el `tenant_id` y `user_id` en el contexto de la transacción (`PostgresTransactionManager`).
3. Todas las consultas SQL parametrizadas filtran estrictamente por `tenant_id = $tenantId`.

#### Estrategia de Compatibilidad para RLS Existente (Opcional):
Si se desea mantener temporalmente las políticas RLS existentes en PostgreSQL sin reescribir consultas:
1. Crear una función de emulación en el esquema `public`:
   ```sql
   CREATE OR REPLACE FUNCTION public.auth_uid() RETURNS UUID AS $$
   BEGIN
       RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
   END;
   $$ LANGUAGE plpgsql STABLE;
   ```
2. Modificar las políticas RLS existentes para sustituir `auth.uid()` por `public.auth_uid()`.
3. Al adquirir una conexión del pool para procesar una petición en Fastify, ejecutar antes de cualquier consulta:
   ```sql
   SET LOCAL app.current_user_id = '<user_uuid>';
   ```
   Al usar `SET LOCAL`, el valor se revierte automáticamente al concluir la transacción, garantizando aislamiento estricto en conexiones agrupadas.

---

### FASE 4: MIGRACIÓN DE ALMACENAMIENTO (SUPABASE STORAGE)

1. **Descarga de Objetos Binarios desde Supabase:**
   - Utilizar un script Node.js o CLI con la `service_role` key para descargar secuencialmente todos los archivos de los buckets `worker_documents` y `platform_documents`.
   - Generar un inventario `manifest.json` que registre: ruta, bucket, tamaño en bytes y checksum SHA-256 de cada archivo.
2. **Destino de Almacenamiento en VPS ETECSA:**
   - **Opción Recomendada:** Sistema de archivos local seguro montado en `/var/data/sitecorp-storage/` con subdirectorios `/worker_documents` y `/platform_documents`.
   - Permisos del sistema operativo: usuario `sitecorp:sitecorp` con permisos `chmod 750`.
3. **Verificación de Integridad:**
   - Script de validación que recalcula el hash SHA-256 de cada archivo descargado en el VPS y lo compara con el `manifest.json`.

---

### FASE 5: TRANSICIÓN DEL FRONTEND REACT Y CORTE DEFINITIVO

1. **Cliente HTTP Unificado:**
   - Se crea el cliente API de autenticación en el frontend (`src/services/authClient.ts`) que interactúa exclusivamente con los endpoints de la nueva API:
     - `POST /api/v1/auth/login`
     - `POST /api/v1/auth/refresh`
     - `POST /api/v1/auth/logout`
     - `POST /api/v1/auth/change-password`
     - `GET /api/v1/auth/me`
2. **Gestión de Sesión:**
   - El token de refresco viaja en la cookie HttpOnly `__Host-sitecorp_rt`.
   - El token de acceso viaja en memoria y en la cabecera `Authorization: Bearer <token>`.
3. **Bandera de Configuración (Feature Flag):**
   - Durante las pruebas controladas: `VITE_AUTH_PROVIDER=sitecorp`.
4. **Corte Definitivo (Cutover):**
   - Se programa una ventana de mantenimiento de 60 minutos.
   - Poner Supabase en modo solo lectura.
   - Sincronizar delta de datos residuales.
   - Apuntar el registro DNS del dominio corporativo a la IP del VPS de ETECSA.
   - Desplegar la compilación de frontend con el cliente propio activado.

---

## 3. PLAN DE ROLLBACK Y CONTINGENCIA

Si durante la ventana de corte se presenta un fallo bloqueante (ej. fallo grave de conectividad en el VPS o incompatibilidad imprevista de datos):

1. **Paso 1: Reversión de DNS:**
   - Cambiar inmediatamente el registro DNS `A` para apuntar de nuevo a los servidores anteriores.
2. **Paso 2: Reactivación de Supabase Cloud:**
   - Retirar el modo de solo lectura en Supabase.
3. **Paso 3: Notificación y Análisis:**
   - Los usuarios continúan operando sobre Supabase Cloud sin pérdida de datos.
   - El equipo de ingeniería analiza los registros en `/var/log/sitecorp/auth-error.log` en el VPS para resolver la causa raíz antes del siguiente intento.

---

## 4. CRITERIOS DE ACEPTACIÓN PARA LA BAJA DEFINITIVA DE SUPABASE

La cuenta y el proyecto en Supabase Cloud solo se cancelarán cuando se cumplan **el 100% de los siguientes hitos durante un período de observación de 14 días**:

- [ ] Todas las tablas de negocio operan con normalidad en el PostgreSQL del VPS.
- [ ] La totalidad de los usuarios activos han completado exitosamente su cambio de contraseña o inicio de sesión en el nuevo backend.
- [ ] La tasa de errores 5xx en la API de autenticación y de negocio es inferior al 0.01%.
- [ ] Las copias de seguridad diarias automatizadas (`backup-restore.sh`) se completan exitosamente y se validan con checksums SHA-256.
- [ ] No existen peticiones entrantes registradas hacia las APIs o endpoints de Supabase Cloud.
- [ ] La dirección técnica y legal de SiteCorp firma la conformidad de soberanía tecnológica e integridad de datos.
