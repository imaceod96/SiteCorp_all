-- ============================================================================
-- SiteCorp · FASE 2/3 — 07. POLÍTICAS RLS
--
-- HALLAZGO IMPORTANTE (evita un trabajo enorme y un riesgo real)
--   Las políticas RLS NO hay que recrearlas. PostgreSQL almacena su expresión como
--   un árbol de nodos con números de atributo y OID, no por nombre: al renombrar
--   tablas y columnas (ficheros 02–04) todas las políticas siguen siendo válidas y
--   pasan a MOSTRARSE ya con los nombres nuevos (`company_client_id`, …).
--   Por tanto este fichero SOLO renombra las políticas para mantener la coherencia
--   de nomenclatura. No toca ninguna condición USING / WITH CHECK.
--
-- LO QUE SÍ SE REVISA (y está fuera de este fichero)
--   · Las política que consultan tablas legacy dentro de su expresión
--     (`candidate_documents`, `employment_types`, `political_affiliations`,
--     `rehire_statuses`, …) siguen siendo válidas por OID: su texto aparece ya con
--     los nombres nuevos. Se verifican en el control de validación del fichero 11.
--   · El aislamiento NO queda "probado" por este renombrado: las pruebas reales de
--     acceso cruzado entre clientes se ejecutan en la Fase 3 (informe §8).
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Políticas cuyo nombre contiene 'tenant' (25)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT n.nspname    AS schema_name,
           cl.relname   AS table_name,
           p.polname    AS policy_name
    FROM pg_policy p
    JOIN pg_class cl ON cl.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND p.polname ~ 'tenant'
    ORDER BY 2, 3
  LOOP
    v_new := phase2_migration.rewrite_name(r.policy_name);

    IF v_new = r.policy_name THEN
      RAISE NOTICE 'OMITIDA política % (sin cambio de nombre)', r.policy_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER POLICY %I ON %I.%I RENAME TO %I',
                   r.policy_name, r.schema_name, r.table_name, v_new);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new, details)
    VALUES ('POLICY',
            r.schema_name || '.' || r.table_name || '.' || r.policy_name,
            r.schema_name || '.' || r.table_name || '.' || v_new,
            jsonb_build_object('table', r.table_name));

    RAISE NOTICE 'RENOMBRADA política % → % (tabla %)',
      r.policy_name, v_new, r.table_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Políticas de `company_client_memberships` que conservan nombre genérico
--    (`memberships_*`). Mapeo EXPLÍCITO: son 6 y conviene que se lean como lo que
--    son. No se aplican a ninguna otra tabla.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m record;
  r record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('memberships_select_own',         'company_client_memberships_select_own'),
      ('memberships_select_authorized',  'company_client_memberships_select_authorized'),
      ('memberships_select_superadmin',  'company_client_memberships_select_superadmin'),
      ('memberships_insert',             'company_client_memberships_insert'),
      ('memberships_update',             'company_client_memberships_update'),
      ('memberships_delete',             'company_client_memberships_delete')
    ) AS t(old_name, new_name)
  LOOP
    IF to_regclass('public.company_client_memberships') IS NULL THEN
      RAISE EXCEPTION 'Falta public.company_client_memberships (¿se ejecutó antes el fichero 02?)';
    END IF;

    SELECT p.polname INTO r
    FROM pg_policy p
    WHERE p.polrelid = 'public.company_client_memberships'::regclass
      AND p.polname = m.old_name;

    IF r.polname IS NULL THEN
      RAISE NOTICE 'OMITIDA política % (ya renombrada o inexistente)', m.old_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER POLICY %I ON public.company_client_memberships RENAME TO %I',
                   m.old_name, m.new_name);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('POLICY',
            'public.company_client_memberships.' || m.old_name,
            'public.company_client_memberships.' || m.new_name);

    RAISE NOTICE 'RENOMBRADA política % → %', m.old_name, m.new_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- 3.1 ESPERADO: 0 filas.
SELECT cl.relname AS tabla, p.polname AS politica_legacy
FROM pg_policy p
JOIN pg_class cl ON cl.oid = p.polrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public' AND p.polname ~ 'tenant'
ORDER BY 1, 2;

-- 3.2 CONTROL DE SEGURIDAD: ninguna tabla debe haber perdido RLS ni políticas.
--     ESPERADO: 0 filas con rls_activo = false entre las tablas afectadas.
SELECT cl.relname AS tabla, cl.relrowsecurity AS rls_activo,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = cl.oid) AS politicas
FROM pg_class cl
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public'
  AND cl.relkind = 'r'
  AND (cl.relname LIKE 'company_client%' OR cl.relname = 'entity_user_access')
ORDER BY 1;

-- 3.3 El texto de las políticas que consultaban tablas legacy ya debe mostrar los
--     nombres nuevos (prueba de que el renombrado es transparente para RLS).
--     ESPERADO tras el fichero 11 (cuerpos de función): 0 filas.
--     Línea base verificada el 2026-10-27: 26 políticas con 'tenant' en su expresión.
--     OJO: si se ejecuta ANTES del fichero 11 todavía pueden aparecer filas porque
--     las expresiones llaman a funciones por OID y el renderizado usa su nombre
--     ACTUAL (p. ej. `can_use_tenant_permission(...)`, que se renombra en el 08).
--     Que aparezcan esos nombres NO es un error de RLS.
SELECT cl.relname AS tabla, p.polname AS politica
FROM pg_policy p
JOIN pg_class cl ON cl.oid = p.polrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public'
  AND (pg_get_expr(p.polqual, p.polrelid) ~ 'tenant'
       OR pg_get_expr(p.polwithcheck, p.polrelid) ~ 'tenant')
ORDER BY 1, 2;

COMMIT;
