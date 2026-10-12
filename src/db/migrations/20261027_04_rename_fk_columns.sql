-- ============================================================================
-- SiteCorp · FASE 2/3 — 04. RENOMBRADO DE COLUMNAS DE ENLACE
--                          `tenant_membership_id` / `tenant_role_id` / `tenant_permission_id`
--
-- Estas columnas NO se llaman `tenant_id`, pero su nombre deriva de las tablas
-- legacy, así que la nomenclatura definitiva debe ser coherente con ellas
-- (no es una sustitución ciega: cada par está enumerado y justificado).
--
--   entity_user_access.tenant_membership_id            → company_client_membership_id
--   entity_user_access.tenant_role_id                  → company_client_role_id
--   company_client_invitations.tenant_role_id          → company_client_role_id
--   company_client_role_permissions.tenant_role_id     → company_client_role_id
--   company_client_role_permissions.tenant_permission_id → company_client_permission_id
--   company_client_user_roles.tenant_membership_id     → company_client_membership_id
--   company_client_user_roles.tenant_role_id           → company_client_role_id
--
-- RIESGO ESPECÍFICO (tipo C — despliegue coordinado obligatorio)
--   · `entity_user_access.tenant_membership_id` y `.tenant_role_id` son columnas de
--     salida de la RPC `list_entity_user_access` (RETURNS TABLE). El nombre de esas
--     COLUMNAS DE SALIDA **se conserva** (compatibilidad aprobada nº 2): cambiar el
--     nombre de una columna de salida exige DROP + CREATE y haría perder la ACL, así
--     que el fichero 11 reescribe solo el CUERPO y deja la firma intacta.
--   · El frontend lee y escribe esos nombres en:
--       src/components/entity-users-dialog.tsx
--       src/components/roles-manager.tsx
--       src/pages/CompanyClientUsers.tsx
--       src/pages/OrganizationDetail.tsx
--   · `tenant_permission_id` se lee en `src/components/roles-manager.tsx`.
--
-- Orden obligatorio: este fichero va DESPUÉS del 02 (las tablas ya tienen su nombre
-- definitivo). Si se ejecuta antes, los pares apuntan a tablas inexistentes.
--
-- Idempotente.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('entity_user_access',              'tenant_membership_id', 'company_client_membership_id'),
      ('entity_user_access',              'tenant_role_id',       'company_client_role_id'),
      ('company_client_invitations',      'tenant_role_id',       'company_client_role_id'),
      ('company_client_role_permissions', 'tenant_role_id',       'company_client_role_id'),
      ('company_client_role_permissions', 'tenant_permission_id', 'company_client_permission_id'),
      ('company_client_user_roles',       'tenant_membership_id', 'company_client_membership_id'),
      ('company_client_user_roles',       'tenant_role_id',       'company_client_role_id')
    ) AS t(table_name, old_column, new_column)
  LOOP
    IF to_regclass('public.' || m.table_name) IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla public.% (¿se ejecutó antes el fichero 02?)', m.table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || m.table_name)
        AND a.attname = m.old_column
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE NOTICE 'OMITIDA columna %.% (ya renombrada o inexistente)',
        m.table_name, m.old_column;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I',
                   m.table_name, m.old_column, m.new_column);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('COLUMN',
            'public.' || m.table_name || '.' || m.old_column,
            'public.' || m.table_name || '.' || m.new_column);

    RAISE NOTICE 'RENOMBRADA columna public.%.% → %',
      m.table_name, m.old_column, m.new_column;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- ESPERADO: 0 filas.
SELECT c.relname AS tabla, a.attname AS columna_legacy
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND a.attname IN ('tenant_membership_id', 'tenant_role_id', 'tenant_permission_id')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY 1, 2;

-- ESPERADO: las columnas nuevas existen y el índice único funcional sigue vivo.
SELECT c.relname AS tabla, a.attname AS columna_nueva
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND a.attname IN ('company_client_membership_id',
                    'company_client_role_id',
                    'company_client_permission_id')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY 1, 2;
-- ESPERADO: 7 filas.

-- INTEGRIDAD de las FK de enlace (una por columna renombrada).
SELECT c.conname, c.conrelid::regclass::text AS tabla, c.confrelid::regclass::text AS referencia
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
  AND c.confrelid IN (to_regclass('public.company_client_memberships'),
                      to_regclass('public.company_client_roles'),
                      to_regclass('public.company_client_permissions'))
ORDER BY 1;
-- ESPERADO: cada columna renombrada conserva su FK (ON DELETE CASCADE/RESTRICT intactos).

COMMIT;

-- ============================================================================
-- NO EJECUTAR este fichero de forma aislada: los objetos `tenant_role_id` /
-- `tenant_membership_id` de las funciones (fichero 11) y del frontend (informe §7)
-- deben desplegarse en la MISMA ventana.
-- ============================================================================
