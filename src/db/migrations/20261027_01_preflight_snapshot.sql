-- ============================================================================
-- SiteCorp · FASE 2/3 — Migración de nomenclatura: Tenant/Workspace → CompanyClient
-- Archivo: 20261027_01_preflight_snapshot.sql   [revisado: corrección de filtros de
--          esquema y snapshots anclados por OID]
--
-- QUÉ HACE
--   · Comprobaciones PREVIAS de solo lectura (integridad, dependencias, línea base).
--   · Instantáneas ANCLADAS POR OID del estado físico actual: definiciones,
--     propietario, ACL exacta y configuración de cada función, más ACL de tablas,
--     nombres de objetos afectados y recuento de filas.
--     Son la base de la validación (ficheros 08/11/12) y del plan de recuperación (90).
--
-- QUÉ NO HACE
--   · No renombra nada, no crea ni elimina objetos de negocio, no modifica datos,
--     no desactiva RLS y no concede permisos.
--
-- ORDEN: PRIMER archivo de la fase. Ejecutar SIEMPRE antes del 02.
-- ESTADO: PREPARADO, NO APLICADO.
--
-- NOTA TÉCNICA (defecto corregido en esta revisión)
--   Las consultas de instantánea de políticas y triggers usaban
--   `polrelid::regclass::text LIKE 'public.%'`. Ese filtro NO funciona: cuando
--   `public` está en el search_path, `::regclass::text` devuelve el nombre SIN
--   esquema (`tenant_roles`), por lo que la instantánea habría quedado VACÍA para
--   políticas y triggers sin dar ningún error. Ahora se resuelve por catálogo
--   (pg_class + pg_namespace).
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
-- 1. Libro de renombrados (permite generar la REVERSIÓN de forma automática)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phase2_migration.rename_log (
  id          bigserial PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  object_kind text NOT NULL,   -- TABLE | COLUMN | INDEX | CONSTRAINT | POLICY | TRIGGER | FUNCTION
  object_old  text NOT NULL,
  object_new  text NOT NULL,
  details     jsonb
);

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

-- 2.1 Definiciones + propietario + ACL exacta, ANCLADAS POR OID.
--     El OID es el único identificador estable frente a renombrados y es lo que
--     permite demostrar después (fichero 12) que la ACL y el propietario no han
--     cambiado y que ninguna función ha ganado EXECUTE.
CREATE TABLE IF NOT EXISTS phase2_migration.function_definition_snapshot (
  function_oid       oid PRIMARY KEY,
  schema_name        text NOT NULL,
  function_name      text NOT NULL,
  identity_arguments text NOT NULL,
  result_type        text NOT NULL,
  owner_name         text NOT NULL,
  acl_text           text,                 -- NULL = ACL por defecto (EXECUTE a PUBLIC)
  security_definer   boolean NOT NULL,
  language_name      text NOT NULL,
  config             text,
  definition         text NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO phase2_migration.function_definition_snapshot
  (function_oid, schema_name, function_name, identity_arguments, result_type,
   owner_name, acl_text, security_definer, language_name, config, definition)
SELECT p.oid,
       n.nspname,
       p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_function_result(p.oid),
       pg_get_userbyid(p.proowner),
       p.proacl::text,
       p.prosecdef,
       l.lanname,
       array_to_string(p.proconfig, ' | '),
       pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ON CONFLICT (function_oid) DO NOTHING;

-- 2.2 ACL normalizada (por concesionario) — informe y verificación diferencial.
CREATE TABLE IF NOT EXISTS phase2_migration.function_acl_snapshot (
  function_oid       oid NOT NULL,
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
     (function_oid, grantee, privilege_type);

INSERT INTO phase2_migration.function_acl_snapshot
  (function_oid, schema_name, function_name, identity_arguments, grantee, privilege_type, is_grantable)
SELECT p.oid,
       n.nspname,
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

-- 2.3 ACL de tablas/secuencias: los renombrados conservan la ACL (el OID no cambia).
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
  ON phase2_migration.relation_acl_snapshot (relation_name, grantee, privilege_type);

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
--     Filtros por CATÁLOGO (nspname), no por texto de ::regclass::text.
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
SELECT 'POLICY', c.relname, p.polname,
       pg_get_expr(p.polqual, p.polrelid)
         || coalesce(' WITH CHECK ' || pg_get_expr(p.polwithcheck, p.polrelid), '')
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND p.polname ~ 'tenant';

INSERT INTO phase2_migration.object_name_snapshot (object_kind, table_name, object_name, definition)
SELECT 'TRIGGER', c.relname, t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
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
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
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
-- 3. HALLAZGO: huérfanos de tenant_id. ESPERADO 0 en todas las tablas.
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
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
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
-- ESPERADO: 0 filas. Si hay filas, DETENER la migración.

-- ---------------------------------------------------------------------------
-- 4. Comprobaciones de estructura (solo lectura)
-- ---------------------------------------------------------------------------

-- 4.1 Vistas / vistas materializadas. ESPERADO: 0 filas.
SELECT c.relname AS vista, c.relkind AS tipo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm');

-- 4.2 Tablas con tenant_id SIN RLS habilitado. ESPERADO: 0 filas.
--     OJO: RLS habilitado NO significa aislamiento verificado (pruebas en Fase 3).
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

-- 4.3 LÍNEA BASE de funciones afectadas (debe coincidir con el fichero 08).
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       length(p.prosrc) AS bytes_cuerpo,
       l.lanname AS lenguaje,
       p.prosecdef AS security_definer,
       EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%') AS parametro_o_salida_con_tenant,
       (pg_get_function_result(p.oid) ILIKE '%tenant%') AS retorno_con_tenant
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND (p.prosrc ~ '(tenants|tenant_id|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id)'
       OR EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%'))
ORDER BY 1, 2;
-- Línea base verificada el 2026-10-27: 56 funciones · 174.602 bytes de cuerpo ·
-- 9 en lenguaje sql · 56 SECURITY DEFINER · 9 con parámetro o columna de salida legacy.

-- ---------------------------------------------------------------------------
-- 5. BARRIDO DEL CATÁLOGO: otros objetos cuyo TEXTO menciona la nomenclatura legacy.
--    Sirve para no dejar dependencias ocultas fuera de las funciones.
--    ESPERADO antes de migrar: indexdef > 0 y constraintdef > 0 (nombres físicos),
--    policy_expr > 0 (llamadas a funciones legacy por OID, se actualizan solas).
--    ESPERADO DESPUÉS de la migración: 0 en TODAS las filas.
-- ---------------------------------------------------------------------------
SELECT 'vistas_matview' AS tipo, count(*) AS n FROM (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
) x
UNION ALL
SELECT 'indexdef', count(*) FROM pg_index i
  JOIN pg_class ci ON ci.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = ci.relnamespace
  WHERE n.nspname = 'public' AND pg_get_indexdef(i.indexrelid) ~ '\mtenant'
UNION ALL
SELECT 'constraintdef', count(*) FROM pg_constraint c
  WHERE c.connamespace = 'public'::regnamespace AND c.conrelid <> 0
    AND pg_get_constraintdef(c.oid) ~ '\mtenant'
UNION ALL
SELECT 'triggerdef', count(*) FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND pg_get_triggerdef(t.oid) ~ 'tenant'
UNION ALL
SELECT 'policy_expr', count(*) FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
         || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'tenant'
UNION ALL
SELECT 'column_default', count(*) FROM pg_attrdef d
  JOIN pg_class c ON c.oid = d.adrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND pg_get_expr(d.adbin, d.adrelid) ~ 'tenant'
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- 6. DEPENDENCIAS POR NOMBRE (base de la decisión de renombrar índices/restricciones)
--    Comprobado el 2026-10-27 con el catálogo real:
--      · restricciones referenciadas por nombre en algún cuerpo .......... NINGUNA
--      · índices referenciados por nombre en algún cuerpo ...... 2 (uno con 'tenant')
--      · uso de `ON CONFLICT ON CONSTRAINT` ............................. 0
--    → Renombrar restricciones es seguro; renombrar `workers_tenant_code_unique` NO
--      lo es (queda excluido en el fichero 05 y su literal se conserva intacto).
-- ---------------------------------------------------------------------------
SELECT 'indice_con_dependencia_por_nombre' AS tipo, ci.relname AS objeto, p.proname AS funcion
FROM pg_class ci
JOIN pg_namespace ni ON ni.oid = ci.relnamespace
JOIN pg_proc p ON p.prosrc ~ ('\m' || ci.relname || '\M')
JOIN pg_namespace np ON np.oid = p.pronamespace
WHERE ni.nspname = 'public' AND np.nspname = 'public' AND ci.relkind = 'i'
ORDER BY 2, 3;

COMMIT;

-- ============================================================================
-- RESULTADO ESPERADO
--   · phase2_migration con 7 tablas pobladas (rename_log, preflight_findings,
--     function_definition_snapshot, function_acl_snapshot, relation_acl_snapshot,
--     object_name_snapshot y table_row_counts), ancladas por OID.
--   · 3 → 0 filas · 4.1 → 0 filas · 4.2 → 0 filas.
--   · 4.3 → 56 filas · 5 → valores de línea base · 6 → 2 filas.
-- ============================================================================
