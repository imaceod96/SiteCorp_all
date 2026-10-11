-- ============================================================================
-- SiteCorp · FASE 2/3 — 06. TRIGGERS Y FUNCIONES DE TRIGGER
--
-- IMPORTANTE — lo que NO hay que hacer
--   Los triggers se enlazan a su tabla y a su función por OID. Al renombrar tablas
--   (fichero 02) y columnas (03/04) los triggers SIGUEN FUNCIONANDO sin tocarlos.
--   Este fichero NO recrea triggers: solo renombra para mantener coherencia.
--
-- PARTE A — SEGURO (ejecutable en esta ventana)
--   Funciones de trigger cuyo CUERPO no menciona ningún objeto renombrado
--   (solo NEW.updated_at / NEW.code): renombrarlas por ALTER FUNCTION conserva el
--   OID, así que los triggers que las invocan no se enteran.
--
-- PARTE B — PENDIENTE (fichero 08, misma transacción que los cuerpos nuevos)
--   Funciones de trigger cuyo cuerpo SÍ menciona `tenant_*` / `tenant_id` /
--   `workspace_deletion_target()`. Renombrarlas aquí (por su nombre) o dejar el
--   cuerpo viejo rompería el aislamiento multiempresa en runtime. Se renombran en
--   el fichero 08 junto a su cuerpo reescrito:
--     tenant_invitation_role_entity, tenant_invitation_entity_same_tenant,
--     entity_user_access_same_tenant, candidates_tenant_entity_same_tenant,
--     candidates_prevent_duplicate_person (nombre sin cambios),
--     organization_entity_hierarchy_is_valid (nombre sin cambios),
--     organization_entity_parent_is_tenant_safe, protect_system_tenant_role,
--     protect_system_tenant_role_permissions, grant_tenant_permission_to_system_roles,
--     grant_initial_import_permission_to_system_roles (nombre sin cambios),
--     representative_assignment_sync_entity (nombre sin cambios),
--     ensure_entity_administrator_role (nombre sin cambios),
--     enforce_representative_position_limit (nombre sin cambios).
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PARTE A.1 — Renombrado de funciones de trigger sin cambio de cuerpo
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = m.old_name
    ) THEN
      RAISE NOTICE 'OMITIDA función %.% (ya renombrada o inexistente)', 'public', m.old_name;
      CONTINUE;
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
--   Las tablas ya tienen su nombre definitivo tras el fichero 02, así que el
--   ALTER TRIGGER se resuelve dinámicamente sobre la tabla real del trigger.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m record;
  r record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('tenants_code_immutable',                          'company_clients_code_immutable'),
      ('tenants_updated_at',                              'company_clients_updated_at'),
      ('tenant_roles_protect_system',                     'company_client_roles_protect_system'),
      ('tenant_roles_updated_at',                         'company_client_roles_updated_at'),
      ('tenant_role_permissions_protect_system',          'company_client_role_permissions_protect_system'),
      ('tenant_permissions_autogrant_system',             'company_client_permissions_autogrant_system'),
      ('tenant_permissions_initial_import_grant',         'company_client_permissions_initial_import_grant'),
      ('tenant_permissions_updated_at',                   'company_client_permissions_updated_at'),
      ('tenant_invitations_entity_same_tenant',           'company_client_invitations_entity_same_company_client'),
      ('tenant_invitations_role_entity',                  'company_client_invitations_role_entity'),
      ('tenant_invitations_updated_at',                   'company_client_invitations_updated_at'),
      ('entity_user_access_same_tenant',                  'entity_user_access_same_company_client'),
      ('candidates_tenant_entity_check',                  'candidates_company_client_entity_check'),
      ('organization_entities_parent_is_tenant_safe',     'organization_entities_parent_is_company_client_safe'),
      ('memberships_updated_at',                          'company_client_memberships_updated_at')
    ) AS t(old_name, new_name)
  LOOP
    SELECT t.tgname, t.tgrelid::regclass::text AS relation
      INTO r
    FROM pg_trigger t
    WHERE t.tgname = m.old_name
      AND t.tgrelid::regclass::text LIKE 'public.%'
      AND NOT t.tgisinternal;

    IF r.tgname IS NULL THEN
      RAISE NOTICE 'OMITIDO trigger % (ya renombrado o inexistente)', m.old_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TRIGGER %I ON %s RENAME TO %I',
                   r.tgname, r.relation, m.new_name);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new, details)
    VALUES ('TRIGGER',
            r.relation || '.' || m.old_name,
            r.relation || '.' || m.new_name,
            jsonb_build_object('relation', r.relation));

    RAISE NOTICE 'RENOMBRADO trigger % → % (tabla %)',
      m.old_name, m.new_name, r.relation;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- ESPERADO: ninguna fila con nombre legacy (los de la PARTE B se controlan en el 08).
SELECT t.tgrelid::regclass::text AS tabla, t.tgname AS trigger_legacy
FROM pg_trigger t
WHERE t.tgrelid::regclass::text LIKE 'public.%'
  AND NOT t.tgisinternal
  AND t.tgname ~ 'tenant'
ORDER BY 2;

-- ESPERADO: 0 filas.
SELECT p.proname AS funcion_trigger_legacy
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prorettype = 'pg_catalog.trigger'::regtype
  AND p.proname ~ 'tenant'
ORDER BY 1;

COMMIT;
