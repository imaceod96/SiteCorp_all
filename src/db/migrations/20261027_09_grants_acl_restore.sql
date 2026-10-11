-- ============================================================================
-- SiteCorp · FASE 2/3 — 09. PERMISOS (GRANT/REVOKE) Y RESTAURACIÓN DE ACL
--
-- HALLAZGO 1 — Los renombrados NO mueven permisos.
--   Tablas, columnas, índices, restricciones y funciones conservan su ACL al
--   renombrarse porque los privilegios van por OID. Por tanto: los ficheros 02–07
--   NO necesitan ni un solo GRANT ni REVOKE. Cualquier GRANT adicional sería una
--   CONCESIÓN DE PERMISOS NO AUTORIZADA (prohibida por las restricciones de fase).
--
-- HALLAZGO 2 — `CREATE OR REPLACE FUNCTION` conserva la ACL (mismo OID).
--   Las funciones de la PARTE C del fichero 08 NO necesitan re-grant.
--
-- HALLAZGO 3 (RIESGO DE SEGURIDAD REAL) — DROP + CREATE SÍ pierde la ACL.
--   Al recrear una función, PostgreSQL vuelve al privilegio por defecto
--   (EXECUTE para PUBLIC). En este esquema eso reabriría:
--     · public.delete_workspace(uuid, text)  → hoy: REVOKE de PUBLIC y de anon,
--                                              GRANT a authenticated y service_role
--                                              (20260922_03 / 20261001_03).
--     · public.workspace_deletion_summary(uuid) → igual.
--     · public.save_tenant_role(uuid, uuid, text, text, boolean, uuid[])
--                                              → REVOKE ALL de PUBLIC + GRANT a
--                                                authenticated y service_role.
--   Sin la restauración de este fichero, cualquier usuario anónimo podría invocar la
--   eliminación de clientes (la autorización interna sigue existiendo, pero la
--   primera barrera —el privilegio de ejecución— desaparecería).
--
-- QUÉ HACE ESTE FICHERO
--   Restaura, para las funciones que se recrean en la PARTE B del fichero 08, la ACL
--   EXACTA que tenían antes del DROP, tomada de
--   phase2_migration.function_acl_snapshot (capturada en el fichero 01).
--   No inventa permisos: reproduce los existentes. Si la instantánea no tiene filas
--   para una función, significa ACL por defecto (EXECUTE para PUBLIC) y eso es lo que
--   restaura.
--
-- ORDEN: ejecutar DESPUÉS de completar la PARTE B/C del fichero 08, en la MISMA
--        transacción de la ventana.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  m          record;
  g          record;
  v_sig_new  text;
  v_rows     integer;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      -- (nombre legacy, argumentos de identidad, nombre definitivo)
      ('delete_workspace',                  'uuid, text',                             'delete_company_client'),
      ('workspace_deletion_summary',        'uuid',                                   'company_client_deletion_summary'),
      ('can_use_tenant_permission',         'uuid, text',                             'can_use_company_client_permission'),
      ('can_list_tenant_memberships',       'uuid',                                   'can_list_company_client_memberships'),
      ('can_invite_to_tenant',              'uuid',                                   'can_invite_to_company_client'),
      ('save_tenant_role',                  'uuid, uuid, text, text, boolean, uuid[]', 'save_company_client_role'),
      ('save_tenant_role',                  'uuid, uuid, uuid, text, text, boolean, uuid[]', 'save_company_client_role'),
      ('create_worker_medical_certificate', 'uuid, uuid, uuid, date, date, integer, uuid, uuid', 'create_worker_medical_certificate'),
      ('list_entity_user_access',           'uuid',                                   'list_entity_user_access')
    ) AS t(old_name, identity_args, new_name)
  LOOP
    v_sig_new := 'public.' || m.new_name || '(' || m.identity_arguments || ')';

    IF to_regprocedure(v_sig_new) IS NULL THEN
      RAISE NOTICE 'OMITIDA restauración de ACL para % (función aún no recreada)', v_sig_new;
      CONTINUE;
    END IF;

    -- 1) Punto de partida determinista: sin EXECUTE para PUBLIC (el DROP+CREATE lo
    --    habría concedido por defecto).
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig_new);

    -- 2) Reproducir lo que había realmente antes del DROP.
    SELECT count(*) INTO v_rows
    FROM phase2_migration.function_acl_snapshot s
    WHERE s.schema_name = 'public'
      AND s.function_name = m.old_name
      AND s.identity_arguments = m.identity_arguments;

    IF v_rows = 0 THEN
      -- Sin ACL explícita ⇒ privilegio por defecto: EXECUTE para PUBLIC.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_sig_new);
      RAISE NOTICE 'ACL restaurada (por defecto, PUBLIC) para %', v_sig_new;
      CONTINUE;
    END IF;

    FOR g IN
      SELECT s.grantee, s.privilege_type
      FROM phase2_migration.function_acl_snapshot s
      WHERE s.schema_name = 'public'
        AND s.function_name = m.old_name
        AND s.identity_arguments = m.identity_arguments
      ORDER BY s.grantee
    LOOP
      IF g.grantee = 'PUBLIC' THEN
        EXECUTE format('GRANT %s ON FUNCTION %s TO PUBLIC', g.privilege_type, v_sig_new);
      ELSE
        EXECUTE format('GRANT %s ON FUNCTION %s TO %I', g.privilege_type, v_sig_new, g.grantee);
      END IF;
    END LOOP;

    RAISE NOTICE 'ACL restaurada para % (% concesiones)', v_sig_new, v_rows;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN 1 — Las dos funciones sensibles NO deben ser ejecutables por PUBLIC.
-- ESPERADO: 0 filas.
-- ---------------------------------------------------------------------------
SELECT p.proname AS funcion,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS concesionario
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
  AND p.proname IN ('delete_company_client', 'company_client_deletion_summary')
  AND a.grantee = 0            -- 0 = PUBLIC
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN 2 — ACL efectiva de las funciones afectadas (comparar con
-- phase2_migration.function_acl_snapshot).
-- ---------------------------------------------------------------------------
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS concesionario,
       a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
  AND p.proname IN ('delete_company_client', 'company_client_deletion_summary',
                    'can_use_company_client_permission', 'can_list_company_client_memberships',
                    'can_invite_to_company_client', 'save_company_client_role',
                    'create_worker_medical_certificate', 'list_entity_user_access')
ORDER BY 1, 3, 4;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN 3 — Diferencial: funciones que HOY son ejecutables por PUBLIC y que
-- NO lo eran antes (detección de concesiones accidentales). ESPERADO: 0 filas en
-- `concedido_por_error` (las funciones sin ACL explícita aparecen en la instantánea
-- con 0 filas = comportamiento por defecto, así que no cuentan como nuevas).
-- ---------------------------------------------------------------------------
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       'PUBLIC_EXECUTE_NUEVO' AS concedido_por_error
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE n.nspname = 'public'
  AND a.grantee = 0
  AND EXISTS (
    SELECT 1 FROM phase2_migration.function_acl_snapshot s
    WHERE s.schema_name = 'public'
      AND s.function_name = p.proname
      AND s.identity_arguments = pg_get_function_identity_arguments(p.oid)
  )
  AND NOT EXISTS (
    SELECT 1 FROM phase2_migration.function_acl_snapshot s
    WHERE s.schema_name = 'public'
      AND s.function_name = p.proname
      AND s.identity_arguments = pg_get_function_identity_arguments(p.oid)
      AND s.grantee = 'PUBLIC'
  )
ORDER BY 1;

COMMIT;
