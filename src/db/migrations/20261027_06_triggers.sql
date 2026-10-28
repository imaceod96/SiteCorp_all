-- ============================================================================
-- SiteCorp · FASE 2/3 — 06. TRIGGERS Y FUNCIONES DE TRIGGER
--   [revisado: corrección del filtro de esquema en la búsqueda de triggers]
--
-- IMPORTANTE — lo que NO hay que hacer
--   Los triggers se enlazan a su tabla y a su función por OID. Al renombrar tablas
--   (02) y columnas (03/04), los triggers SIGUEN FUNCIONANDO sin tocarlos y sin
--   recrearlos: este fichero solo RENOMBRA nombres para mantener coherencia.
--
-- DEFECTO CORREGIDO EN ESTA REVISIÓN
--   La búsqueda de triggers usaba `tgrelid::regclass::text LIKE 'public.%'`. Con
--   `public` en el search_path, `::regclass::text` devuelve el nombre SIN esquema
--   (`tenant_roles`), así que el filtro NO casaba con nada y el fichero habría
--   omitido silenciosamente los 15 renombrados de trigger sin dar error.
--   Ahora la localización es por catálogo (pg_class + pg_namespace).
--
-- PARTE A — SEGURO (ejecutable en esta ventana)
--   A.1 Funciones de trigger cuyo CUERPO no menciona ningún objeto renombrado
--       (solo NEW.updated_at / NEW.code): ALTER FUNCTION conserva el OID, así que los
--       triggers que las invocan no se enteran. Evidencia: estas 6 funciones NO
--       aparecen entre las 56 funciones con referencias legacy.
--   A.2 Renombrado de los TRIGGERS (nombre únicamente).
--
-- PARTE B — PENDIENTE (fichero 11, misma transacción que los cuerpos extraídos)
--   Funciones de trigger cuyo cuerpo SÍ menciona `tenant_*` / `tenant_id` /
--   `workspace_deletion_target()`: se renombran y se reescriben en el fichero 11,
--   nunca aquí (dejar el cuerpo viejo con el nombre nuevo rompería el aislamiento
--   multiempresa en tiempo de ejecución):
--     tenant_invitation_role_entity, tenant_invitation_entity_same_tenant,
--     entity_user_access_same_tenant, candidates_tenant_entity_same_tenant,
--     organization_entity_parent_is_tenant_safe, protect_system_tenant_role,
--     protect_system_tenant_role_permissions, grant_tenant_permission_to_system_roles
--   (con nombre sin cambios, solo cuerpo nuevo): candidates_prevent_duplicate_person,
--     organization_entity_hierarchy_is_valid, representative_assignment_sync_entity,
--     ensure_entity_administrator_role, enforce_representative_position_limit.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PARTE A.1 — Funciones de trigger sin cambio de cuerpo
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('handle_tenants_updated_at',            'handle_company_clients_updated_at'),
      ('handle_tenant_roles_updated_at',       'handle_company_client_roles_updated_at'),
      ('handle_tenant_permissions_updated_at', 'handle_company_client_permissions_updated_at'),
      ('handle_tenant_invitations_updated_at', 'handle_company_client_invitations_updated_at'),
      ('handle_memberships_updated_at',        'handle_company_client_memberships_updated_at'),
      ('enforce_tenant_code_immutable',        'enforce_company_client_code_immutable')
    ) AS t(old_name, new_name)
  LOOP
    IF to_regprocedure('public.' || m.old_name || '()') IS NULL THEN
      RAISE NOTICE 'OMITIDA función %.%() (ya renombrada o inexistente)', 'public', m.old_name;
      CONTINUE;
    END IF;

    IF to_regprocedure('public.' || m.new_name || '()') IS NOT NULL THEN
      RAISE EXCEPTION 'CONFLICTO: ya existe public.%()', m.new_name;
    END IF;

    EXECUTE format('ALTER FUNCTION public.%I() RENAME TO %I', m.old_name, m.new_name);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('FUNCTION', 'public.' || m.old_name || '()', 'public.' || m.new_name || '()');

    RAISE NOTICE 'RENOMBRADA función de trigger public.%() → public.%()',
      m.old_name, m.new_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PARTE A.2 — Renombrado de los TRIGGERS (solo el nombre; el enlace va por OID)
--   Localización por CATÁLOGO, con el nombre de tabla ya definitivo (fichero 02).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m record;
  r record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('tenants_code_immutable',                      'company_clients_code_immutable'),
      ('tenants_updated_at',                          'company_clients_updated_at'),
      ('tenant_roles_protect_system',                 'company_client_roles_protect_system'),
      ('tenant_roles_updated_at',                     'company_client_roles_updated_at'),
      ('tenant_role_permissions_protect_system',      'company_client_role_permissions_protect_system'),
      ('tenant_permissions_autogrant_system',         'company_client_permissions_autogrant_system'),
      ('tenant_permissions_initial_import_grant',     'company_client_permissions_initial_import_grant'),
      ('tenant_permissions_updated_at',               'company_client_permissions_updated_at'),
      ('tenant_invitations_entity_same_tenant',       'company_client_invitations_entity_same_company_client'),
      ('tenant_invitations_role_entity',              'company_client_invitations_role_entity'),
      ('tenant_invitations_updated_at',               'company_client_invitations_updated_at'),
      ('entity_user_access_same_tenant',              'entity_user_access_same_company_client'),
      ('candidates_tenant_entity_check',              'candidates_company_client_entity_check'),
      ('organization_entities_parent_is_tenant_safe', 'organization_entities_parent_is_company_client_safe'),
      ('memberships_updated_at',                      'company_client_memberships_updated_at')
    ) AS t(old_name, new_name)
  LOOP
    SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name
      INTO r
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname = m.old_name
    LIMIT 1;

    IF r.trigger_name IS NULL THEN
      RAISE NOTICE 'OMITIDO trigger % (ya renombrado o inexistente)', m.old_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TRIGGER %I ON %I.%I RENAME TO %I',
                   r.trigger_name, r.schema_name, r.table_name, m.new_name);

    -- La tabla se registra SIEMPRE con esquema, para que el rollback la pueda
    -- descomponer en (esquema, tabla, objeto).
    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new, details)
    VALUES ('TRIGGER',
            r.schema_name || '.' || r.table_name || '.' || m.old_name,
            r.schema_name || '.' || r.table_name || '.' || m.new_name,
            jsonb_build_object('table', r.table_name));

    RAISE NOTICE 'RENOMBRADO trigger % → % (tabla %.%)',
      m.old_name, m.new_name, r.schema_name, r.table_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- V.1 Triggers con nombre legacy que quedan (esperado: 0; los de tipo trigger se
--     confirman con el fichero 11 cuando sus funciones pasen a tener el cuerpo nuevo).
SELECT c.relname AS tabla, t.tgname AS trigger_legacy
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND t.tgname ~ 'tenant'
ORDER BY 1, 2;

-- V.2 Funciones de trigger con nombre legacy (esperado: solo las de la PARTE B).
SELECT p.proname AS funcion_trigger_legacy
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prorettype = 'pg_catalog.trigger'::regtype
  AND p.proname ~ 'tenant'
ORDER BY 1;

-- V.3 Ningún trigger debe haber perdido su enlace (total de triggers intacto).
--     Comparar con la línea base del fichero 01 (§2.4, object_kind='TRIGGER' o el
--     barrido §5). ESPERADO: 69 triggers en public (valor verificado el 2026-10-27).
SELECT count(*) AS triggers_public
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal;

COMMIT;
