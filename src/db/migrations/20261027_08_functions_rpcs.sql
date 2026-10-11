-- ============================================================================
-- SiteCorp · FASE 2/3 — 08. FUNCIONES, RPC Y CONTRATOS DE RESPUESTA
--
-- ⚠️  ESTE FICHERO NO ES EJECUTABLE DE PRINCIPIO A FIN.
--     La PARTE C (reescritura de cuerpos) es un PASO MANUAL OBLIGATORIO: no se ha
--     generado automáticamente porque ~50 cuerpos PL/pgSQL (varios de 200–400 líneas)
--     no pueden transcribirse a mano sin riesgo de introducir un fallo silencioso en
--     código SECURITY DEFINER que gobierna el aislamiento multiempresa.
--     Ver informe §10 (bloqueos) para el procedimiento exacto de regeneración.
--
-- POR QUÉ ESTE FICHERO ES EL PUNTO CRÍTICO DE LA MIGRACIÓN
--   1. Los cuerpos de función son TEXTO: PostgreSQL NO registra dependencia de los
--      nombres de tabla/columna usados dentro de un cuerpo `AS $$ ... $$`.
--      Consecuencia: tras renombrar (ficheros 02–04) NADA falla al renombrar, pero
--      CADA función afectada falla en la primera ejecución (runtime). Por eso el
--      despliegue de cuerpos va en la MISMA ventana que los renombrados.
--      (Misma razón para las funciones LANGUAGE sql con cuerpo en texto.)
--   2. `CREATE OR REPLACE FUNCTION` NO permite cambiar el nombre de un parámetro de
--      entrada ni el de una columna de salida (error de PostgreSQL). Las funciones
--      cuyo contrato cambia (PARTE B) exigen DROP + CREATE.
--   3. DROP + CREATE PIERDE LA ACL: al recrear, la función vuelve al GRANT por
--      defecto a PUBLIC. Si no se restauran, se abre un agujero de seguridad real
--      (p. ej. `delete_workspace`, que históricamente tenía REVOKE de PUBLIC/anon).
--      → Restauración obligatoria con el fichero 09 + verificación.
--
-- ORDEN DENTRO DE ESTE FICHERO
--   PARTE A (renombrado de funciones, seguro, conserva OID y ACL)
--   PARTE B (firma cambiada: DROP + CREATE + re-grant — instrucciones)
--   PARTE C (cuerpos reescritos — PASO MANUAL)
--   PARTE D (CONTROL DE VALIDACIÓN: aborta si queda nomenclatura legacy)
--   PARTE E (índice excluido en el 05 + parche de sus funciones)
--
-- TRANSACCIÓN: todo debe ejecutarse en UNA sola transacción con los ficheros 02–07.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE A — RENOMBRADO DE FUNCIONES (conserva OID, dependencias y ACL)
--
--   Cambia el NOMBRE público de la función. La llamada desde la aplicación va por
--   nombre, por lo que este paso es de tipo C (ventana coordinada) para las RPC que
--   el frontend invoca: create_workspace, workspace_deletion_summary, delete_workspace,
--   has_tenant_permission, save_tenant_role, accept_tenant_invitation.
--   (save_tenant_role y accept_tenant_invitation no se usan hoy desde el frontend:
--    el primero fue sustituido en Fase 1 por save_entity_role dentro de cada entidad.)
-- ============================================================================
DO $$
DECLARE
  m   record;
  sig text;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      -- (nombre_legacy, argumentos_de_identidad, nombre_definitivo)
      ('create_workspace',                  'text, text, boolean',                        'create_company_client'),
      ('workspace_deletion_target',         '',                                           'company_client_deletion_target'),
      ('workspace_deletion_summary',        'uuid',                                       'company_client_deletion_summary'),
      ('delete_workspace',                  'uuid, text',                                 'delete_company_client'),
      ('has_tenant_permission',             'text',                                       'has_company_client_permission'),
      ('can_use_tenant_permission',         'uuid, text',                                 'can_use_company_client_permission'),
      ('can_list_tenant_memberships',       'uuid',                                       'can_list_company_client_memberships'),
      ('can_invite_to_tenant',              'uuid',                                       'can_invite_to_company_client'),
      ('accept_tenant_invitation',          'uuid',                                       'accept_company_client_invitation'),
      ('save_tenant_role',                  'uuid, uuid, text, text, boolean, uuid[]',     'save_company_client_role'),
      ('save_tenant_role',                  'uuid, uuid, uuid, text, text, boolean, uuid[]', 'save_company_client_role'),
      ('tenant_invitation_role_entity',     '',                                           'company_client_invitation_role_entity'),
      ('tenant_invitation_entity_same_tenant', '',                                        'company_client_invitation_entity_same_company_client'),
      ('entity_user_access_same_tenant',    '',                                           'entity_user_access_same_company_client'),
      ('candidates_tenant_entity_same_tenant', '',                                        'candidates_entity_same_company_client'),
      ('organization_entity_parent_is_tenant_safe', '',                                   'organization_entity_parent_is_company_client_safe'),
      ('protect_system_tenant_role',        '',                                           'protect_system_company_client_role'),
      ('protect_system_tenant_role_permissions', '',                                      'protect_system_company_client_role_permissions'),
      ('grant_tenant_permission_to_system_roles', '',                                     'grant_company_client_permission_to_system_roles')
    ) AS t(old_name, identity_args, new_name)
  LOOP
    sig := 'public.' || m.old_name || '(' || m.identity_args || ')';

    IF to_regprocedure(sig) IS NULL THEN
      RAISE NOTICE 'OMITIDA función % (ya renombrada o inexistente)', sig;
      CONTINUE;
    END IF;

    IF to_regprocedure('public.' || m.new_name || '(' || m.identity_args || ')') IS NOT NULL THEN
      RAISE EXCEPTION 'CONFLICTO: ya existe public.%(%).', m.new_name, m.identity_args;
    END IF;

    EXECUTE format('ALTER FUNCTION %s RENAME TO %I', sig, m.new_name);

    INSERT INTO phase2_migration.rename_log (object_kind, object_old, object_new)
    VALUES ('FUNCTION', sig, 'public.' || m.new_name || '(' || m.identity_args || ')');

    RAISE NOTICE 'RENOMBRADA función % → %(%)', sig, m.new_name, m.identity_args;
  END LOOP;
END $$;

-- Verificación PARTE A: ESPERADO 0 filas.
SELECT p.proname AS funcion_legacy_restante
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_workspace','workspace_deletion_target','workspace_deletion_summary',
                    'delete_workspace','has_tenant_permission','can_use_tenant_permission',
                    'can_list_tenant_memberships','can_invite_to_tenant','accept_tenant_invitation',
                    'save_tenant_role','tenant_invitation_role_entity',
                    'tenant_invitation_entity_same_tenant','entity_user_access_same_tenant',
                    'candidates_tenant_entity_same_tenant','organization_entity_parent_is_tenant_safe',
                    'protect_system_tenant_role','protect_system_tenant_role_permissions',
                    'grant_tenant_permission_to_system_roles')
ORDER BY 1;

-- ============================================================================
-- PARTE B — FUNCIONES CON FIRMA CAMBIADA: DROP + CREATE (instrucciones)
--
--   NO SE EJECUTAN AQUÍ. Ejecutarlas sin crear a continuación la función nueva
--   dejaría la aplicación sin esos puntos de entrada.
--   Las sentencias DROP se dejan preparadas y comentadas; el CREATE correspondiente
--   pertenece a la PARTE C (cuerpos nuevos).
--
--   Cambian de firma porque se renombra un PARÁMETRO o una COLUMNA DE SALIDA:
--     · delete_company_client(p_tenant_id → p_company_client_id, p_confirmation_name)
--     · company_client_deletion_summary(p_tenant_id → p_company_client_id)
--     · can_use_company_client_permission(target_tenant_id → target_company_client_id, ...)
--     · can_list_company_client_memberships(p_tenant_id → p_company_client_id)
--     · can_invite_to_company_client(target_tenant_id → target_company_client_id)
--     · save_company_client_role ×2 (p_tenant_id → p_company_client_id)
--         └ la sobrecarga de 6 argumentos tenía REVOKE ALL FROM PUBLIC + GRANT a
--           authenticated y service_role (20260922_03): reproducirlo es obligatorio.
--     · create_worker_medical_certificate(p_tenant_id → p_company_client_id, ...)
--         └ afecta al frontend: src/domains/vacations-licenses/medical-certificates/
--           infrastructure/medical-certificates.repository.ts (clave `p_tenant_id`).
--     · list_entity_user_access(uuid): columnas de salida
--         tenant_membership_id → company_client_membership_id
--         tenant_role_id       → company_client_role_id
--         └ afecta al frontend: entity-users-dialog.tsx, roles-manager.tsx,
--           CompanyClientUsers.tsx, OrganizationDetail.tsx, EntitySettingsUsers.tsx.
--
--   PLANTILLA OBLIGATORIA (por cada función de la lista anterior):
--     1) DROP FUNCTION public.<nombre_nuevo>(<tipos>);         -- p. ej. (uuid, text)
--     2) CREATE FUNCTION public.<nombre_nuevo>(...) <cuerpo nuevo de la PARTE C>;
--        - preservar LANGUAGE, VOLATILITY, SECURITY DEFINER, SET search_path,
--          RETURNS y los valores DEFAULT exactamente como están hoy
--          (fuente: phase2_migration.function_definition_snapshot).
--        - NUNCA cambiar SECURITY DEFINER → SECURITY INVOKER ni al revés.
--     3) Restaurar la ACL con el fichero 09 (obligatorio, paso 3 de la plantilla).
--
--   DROP preparado (descomentar SOLO junto con el CREATE del paso 2):
--     -- DROP FUNCTION public.delete_company_client(uuid, text);
--     -- DROP FUNCTION public.company_client_deletion_summary(uuid);
--     -- DROP FUNCTION public.can_use_company_client_permission(uuid, text);
--     -- DROP FUNCTION public.can_list_company_client_memberships(uuid);
--     -- DROP FUNCTION public.can_invite_to_company_client(uuid);
--     -- DROP FUNCTION public.save_company_client_role(uuid, uuid, text, text, boolean, uuid[]);
--     -- DROP FUNCTION public.save_company_client_role(uuid, uuid, uuid, text, text, boolean, uuid[]);
--     -- DROP FUNCTION public.create_worker_medical_certificate(uuid, uuid, uuid, date, date, integer, uuid, uuid);
--     -- DROP FUNCTION public.list_entity_user_access(uuid);
--
--   Antes de ejecutar los DROP, comprobar que NADIE depende de ellas por nombre en
--   texto (los cuerpos de otras funciones y las políticas RLS): ver PARTE D.
-- ============================================================================

-- ============================================================================
-- PARTE C — REESCRITURA DE CUERPOS (PASO MANUAL OBLIGATORIO)
--
--   REGLA 1 (renombrado físico dentro del cuerpo):
--     tenants                        → company_clients
--     tenant_memberships             → company_client_memberships
--     tenant_roles                   → company_client_roles
--     tenant_role_permissions        → company_client_role_permissions
--     tenant_user_roles              → company_client_user_roles
--     tenant_invitations             → company_client_invitations
--     tenant_permissions             → company_client_permissions
--     .tenant_id                     → .company_client_id
--     .tenant_membership_id          → .company_client_membership_id
--     .tenant_role_id                → .company_client_role_id
--     .tenant_permission_id          → .company_client_permission_id
--     public.<función de la PARTE A> → public.<nombre definitivo>
--       (incluye workspace_deletion_target() → company_client_deletion_target()
--        y las llamadas a can_use_tenant_permission / has_tenant_permission)
--     public.tenants%ROWTYPE         → public.company_clients%ROWTYPE
--     public.tenant_*%ROWTYPE        → public.company_client_*%ROWTYPE
--
--   REGLA 2 (lo que NO se toca):
--     · Nombres de parámetros que NO sean de cliente (p_confirmation_name, …).
--     · Claves de permiso almacenadas ('roles.manage', 'users.view', 'tenants.delete',
--       'tenant_roles.manage') y el patrón regex de catálogo:
--         '(^areas\.|^jobs\.|^tenant_roles\.|_global$|_empresarial$)'
--       → Son DATOS / código de permiso: su cambio es un paso D (informe §6).
--     · Mensajes de error que la aplicación compara o muestra:
--       "workspace was not found" (roles-manager.tsx), "No tienes permiso para
--       eliminar workspaces", "El código del workspace es un identificador estable…".
--       → Si se traducen, hacerlo en el MISMO despliegue del frontend.
--     · `SET search_path`, `SECURITY DEFINER`, `VOLATILITY` y `DEFAULT` existentes.
--
--   REGLA 3 (contratos de respuesta jsonb — bloque de decisión, informe §6):
--     · delete_company_client / company_client_deletion_summary: las claves
--       'tenant_id' y 'tenant_name' SOLO cambian a 'company_client_id' /
--       'company_client_name' junto al frontend (src/lib/company-clients.ts) y la
--       Edge Function delete-workspace. Si se prefiere desacoplar, MANTENER las
--       claves legacy de forma temporal (compatibilidad tipo B) y eliminarlas en la
--       Fase 3.
--     · get_worker_medical_certificate: clave 'tenant_id' → misma decisión.
--     · Ajuste de sesión `app.workspace_deletion` → `app.company_client_deletion`
--       (debe cambiarse a la vez en delete_company_client y en
--       company_client_deletion_target; si se difiere, mantener el nombre actual).
--
--   FUNCIONES CON CUERPO A REESCRIBIR (52) — matriz de trabajo:
--     [A] ya renombradas en la PARTE A / 06 (nombre nuevo, cuerpo nuevo):
--       create_company_client, delete_company_client*, company_client_deletion_summary*,
--       company_client_deletion_target, has_company_client_permission,
--       can_use_company_client_permission*, can_list_company_client_memberships*,
--       can_invite_to_company_client*, accept_company_client_invitation,
--       save_company_client_role ×2*, company_client_invitation_role_entity,
--       company_client_invitation_entity_same_company_client,
--       entity_user_access_same_company_client, candidates_entity_same_company_client,
--       organization_entity_parent_is_company_client_safe,
--       protect_system_company_client_role,
--       protect_system_company_client_role_permissions,
--       grant_company_client_permission_to_system_roles
--       (*) = además firma cambiada (PARTE B)
--     [B] mismo nombre, cuerpo nuevo (CREATE OR REPLACE):
--       can_access_entity
--       can_view_entity_user, can_view_platform_user, can_manage_platform_user
--       list_entity_permissions, list_entity_user_access* (firma: columnas de salida)
--       ensure_entity_administrator_role, grant_initial_import_permission_to_system_roles
--       representative_assignment_sync_entity, organization_entity_hierarchy_is_valid
--       candidates_prevent_duplicate_person
--       save_entity_role, delete_entity_role
--       create_worker_resolution, create_worker_with_position (PARTE E),
--       hire_candidate, reincorporate_worker, change_worker_contract,
--       complete_worker_contract, create_payroll_movement,
--       apply_salary_group_value_change, finalize_salary_change_event,
--       create_representative_position, set_entity_representative,
--       save_academic_category_payment, prenomina_create_period,
--       register_worker_vacation, adjust_worker_vacation_balance,
--       cancel_worker_vacation, vacation_post_accrual_internal,
--       set_worker_vacation_opening_balance,
--       migration_create_worker (PARTE E), migration_import_rows,
--       migration_validate_rows, person_identification_status,
--       create_contract_addendum, get_worker_medical_certificate (REGLA 3),
--       create_worker_medical_certificate* (firma: p_tenant_id)
--     [C] NO requieren cambios (verificado: su cuerpo no menciona nada legacy):
--       can_view_entity, can_manage_entity, can_manage_salary_scale, is_platform_*,
--       is_entity_descendant, has_platform_permission, save_platform_role,
--       contract_* (salary_context, formalized_*, retribution_*, condition_*,
--       current_payment_method, expiry_alerts), position_*, capture_*,
--       apply_contract_conditions, change_worker_position, link_worker_to_position,
--       register_worker_separation, prenomina_recalc_entry / save_night / save_cla /
--       upsert_inputs / close_period / reopen_period / refresh_workers / cla_config,
--       worker_vacation_* (balance, summary, accrual_*, count_working_days, …),
--       resolve_salary_*, resolve_tenure_*, resolve_academic_*,
--       entity_staffing_export, entity_positions_anexo14, report_worker_demographics,
--       document_template_*/document_*/begin_*_generation, fail/complete_document_generation,
--       validate_* , format_*, sitecorp_code_*, generate_*_code, is_platform_user,
--       adjust/… (los no listados arriba), update_worker_medical_certificate,
--       list_worker_medical_certificates, list_entity_medical_certificates,
--       migration_create_single_worker, worker_last_recorded_salary,
--       record_worker_salary_event, assign_addendum_number, preview_salary_change,
--       recompute_salary_group_value_chain, resolve_document_template_version,
--       get_contract_document_data, get_addendum_document_data,
--       get_payroll_movement_document_data, get_resolution_document_data,
--       resolution_worker_context, validate_document_template_version,
--       activate/deactivate_document_template_version,
--       set_document_template_version_file, set_contract/addendum_document_template_version,
--       create_document_template(_version), save_document_template_analysis,
--       create_document_batches_for_event, update_job_work_content,
--       update_representative_position, resolve_entity_representative(s),
--       organization_areas_*(generate_code/validate), organization_jobs_generate_code,
--       position_schedule_segment_sync
-- ============================================================================

-- ============================================================================
-- PARTE D — CONTROL DE VALIDACIÓN (EJECUTABLE, solo lectura)
--   Debe devolver 0 filas. Si devuelve filas, la migración NO está terminada:
--   esas funciones fallarían en runtime cuando las llamara la aplicación.
-- ============================================================================
SELECT p.proname AS funcion_pendiente,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       (p.prosrc ~ 'tenant_id|tenants|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id') AS cuerpo_con_legacy,
       EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%') AS parametro_con_legacy,
       (pg_get_function_result(p.oid) ILIKE '%tenant%') AS retorno_con_legacy
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.prosrc ~ 'tenant_id|tenants|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id'
       OR EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%')
       OR pg_get_function_result(p.oid) ILIKE '%tenant%')
ORDER BY 1;

-- CONTROL BLOQUEANTE (descomentar al final de la ventana):
--   Aborta la transacción si queda cualquier resto de nomenclatura legacy en el
--   código de la base de datos. Es el "semáforo" de la Fase 2.
-- DO $$
-- DECLARE v_pendientes text;
-- BEGIN
--   SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
--     INTO v_pendientes
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND (p.prosrc ~ 'tenant_id|tenants|tenant_memberships|tenant_roles|tenant_user_roles|tenant_invitations|tenant_permission|tenant_role_id|tenant_membership_id'
--          OR EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a ILIKE '%tenant%')
--          OR pg_get_function_result(p.oid) ILIKE '%tenant%');
--
--   IF v_pendientes IS NOT NULL THEN
--     RAISE EXCEPTION 'MIGRACIÓN INCOMPLETA: quedan referencias legacy en: %', v_pendientes;
--   END IF;
-- END $$;

-- ============================================================================
-- PARTE E — ÍNDICE EXCLUIDO EN EL FICHERO 05 + PARCHE DE SUS DOS FUNCIONES
--   `workers_tenant_code_unique` se compara POR NOMBRE en PL/pgSQL:
--       create_worker_with_position():  SQLERRM LIKE '%workers_tenant_code_unique%'
--       migration_create_worker():      SQLERRM LIKE '%workers_tenant_code_unique%'
--   Si se renombra el índice sin parchear ambas funciones, la colisión de código de
--   trabajador deja de reintentarse y se convierte en un error fatal para el usuario.
--   → Ejecutar el renombrado y el parche de las dos funciones en la MISMA
--     transacción (paso manual obligatorio, dentro de la PARTE C).
--
--   -- ALTER INDEX public.workers_tenant_code_unique
--   --   RENAME TO workers_company_client_code_unique;
--
--   Observación (no se corrige en esta fase): create_worker_with_position() también
--   compara '%workers_tenant_ci_active_unique%', índice que NO existe en el esquema
--   real (el real es `workers_tenant_ci_unique`, cuyo predicado excluye el origen
--   'MIGRATION'). Es una rama muerta que documenta el informe.
-- ============================================================================

COMMIT;

-- ============================================================================
-- ESTADO DEL FICHERO: PREPARADO PARCIALMENTE.
--   · PARTE A y PARTE D: listas, ejecutables tras los ficheros 02–07.
--   · PARTE B, PARTE C y PARTE E: PASO MANUAL OBLIGATORIO (ver informe §10).
--   · NO PRESENTAR COMO LISTO PARA PRODUCCIÓN HASTA COMPLETAR LA PARTE C.
-- ============================================================================
