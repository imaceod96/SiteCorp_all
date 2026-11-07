-- =============================================================================
-- SITECORP — CONSULTAS SQL DE AUDITORÍA DE SOLO LECTURA (SUPABASE CLOUD)
-- =============================================================================
-- Propósito:
--   Permitir la auditoría e inspección técnica de la instancia productiva de
--   Supabase Cloud con permisos mínimos de lectura (SELECT únicamente).
--   No realiza escrituras, no bloquea tablas y no expone secretos en claro.
--
-- Ejecución:
--   Copiar y ejecutar en el SQL Editor de Supabase o mediante psql:
--   psql -h db.<project-ref>.supabase.co -U postgres -d postgres -f audit-supabase-queries.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. INFORMACIÓN DEL MOTOR POSTGRESQL Y BASE DE DATOS
-- -----------------------------------------------------------------------------
SELECT 
    current_database() AS database_name,
    current_user AS connected_user,
    version() AS postgres_version;

-- -----------------------------------------------------------------------------
-- 2. TABLAS BASE EN LOS ESQUEMAS 'public' Y 'storage'
-- -----------------------------------------------------------------------------
SELECT 
    table_schema, 
    table_name 
FROM information_schema.tables 
WHERE table_schema IN ('public', 'storage') 
  AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name;

-- -----------------------------------------------------------------------------
-- 3. ESTADO DE ROW LEVEL SECURITY (RLS) POR TABLA EN 'public'
-- -----------------------------------------------------------------------------
SELECT 
    c.relname AS table_name,
    c.rowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- -----------------------------------------------------------------------------
-- 4. POLÍTICAS DE ACCESO RLS REGISTRADAS EN 'public'
-- -----------------------------------------------------------------------------
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- -----------------------------------------------------------------------------
-- 5. FUNCIONES RPC ALMACENADAS EN 'public' (LÓGICA DE NEGOCIO Y ACCESO)
-- -----------------------------------------------------------------------------
SELECT 
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    p.prosecdef AS is_security_definer,
    l.lanname AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- -----------------------------------------------------------------------------
-- 6. TRIGGERS NO INTERNOS ACTIVOS EN 'public'
-- -----------------------------------------------------------------------------
SELECT 
    c.relname AS table_name,
    t.tgname AS trigger_name,
    p.proname AS function_called,
    pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- -----------------------------------------------------------------------------
-- 7. BUCKETS DE ALMACENAMIENTO EN 'storage.buckets'
-- -----------------------------------------------------------------------------
SELECT 
    id, 
    name, 
    public, 
    file_size_limit, 
    allowed_mime_types, 
    created_at
FROM storage.buckets
ORDER BY name;

-- -----------------------------------------------------------------------------
-- 8. CONTEO DE OBJETOS ALMACENADOS POR BUCKET
-- -----------------------------------------------------------------------------
SELECT 
    bucket_id, 
    count(*) AS total_objects
FROM storage.objects
GROUP BY bucket_id
ORDER BY bucket_id;

-- -----------------------------------------------------------------------------
-- 9. IDENTIFICACIÓN DE TABLAS MULTIEMPRESA (TENANT ISOLATION)
-- -----------------------------------------------------------------------------
SELECT 
    table_name, 
    column_name, 
    data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND column_name IN ('company_client_id', 'tenant_id', 'organization_entity_id')
ORDER BY column_name, table_name;

-- -----------------------------------------------------------------------------
-- 10. MÉTRICAS AGREGADAS DE USUARIOS (SIN EXPOSICIÓN DE DATOS SENSIBLES)
-- -----------------------------------------------------------------------------
SELECT 
    count(*) AS total_users,
    count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS confirmed_users,
    count(*) FILTER (WHERE banned_until IS NOT NULL) AS banned_users,
    count(*) FILTER (WHERE email_confirmed_at IS NOT NULL) AS email_confirmed_users
FROM auth.users;

-- -----------------------------------------------------------------------------
-- 11. ALGORITMOS DE HASH EN CREDENCIALES EXISTENTES (PREFIJO CRIPTOGRÁFICO)
-- -----------------------------------------------------------------------------
SELECT 
    substring(password_hash, 1, 7) AS hash_algorithm_prefix,
    count(*) AS total_credentials
FROM public.user_credentials
GROUP BY substring(password_hash, 1, 7);
