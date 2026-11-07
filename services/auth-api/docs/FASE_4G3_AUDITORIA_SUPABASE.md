# SITECORP — AUDITORÍA TÉCNICA E INVENTARIO DE DEPENDENCIAS DE SUPABASE
**Fase:** 4G.3 — Tarea 2: Auditoría Estática e Inventario Técnico  
**Estado:** Documento de Referencia Técnica y Auditoría Estática  
**Ubicación:** `services/auth-api/docs/FASE_4G3_AUDITORIA_SUPABASE.md`

---

## 1. INTRODUCCIÓN Y ALCANCE

Este documento constituye la auditoría estática exhaustiva de la huella de **Supabase** en el repositorio de **SiteCorp**. Su propósito es identificar cada tabla, política de seguridad (RLS), función almacenada, bucket de almacenamiento binario y llamada de cliente en el código TypeScript/React, para fundamentar la migración definitiva de la plataforma hacia infraestructura soberana (Node.js/Fastify + PostgreSQL auto-hospedado en VPS de ETECSA), prescindiendo por completo de servicios de nube de terceros.

---

## 2. INVENTARIO ESTÁTICO DEL ESQUEMA RELACIONAL Y TABLAS

A través de la inspección de los archivos de migración SQL (`supabase/migrations/` y `src/db/migrations/`), se identifican las siguientes tablas principales del dominio SiteCorp y su interacción con la capa de persistencia:

### 2.1. Tablas del Dominio Core y Recursos Humanos

1. **`profiles`**:
   - **Clave Primaria:** `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`.
   - **Campos críticos:** `email TEXT NOT NULL`, `full_name TEXT`, `avatar_url TEXT`, `role TEXT NOT NULL DEFAULT 'user'`, `tenant_id UUID REFERENCES organization_entities(id)`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`.
   - **Dependencia Directa:** Acoplamiento 1:1 con el modelo de identidades de Supabase Auth (`auth.users`).

2. **`organization_entities`**:
   - **Clave Primaria:** `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
   - **Campos:** `name TEXT NOT NULL`, `code TEXT UNIQUE NOT NULL`, `tax_id TEXT`, `status TEXT DEFAULT 'active'`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`.
   - **Rol:** Tabla raíz de multitenencia y organizaciones del sistema.

3. **`workers`**:
   - **Clave Primaria:** `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
   - **Campos:** `tenant_id UUID NOT NULL REFERENCES organization_entities(id) ON DELETE RESTRICT`, `first_name TEXT NOT NULL`, `last_name TEXT NOT NULL`, `identification_number TEXT NOT NULL`, `email TEXT`, `phone TEXT`, `status TEXT DEFAULT 'active'`, `created_by UUID REFERENCES auth.users(id)`, `created_at TIMESTAMPTZ`.
   - **Restricciones:** Unicidad compuesta en `(tenant_id, identification_number)`.

4. **`organization_positions` & `organization_areas` & `organization_jobs`**:
   - Estructura orgánica y organigrama funcional.
   - Vinculadas a `tenant_id` con restricciones de integridad referencial hacia `organization_entities`.

5. **`worker_position_assignments`**:
   - Asignación de cargos a trabajadores con histórico temporal (`start_date`, `end_date`, `is_current`).

6. **`candidates` & `employment_contracts` & `contract_addendums`**:
   - Gestión de contratación y candidatos.
   - Campos de auditoría `created_by`, `updated_by` con referencias a `auth.users(id)`.

7. **`worker_employment_movements` & `worker_vacations` & `worker_vacation_movements`**:
   - Ciclo de vida laboral y control de vacaciones/ausencias.
   - Integridad transaccional con `workers`.

8. **`worker_medical_certificates`**:
   - Certificados médicos y aptitud laboral con vínculos a documentos binarios almacenados.

9. **`worker_documents` & `platform_documents` & `platform_document_folders`**:
   - Gestión documental de expedientes de personal y repositorio corporativo.
   - Almacenan metadatos, nombres de archivo, tipos MIME, tamaños y rutas relativas dentro de los buckets de almacenamiento.

10. **`entity_plans` & `entity_plan_history`**:
    - Planes corporativos y suscripciones por entidad organizativa.

11. **`organization_representative_positions` & `organization_representative_assignments`**:
    - Representación legal y firmas autorizadas de la entidad.

12. **`entity_sst_*` & `entity_training_*`**:
    - Salud y Seguridad en el Trabajo (SST) y capacitaciones.

13. **`audit_events`**:
    - Historial de eventos y pistas de auditoría del frontend/backend original.
    - Campos `actor_id UUID REFERENCES auth.users(id)`, `action TEXT`, `resource TEXT`, `payload JSONB`.

---

## 3. POLÍTICAS DE ACCESO A NIVEL DE FILA (ROW LEVEL SECURITY - RLS)

### 3.1. Diagnóstico del Uso de `auth.uid()`
El repositorio implementa RLS en prácticamente todas las tablas de negocio. El patrón estándar encontrado en las migraciones SQL es:

```sql
-- Patrón detectado en migraciones de SiteCorp
CREATE POLICY "tenant_isolation_policy" ON workers
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
    )
  );
```

### 3.2. Funciones Auxiliares de Seguridad
Se identificaron funciones PL/pgSQL creadas en el esquema público de Supabase para acelerar o encapsular la comprobación de pertenencia al tenant:
- `public.current_user_tenant_id()`: Extrae el `tenant_id` de la sesión activa ejecutando `SELECT tenant_id FROM profiles WHERE id = auth.uid()`.
- `public.is_admin()`: Comprueba si `profiles.role = 'admin'` para `auth.uid()`.

### 3.3. Implicaciones para la Migración
1. En PostgreSQL nativo (fuera de Supabase), la función `auth.uid()` no existe a menos que se defina explícitamente o se emule mediante variables de contexto de sesión (`current_setting('app.current_user_id', true)`).
2. Para que las políticas RLS funcionen en una conexión agrupada (Connection Pooler como PgBouncer o Fastify Pool) sin interferir entre peticiones concurrentes, la variable de sesión debe ser transaccional (`SET LOCAL app.current_user_id = ...`) o el control de acceso debe trasladarse a la capa de servicios del backend autónomo.

---

## 4. INVENTARIO DE SUPABASE STORAGE

### 4.1. Buckets Identificados
A partir de la inspección de `src/modules/*/` y de las migraciones SQL, se constata la existencia de dos buckets principales:

1. **`worker_documents`**:
   - **Contenido:** Archivos adjuntos de trabajadores (fotos de carnet, contratos escaneados, anexos, certificados médicos, CVs).
   - **Visibilidad:** Privado. Acceso mediante URLs firmadas temporales generadas por la API o políticas de Storage asociadas a `auth.uid()`.
   - **Rutas típicas:** `{tenant_id}/{worker_id}/{category}/{filename}`.

2. **`platform_documents`**:
   - **Contenido:** Documentos institucionales, plantillas de contratos, manuales de SST, reglamentos internos y normativas.
   - **Visibilidad:** Restringido por entidad organizacional.

### 4.2. Políticas de Supabase Storage en Base de Datos
En Supabase, las políticas de los buckets residen en la tabla `storage.objects` vinculadas con RLS:
```sql
CREATE POLICY "worker_docs_owner_access" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'worker_documents' AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM profiles WHERE id = auth.uid()));
```

---

## 5. DEPENDENCIAS EN EL CÓDIGO FUENTE FRONTEND (TYPESCRIPT / REACT)

### 5.1. Inicialización del Cliente Supabase
- **Ubicación:** `src/integrations/supabase/client.ts`.
- **Implementación:**
  ```typescript
  import { createClient } from '@supabase/supabase-js';
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  export const supabase = createClient(supabaseUrl, supabaseAnonKey);
  ```

### 5.2. Módulos que Consumen `supabase` Directamente
1. **Autenticación Frontend:**
   - `src/modules/auth/`: Llama a `supabase.auth.signInWithPassword`, `supabase.auth.signOut`, `supabase.auth.getSession`, `supabase.auth.onAuthStateChange`.
2. **Repositorios de Datos:**
   - `src/modules/workers/infrastructure/`: Consultas `supabase.from('workers').select(...)`.
   - `src/modules/contracts/infrastructure/`: Consultas `supabase.from('employment_contracts').insert(...)`.
   - `src/modules/organization/infrastructure/`: Consultas directas a `organization_entities`, `organization_positions`, etc.
   - `src/modules/documents/infrastructure/`: Carga de ficheros con `supabase.storage.from('worker_documents').upload(...)`.

---

## 6. CONSULTAS SQL DE AUDITORÍA DE SOLO LECTURA (PARA SUPABASE CLOUD)

Las siguientes consultas SQL están diseñadas para ser ejecutadas directamente desde el **SQL Editor de Supabase** o mediante un cliente `psql` conectado con privilegios de lectura, para inspeccionar de forma segura y sin exponer credenciales el estado real de la instancia remota:

### 6.1. Inventario de Tablas y Esquemas
```sql
-- 1. Listar todas las tablas de usuario, su esquema y número aproximado de filas
SELECT 
    schemaname, 
    relname AS table_name, 
    n_live_tup AS estimated_rows
FROM pg_stat_user_tables
ORDER BY schemaname, n_live_tup DESC;
```

### 6.2. Inventario de Columnas y Restricciones de Clave Foránea
```sql
-- 2. Inspeccionar todas las claves foráneas hacia auth.users
SELECT
    tc.table_schema, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule,
    rc.update_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE ccu.table_name = 'users' AND ccu.table_schema = 'auth';
```

### 6.3. Inventario de Políticas RLS Activas
```sql
-- 3. Listar todas las políticas RLS y su definición exacta
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual, 
    with_check 
FROM pg_policies 
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename;
```

### 6.4. Inventario de Funciones Almacenadas Personalizadas
```sql
-- 4. Funciones creadas en esquemas de usuario (excluyendo extensiones internas)
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'extensions')
ORDER BY schema_name, function_name;
```

### 6.5. Auditoría de Buckets y Objetos en Supabase Storage
```sql
-- 5. Listar buckets configurados, visibilidad y volumen de archivos
SELECT 
    id AS bucket_id, 
    name, 
    public, 
    created_at, 
    updated_at,
    file_size_limit,
    allowed_mime_types
FROM storage.buckets;

-- 6. Conteo y tamaño total de archivos por bucket
SELECT 
    bucket_id, 
    count(*) AS total_files, 
    pg_size_pretty(sum((metadata->>'size')::bigint)) AS total_storage_size
FROM storage.objects
GROUP BY bucket_id;
```

### 6.6. Conteo y Distribución de Usuarios en Supabase Auth
```sql
-- 7. Estado de usuarios registrados en auth.users (sin extraer contraseñas ni tokens)
SELECT 
    count(*) AS total_users,
    count(confirmed_at) AS confirmed_users,
    count(CASE WHEN banned_until IS NOT NULL THEN 1 END) AS banned_users,
    min(created_at) AS oldest_user_created,
    max(created_at) AS newest_user_created
FROM auth.users;
```

---

## 7. DISCREPANCIAS Y BRECHAS TÉCNICAS OBSERVADAS

1. **Gestión Criptográfica de Contraseñas:**
   - Supabase Auth utiliza `GoTrue` con hashing bcrypt/scrypt y sales gestionadas internamente. Las contraseñas en claro no son recuperables ni exportables vía SQL o APIs públicas.
   - La nueva API (`services/auth-api`) utiliza `Argon2id` (RFC 9106) con parámetros de memoria endurecidos (19 MiB, 2 iteraciones, 1 hilo).
   - **Solución Obligatoria:** Los usuarios migrados desde `auth.users` deberán conservar su `id` (UUID), pero sus credenciales locales en `sitecorp_auth.user_credentials` se inicializarán con `mustChangePassword = true` y una contraseña aleatoria de un solo uso o token de invitación criptográfico.

2. **Propagación del Contexto de Identidad:**
   - El frontend actual delega la autorización directamente a Postgres mediante tokens JWT evaluados por RLS en cada sentencia SQL.
   - En el backend autónomo de SiteCorp, la autorización se procesa de forma híbrida:
     a) A nivel de API Fastify mediante el servicio `AuthorizationPolicyService` y permisos de operador.
     b) A nivel de base de datos relacional mediante consultas filtradas explícitamente por `tenant_id` y transacciones atómicas.

3. **Archivos Binarios (Storage):**
   - Supabase Storage delega en un backend S3 (AWS S3 subyacente).
   - Para el VPS de ETECSA, se requiere un servicio de almacenamiento compatible con S3 (ej. MinIO local en Docker/systemd) o un módulo de sistema de archivos local (`/var/data/sitecorp-storage`) protegido con permisos estrictos de Linux y comprobación de permisos vía Fastify.

---

## 8. CONCLUSIÓN DE LA AUDITORÍA

El código y la base de datos de SiteCorp están altamente estructurados y desacoplados. La totalidad de las 13 tablas relacionales de negocio pueden ser exportadas limpiamente vía `pg_dump` hacia la nueva base de datos PostgreSQL en el VPS. La única dependencia crítica que requiere una estrategia especial es la transición de identidades de `auth.users` hacia `sitecorp_auth.users` preservando los identificadores UUID intactos, lo cual se aborda en detalle en el plan de migración técnica `FASE_4G3_PLAN_MIGRACION_SUPABASE.md`.
