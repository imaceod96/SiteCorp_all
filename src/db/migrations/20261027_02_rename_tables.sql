-- ============================================================================
-- SiteCorp · FASE 2/3 — 02. RENOMBRADO DE TABLAS
--
-- Cambio de tipo A (renombrado físico seguro) para la BASE DE DATOS, pero de
-- tipo C respecto a la APLICACIÓN: la Data API (PostgREST) expone el nombre de la
-- tabla, de modo que cualquier consulta `from("tenants")` deja de funcionar en el
-- instante del renombrado. NO EJECUTAR sin la ventana coordinada del fichero 08.
--
-- Qué se conserva intacto
--   · El UUID de cada cliente y de cada registro (RENAME nunca regenera OID ni datos).
--   · Todas las filas, relaciones, FK, índices, RLS, triggers y ACL (van por OID).
--   · Las vistas: no existen (verificado en 20261027_01 §4.1).
--
-- Qué se rompe si se ejecuta solo este fichero
--   · Toda función PL/pgSQL/SQL con el texto `tenants` / `tenant_memberships` / …
--     (los cuerpos son texto: PostgreSQL NO avisa al renombrar; falla en runtime).
--     → van en el fichero 08, en la MISMA transacción/ventana.
--   · El frontend y la Edge Function `delete-workspace` (contrato físico).
--
-- Idempotente: si la tabla ya está renombrada, no hace nada.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Utilidad de nombres definitivos (compartida con los ficheros 05, 06 y 07)
--    Determinista y NO CIEGA: sustituye los tokens legacy de más largo a más
--    corto, de modo que `tenant_membership` nunca se convierte en
--    `company_client_membership_company_client`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION phase2_migration.rewrite_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(
           replace(
             replace(
               replace(
                 replace(
                   replace(p_name,
                     'tenant_membership', 'company_client_membership'),
                   'tenant_role', 'company_client_role'),
                 'tenant_permission', 'company_client_permission'),
               'tenant_id', 'company_client_id'),
             'tenants', 'company_clients'),
           'tenant', 'company_client')
$$;

COMMENT ON FUNCTION phase2_migration.rewrite_name(text) IS
  'Traduce un identificador físico legacy (tabla/columna/línea base de índice o restricción) '
  'a la nomenclatura definitiva CompanyClient. Orden de sustitución: token más largo primero.';

-- ---------------------------------------------------------------------------
-- 1. Renombrado de tablas
--
--    6 renombrados exigidos por la nomenclatura definitiva +
--    1 decisión de coherencia (`tenant_permissions` → `company_client_permissions`).
--    Justificación de la 7.ª: es el catálogo de permisos DE CLIENTE; su hermano
--    global es `platform_permissions`. Dejar `tenant_permissions` mantendría la
--    nomenclatura legacy justo en la tabla que gobierna `can_access_entity`.
--    El nombre definitivo se decide de forma coherente, no por sustitución ciega.
--    Las CLAVES de permiso almacenadas (datos, p. ej. 'roles.manage') NO se tocan
--    en la Fase 2 (ver informe §6: cambio de datos, requiere autorización expresa).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('tenants',                 'company_clients'),
      ('tenant_memberships',      'company_client_memberships'),
      ('tenant_roles',            'company_client_roles'),
      ('tenant_role_permissions', 'company_client_role_permissions'),
      ('tenant_user_roles',       'company_client_user_roles'),
      ('tenant_invitations',      'company_client_invitations'),
      ('tenant_permissions',      'company_client_permissions')
    ) AS t(old_name, new_name)
  LOOP
    IF to_regclass('public.' || m.old_name) IS NULL THEN
      RAISE NOTICE 'OMITIDA tabla public.% (ya renombrada o inexistente)', m.old_name;
      CONTINUE;
    END IF;

    IF to_regclass('public.' || m.new_name) IS NOT NULL THEN
      RAISE EXCEPTION
        'CONFLICTO: coexisten public.% y public.%. Abortada la migración sin cambios.',
        m.old_name, m.new_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', m.old_name, m.new_name);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('TABLE', 'public.' || m.old_name, 'public.' || m.new_name);

    RAISE NOTICE 'RENOMBRADA tabla public.% → public.%', m.old_name, m.new_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Verificación posterior (ejecutar al final del fichero)
-- ---------------------------------------------------------------------------
-- ESPERADO: 0 filas.
SELECT c.relname AS tabla_legacy_restante
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname ~ '^tenant'
ORDER BY 1;

-- ESPERADO: las 7 tablas nuevas presentes.
SELECT c.relname AS tabla_nueva
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'company_client%'
ORDER BY 1;

COMMIT;

-- ============================================================================
-- REVERSIÓN: fase2_migration.rename_log permite deshacer estos 7 renombrados
-- (ver 20261027_90_rollback.sql, que los invierte en orden inverso).
-- ============================================================================
