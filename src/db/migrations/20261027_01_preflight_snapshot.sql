-- ============================================================================
-- SiteCorp · FASE 2/3 — Migración de nomenclatura: Tenant/Workspace → CompanyClient
-- Archivo: 20261027_01_preflight_snapshot.sql
--
-- QUÉ HACE
--   · Comprobaciones PREVIAS de solo lectura (integridad, dependencias, línea base).
--   · Instantáneas (snapshot) del estado físico actual: definiciones de funciones,
--     ACL de funciones y de tablas, nombres de objetos afectados y recuento de filas.
--     Estas instantáneas son la base de los controles de validación y del plan de
--     recuperación (fichero 20261027_90_rollback.sql).
--
-- QUÉ NO HACE
--   · No renombra nada, no crea ni elimina objetos de negocio, no modifica datos.
--   · No desactiva RLS ni concede permisos.
--
-- ORDEN: PRIMER archivo de la fase. Ejecutar SIEMPRE antes del 02.
-- ESTADO: PREPARADO, NO APLICADO.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Esquema de trabajo temporal
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS phase2_migration;

COMMENT ON SCHEMA phase2_migration IS
  'Área temporal de la Fase 2 (Tenant→CompanyClient). No se expone por la Data API '
  '(solo public y graphql_public). Se elimina al cerrar la Fase 3.';

-- ---------------------------------------------------------------------------
-- 1. Libro de renombrados: permite generar la REVERSIÓN de forma automática
--    y auditar exactamente qué se cambió de nombre.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phase2_migration.rename_log (
  id          bigserial PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  object_kind text NOT NULL,   -- TABLE | COLUMN | INDEX | CONSTRAINT | POLICY | TRIGGER | FUNCTION
  object_old  text NOT NULL,
  object_new  text NOT NULL,
  details     jsonb
);

-- Hallazgos de las comprobaciones previas.
CREATE TABLE IF NOT EXISTS phase2_migration.preflight_findings (
  check_name    text NOT NULL,
  table_name    text NOT NULL,
  finding_count bigint NOT NULL,
  details       jsonb,
  captured_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Instantáneas (solo lectura → copia)
-- ---------------------------------------------------------------------------

-- 2.1 Definiciones de TODAS las funciones de public: permite reconstruir el texto
--     previo de los cuerpos antes de reescribirlos.
CREATE TABLE IF NOT EXISTS phase2_migration.function_definition_snapshot (
  schema_name        text NOT NULL,
  function_name      text NOT NULL,
  identity_arguments text NOT NULL,   -- solo tipos: estable frente a renombrado de parámetros
  result_type        text NOT NULL,
  definition         text NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schema_name, function_name, identity_arguments)
);

INSERT INTO phase2_migration.function_definition_snapshot
  (schema_name, function_name, identity_arguments, result_type, definition)
SELECT n.nspname,
       p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_function_result(p.oid),
       pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ON CONFLICT (schema_name, function_name, identity_arguments) DO NOTHING;

-- 2.2 ACL normalizada de las funciones (CRÍTICO): al recrear una función con
--     DROP + CREATE se pierden los REVOKE/GRANT históricos y reaparece el GRANT
--     por defecto a PUBLIC. Esta tabla es la fuente de verdad para restaurarlos.
CREATE TABLE IF NOT EXISTS phase2_migration.function_acl_snapshot (
  schema_name        text NOT NULL,
  function_name      text NOT NULL,
  identity_arguments text NOT NULL,
  grantee            text NOT NULL,   -- 'PUBLIC' | rol
  privilege_type     text NOT NULL,
  is_grantable       boolean NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS function_acl_snapshot_uq
  ON phase2_migration.function_acl_snapshot
     (schema_name, function_name, identity_arguments, grantee, privilege_type);

INSERT INTO phase2_migration.function_acl_snapshot
  (schema_name, function_name, identity_arguments, grantee, privilege_type, is_grantable)
SELECT n.nspname,
       p.proname,
       pg_get_function_identity_arguments(p.oid),
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
       a.privilege_type,
       a.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
ON CONFLICT DO NOTHING;

-- 2.3 ACL de tablas/secuencias: los renombrados conservan la ACL porque el OID no
--     cambia; se guarda para verificación y para la limpieza de la Fase 3.
CREATE TABLE IF NOT EXISTS phase2_migration.relation_acl_snapshot (
  schema_name    text NOT NULL,
  relation_name  text NOT NULL,
  relation_kind  text NOT NULL,
  grantee        text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable   boolean NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS relation_acl_snapshot_uq
  ON phase2_migration.relation_acl_snapshot
     (relation_name, grantee, privilege_type);

INSERT INTO phase2_migration.relation_acl_snapshot
  (schema_name, relation_name, relation_kind, grantee, privilege_type, is_grantable)
SELECT c.relnamespace::regnamespace::text,
       c.relname,
       c.relkind::text,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
       a.privilege_type,
       a.is_grantable
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
ON CONFLICT DO NOTHING;

-- 2.4 Nombres y definiciones de los objetos físicos afectados.
CREATE TABLE IF NOT EXISTS phase2_migration.object_name_snapshot (
  object_kind text NOT NULL,
  table_name  text,
  object_name text NOT NULL,
  definition  text,
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO phase2_migration.object_name_snapshot (object_kind, table_name, object_name, definition)
SELECT 'CONSTRAINT', c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.connamespace = 'public'::regnamespace
  AND c.conrelid <> 0
  AND c.conname ~ 'tenant';

INSERT INTO phase2_migration.object_name_snapshot (object_kind, table_name, object_name, definition)
SELECT 'INDEX', i.indrelid::regclass::text, ci.relname, pg_get_indexdef(i.indexrelid)
FROM pg_index i
JOIN pg_class ci ON ci.oid = i.indexrelid
WHERE ci.relnamespace = 'public'::regnamespace
  AND ci.relname ~ 'tenant';

INSERT INTO phase2_migration.object_name_snapshot (object_kind, table_name, object_name, definition)
SELECT 'POLICY', p.polrelid::regclass::text, p.polname,
       pg_get_expr(p.polqual, p.polrelid)
         || coalesce(' WITH CHECK ' || pg_get_expr(p.polwithcheck, p.polrelid), '')
FROM pg_policy p
WHERE p.polrelid::regclass::text LIKE 'public.%'
  AND p.polname ~ 'tenant';

INSERT INTO phase2_migration.object_name_snapshot (object_kind, table_name, object_name, definition)
SELECT 'TRIGGER', t.tgrelid::regclass::text, t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t
WHERE t.tgrelid::regclass::text LIKE 'public.%'
  AND NOT t.tgisinternal
  AND t.tgname ~ 'tenant';

-- 2.5 Recuento de filas ANTES (verificación de "cero pérdida de datos").
CREATE TABLE IF NOT EXISTS phase2_migration.table_row_counts (
  phase       text NOT NULL,   -- 'before' | 'after'
  table_name  text NOT NULL,
  row_count   bigint NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND (c.relname LIKE 'tenant%'
           OR EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                        AND a.attnum > 0 AND NOT a.attisdropped))
    ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.table_name) INTO n;
    INSERT INTO phase2_migration.table_row_counts (phase, table_name, row_count)
    VALUES ('before', r.table_name, n);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. HALLAZGOS: huérfanos de tenant_id. ESPERADO 0 en todas las tablas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I t WHERE t.tenant_id IS NOT NULL '
      'AND NOT EXISTS (SELECT 1 FROM public.tenants x WHERE x.id = t.tenant_id)',
      r.table_name
    ) INTO n;

    INSERT INTO phase2_migration.preflight_findings (check_name, table_name, finding_count)
    VALUES ('orphan_tenant_id', r.table_name, n);
  END LOOP;
END $$;

SELECT check_name, table_name, finding_count
FROM phase2_migration.preflight_findings
WHERE check_name = 'orphan_tenant_id' AND finding_count > 0
ORDER BY table_name;
-- ESPERADO: 0 filas. Si hay filas, DETENER la migración y analizar el dato.

-- ---------------------------------------------------------------------------
-- 4. Comprobaciones de estructura (solo lectura)
-- ---------------------------------------------------------------------------

-- 4.1 Vistas / vistas materializadas (si existieran, habría que reescribirlas).
--     ESPERADO: 0 filas.
SELECT c.relname AS vista, c.relkind AS tipo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm');

-- 4.2 Tablas con tenant_id SIN RLS habilitado. ESPERADO: 0 filas.
--     OJO: RLS habilitado NO significa aislamiento verificado (ver Fase 3).
SELECT c.relname AS tabla_sin_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                AND a.attnum > 0 AND NOT a.attisdropped)
ORDER BY 1;

-- 4.3 LÍNEA BASE de funciones afectadas. Debe coincidir con la matriz del fichero 08.
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       (p.prosrc ~ 'tenant_id|tenants|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id') AS cuerpo_afectado,
       EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%') AS parametro_afectado,
       (pg_get_function_result(p.oid) ILIKE '%tenant%') AS retorno_afectado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.prosrc ~ 'tenant_id|tenants|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id'
       OR EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%')
       OR pg_get_function_result(p.oid) ILIKE '%tenant%')
ORDER BY 1;

-- 4.4 Informe de solo lectura: qué funciones dependen realmente de cada tabla
--     legacy (útil para confirmar la matriz del fichero 08 sin ninguna duda).
SELECT p.proname AS funcion,
       t.tabla AS tabla_referenciada
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (VALUES ('tenants'), ('tenant_memberships'), ('tenant_roles'),
                   ('tenant_role_permissions'), ('tenant_user_roles'),
                   ('tenant_invitations'), ('tenant_permissions')) AS t(tabla)
WHERE n.nspname = 'public'
  AND p.prosrc ~ ('\m' || t.tabla || '\M')
ORDER BY 2, 1;

COMMIT;

-- ============================================================================
-- RESULTADO ESPERADO DEL FICHERO
--   · Esquema phase2_migration con 6 tablas de snapshot pobladas.
--   · 4.1 → 0 filas.  · 4.2 → 0 filas.  · 3 → 0 filas.
--   · 4.3 y 4.4 → los listados que alimentan la matriz del fichero 08.
-- ============================================================================
