-- =============================================================================
-- Migración: Permisos de plataforma para acceder y configurar entidades
--            limitados al plan contratado (entity_plans)
-- Fecha: 2026-11-14
-- Descripción:
--   1. Agrega al catálogo de plataforma (`platform_permissions`) los permisos:
--        - entity_settings.view   (Ver configuraciones internas de las entidades)
--        - entity_settings.manage (Gestionar configuraciones internas de las entidades)
--        - entity_modules.view    (Ver módulos operativos dentro de las entidades)
--        - entity_modules.manage  (Gestionar módulos operativos dentro de las entidades)
--   2. Crea `is_entity_permission_enabled_in_plan(uuid, text)` para limitar todo
--      permiso interno de entidad a los paquetes activos en `entity_plans`.
--   3. Crea `platform_role_grants_entity_permission(text)` para traducir los
--      permisos de plataforma anteriores a permisos internos efectivos sin
--      requerir SuperAdmin ni membresía de cliente.
--   4. Actualiza `can_access_entity`, `list_entity_permissions` y
--      `can_view_entity` respetando siempre el plan contratado de la entidad.
-- =============================================================================

BEGIN;

-- 1. Catálogo de plataforma: permisos de acceso y configuración interna de entidades
INSERT INTO public.platform_permissions (code, description, category, is_platform_scope, retired_at)
VALUES
  (
    'entity_settings.view',
    'Ver configuraciones internas de las entidades',
    'ENTIDADES (ACCESO INTERNO)',
    true,
    NULL
  ),
  (
    'entity_settings.manage',
    'Gestionar configuraciones internas de las entidades',
    'ENTIDADES (ACCESO INTERNO)',
    true,
    NULL
  ),
  (
    'entity_modules.view',
    'Ver módulos operativos dentro de las entidades (según plan)',
    'ENTIDADES (ACCESO INTERNO)',
    true,
    NULL
  ),
  (
    'entity_modules.manage',
    'Gestionar módulos operativos dentro de las entidades (según plan)',
    'ENTIDADES (ACCESO INTERNO)',
    true,
    NULL
  )
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_platform_scope = EXCLUDED.is_platform_scope,
    retired_at = NULL;

-- 2. Límite por plan contratado (`entity_plans`)
CREATE OR REPLACE FUNCTION public.is_entity_permission_enabled_in_plan(
  target_entity_id uuid,
  permission_code text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prenomina boolean;
  v_training_sst boolean;
  v_found boolean := false;
BEGIN
  IF target_entity_id IS NULL OR permission_code IS NULL OR btrim(permission_code) = '' THEN
    RETURN true;
  END IF;

  SELECT ep.package_prenomina, ep.package_training_sst, true
    INTO v_prenomina, v_training_sst, v_found
  FROM public.entity_plans ep
  WHERE ep.entity_id = target_entity_id
  LIMIT 1;

  -- Compatibilidad segura: si aún no hay registro en entity_plans, se asume habilitado.
  IF NOT COALESCE(v_found, false) THEN
    RETURN true;
  END IF;

  IF permission_code IN ('prenomina.view', 'prenomina.manage') THEN
    RETURN COALESCE(v_prenomina, false);
  END IF;

  IF permission_code IN ('training.view', 'training.manage', 'sst.view', 'sst.manage') THEN
    RETURN COALESCE(v_training_sst, false);
  END IF;

  RETURN true;
END;
$function$;

-- 3. Traducción de permisos de plataforma a capacidades internas de entidad
CREATE OR REPLACE FUNCTION public.platform_role_grants_entity_permission(
  permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT CASE
    WHEN NOT public.is_platform_user_active() THEN false
    WHEN permission_code IS NULL OR btrim(permission_code) = '' THEN
      public.has_platform_permission('entity_settings.view')
      OR public.has_platform_permission('entity_settings.manage')
      OR public.has_platform_permission('entity_modules.view')
      OR public.has_platform_permission('entity_modules.manage')
    -- Configuraciones internas (lectura)
    WHEN permission_code IN (
      'organization.view',
      'users.view',
      'roles.view',
      'salary.view',
      'tenure_scale.view',
      'contract_data.view',
      'representatives.view',
      'document_templates.view'
    ) THEN
      public.has_platform_permission('entity_settings.view')
      OR public.has_platform_permission('entity_settings.manage')
    -- Lectura de plantilla (áreas, cargos, puestos): necesaria tanto en Ajustes como en módulos operativos
    WHEN permission_code = 'staffing.view' THEN
      public.has_platform_permission('entity_settings.view')
      OR public.has_platform_permission('entity_settings.manage')
      OR public.has_platform_permission('entity_modules.view')
      OR public.has_platform_permission('entity_modules.manage')
    -- Configuraciones internas (gestión y escritura)
    WHEN permission_code IN (
      'organization.manage',
      'users.manage',
      'users.invite',
      'roles.manage',
      'salary.manage',
      'tenure_scale.manage',
      'staffing.manage',
      'contract_data.manage',
      'representatives.manage',
      'document_templates.manage',
      'workers.initial_import'
    ) THEN
      public.has_platform_permission('entity_settings.manage')
    -- Módulos operativos dentro de entidades (lectura)
    WHEN permission_code IN (
      'candidates.view',
      'workers.view',
      'hiring.view',
      'contracts.view',
      'contract_addendums.view',
      'contract_alerts.view',
      'worker_documents.view',
      'resolutions.view',
      'vacations.view',
      'medical_certificates.view',
      'entity_audit.view',
      'reports.view',
      'prenomina.view',
      'training.view',
      'sst.view'
    ) THEN
      public.has_platform_permission('entity_modules.view')
      OR public.has_platform_permission('entity_modules.manage')
    -- Módulos operativos dentro de entidades (gestión y escritura)
    WHEN permission_code IN (
      'candidates.manage',
      'workers.manage',
      'hiring.manage',
      'contracts.manage',
      'contract_addendums.manage',
      'worker_documents.manage',
      'resolutions.manage',
      'vacations.manage',
      'medical_certificates.manage',
      'prenomina.manage',
      'training.manage',
      'sst.manage'
    ) THEN
      public.has_platform_permission('entity_modules.manage')
    ELSE false
  END;
$function$;

-- 4. Resolución unificada de acceso interno a entidad (SuperAdmin, Plataforma o Cliente)
CREATE OR REPLACE FUNCTION public.can_access_entity(
  target_entity_id uuid,
  permission_code text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  target_record public.organization_entities%ROWTYPE;
  assigned_record public.organization_entities%ROWTYPE;
  assignment public.entity_user_access%ROWTYPE;
  has_permission boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_platform_user_active() THEN
    RETURN false;
  END IF;

  IF public.is_platform_superadmin() THEN
    RETURN true;
  END IF;

  SELECT * INTO target_record
  FROM public.organization_entities
  WHERE id = target_entity_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF COALESCE(target_record.is_active, true) = false THEN
    RETURN false;
  END IF;

  IF COALESCE(target_record.is_sitecorp_account, false) = true
     AND COALESCE(target_record.account_is_active, false) = false THEN
    RETURN false;
  END IF;

  -- Límite obligatorio por plan contratado de la entidad
  IF permission_code IS NOT NULL
     AND btrim(permission_code) <> ''
     AND NOT public.is_entity_permission_enabled_in_plan(target_entity_id, permission_code) THEN
    RETURN false;
  END IF;

  -- Permisos delegados desde rol de plataforma (usuarios de SiteCorp no SuperAdmin)
  IF public.platform_role_grants_entity_permission(permission_code) THEN
    RETURN true;
  END IF;

  -- Accesos propios de usuario de empresa/entidad (`entity_user_access`)
  FOR assignment IN
    SELECT eua.*
    FROM public.entity_user_access eua
    JOIN public.company_client_memberships tm ON tm.id = eua.company_client_membership_id
    JOIN public.company_client_roles tr ON tr.id = eua.company_client_role_id
    JOIN public.organization_entities assigned ON assigned.id = eua.organization_entity_id
    WHERE tm.user_id = auth.uid()
      AND tm.is_active = true
      AND eua.is_active = true
      AND tr.is_active = true
      AND COALESCE(assigned.is_active, true) = true
      AND tm.company_client_id = target_record.company_client_id
      AND assigned.company_client_id = target_record.company_client_id
      AND tr.company_client_id = target_record.company_client_id
      AND tr.organization_entity_id IS NOT NULL
      AND tr.organization_entity_id = eua.organization_entity_id
  LOOP
    SELECT * INTO assigned_record
    FROM public.organization_entities
    WHERE id = assignment.organization_entity_id;

    IF COALESCE(assigned_record.is_sitecorp_account, false) = true
       AND COALESCE(assigned_record.account_is_active, false) = false THEN
      CONTINUE;
    END IF;

    IF assignment.access_scope = 'SELF' AND assignment.organization_entity_id <> target_entity_id THEN
      CONTINUE;
    END IF;

    IF assignment.access_scope = 'SELF_AND_DESCENDANTS'
       AND assignment.organization_entity_id <> target_entity_id
       and NOT public.is_entity_descendant(assignment.organization_entity_id, target_entity_id) THEN
      CONTINUE;
    END IF;

    IF permission_code IS NULL OR btrim(permission_code) = '' THEN
      RETURN true;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.company_client_role_permissions trp
      JOIN public.company_client_permissions tp ON tp.id = trp.company_client_permission_id
      WHERE trp.company_client_role_id = assignment.company_client_role_id
        AND tp.code = permission_code
    ) INTO has_permission;

    IF has_permission THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;

-- 5. Listado de permisos efectivos (siempre limitado al plan contratado)
CREATE OR REPLACE FUNCTION public.list_entity_permissions(target_entity_id uuid)
RETURNS TABLE(permission_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  WITH authorized AS (
    SELECT public.is_platform_user_active()
       AND (
         public.is_platform_superadmin()
         OR public.can_access_entity(target_entity_id, NULL)
       ) AS allowed
  ),
  catalog AS (
    SELECT tp.code
    FROM public.company_client_permissions tp
    WHERE tp.code !~ '(^areas\.|^jobs\.|^tenant_roles\.|_global$|_empresarial$)'
  )
  SELECT catalog.code
  FROM catalog
  CROSS JOIN authorized
  WHERE authorized.allowed
    AND public.is_entity_permission_enabled_in_plan(target_entity_id, catalog.code)
    AND (
      public.is_platform_superadmin()
      OR public.can_access_entity(target_entity_id, catalog.code)
    );
$function$;

-- 6. Acceso de lectura de entidad (`can_view_entity`)
CREATE OR REPLACE FUNCTION public.can_view_entity(target_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.is_platform_superadmin()
      OR public.has_platform_permission('organizations.view_all')
      OR public.has_platform_permission('organizations.manage_all')
      OR public.has_platform_permission('entity_settings.view')
      OR public.has_platform_permission('entity_settings.manage')
      OR public.has_platform_permission('entity_modules.view')
      OR public.has_platform_permission('entity_modules.manage')
      OR public.can_access_entity(target_entity_id, NULL)
      OR public.can_access_entity(target_entity_id, 'organization.view')
      OR public.can_access_entity(target_entity_id, 'organization.manage');
$function$;

REVOKE ALL ON FUNCTION public.is_entity_permission_enabled_in_plan(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.platform_role_grants_entity_permission(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_entity_permission_enabled_in_plan(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_role_grants_entity_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_entity(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_entity_permissions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_entity(uuid) TO authenticated, service_role;

COMMIT;
