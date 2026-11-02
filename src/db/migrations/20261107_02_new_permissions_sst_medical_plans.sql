-- 20261107_02_new_permissions_sst_medical_plans.sql
-- Nuevos permisos para la Plataforma (Nivel 1) y para Entidades (Nivel 2).
-- Compatible con `company_client_permissions` (nombre actual tras normalización de tablas)
-- y fallback a `tenant_permissions`.

-- ============================================================================
-- 1. Permisos GLOBALES de Plataforma (Nivel 1)
-- ============================================================================
INSERT INTO public.platform_permissions (code, description, category, is_platform_scope)
VALUES
  ('entity_plans.view', 'Ver planes de entidades', 'PLANES', true),
  ('entity_plans.manage', 'Gestionar planes de entidades', 'PLANES', true),
  ('platform_documents.view', 'Ver documentos normativos de plataforma', 'DOCUMENTOS GLOBALES', true),
  ('platform_documents.manage', 'Administrar documentos de plataforma', 'DOCUMENTOS GLOBALES', true),
  ('platform_audit.view', 'Consultar historial de auditoría global', 'AUDITORÍA', true),
  ('platform_candidates.view', 'Ver bolsa general de candidatos', 'CANDIDATOS', true),
  ('platform_candidates.manage', 'Gestionar bolsa general de candidatos', 'CANDIDATOS', true)
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_platform_scope = EXCLUDED.is_platform_scope,
    retired_at = NULL;

-- Asignar los nuevos permisos de plataforma al rol SuperAdmin
-- (Columnas canónicas: platform_role_id, platform_permission_id)
INSERT INTO public.platform_role_permissions (platform_role_id, platform_permission_id)
SELECT pr.id, pp.id
FROM public.platform_roles pr
CROSS JOIN public.platform_permissions pp
WHERE lower(pr.name) = 'superadmin'
  AND pp.code IN (
    'entity_plans.view',
    'entity_plans.manage',
    'platform_documents.view',
    'platform_documents.manage',
    'platform_audit.view',
    'platform_candidates.view',
    'platform_candidates.manage'
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Permisos INTERNOS de Entidad (Nivel 2)
--    En la base de datos de SiteCorp la tabla se normalizó a `company_client_permissions`
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.company_client_permissions') IS NOT NULL THEN
    INSERT INTO public.company_client_permissions (code, description)
    VALUES
      ('sst.view', 'Ver seguridad y salud en el trabajo'),
      ('sst.manage', 'Gestionar seguridad y salud en el trabajo'),
      ('medical_certificates.view', 'Ver licencias y certificados médicos'),
      ('medical_certificates.manage', 'Gestionar certificados médicos y licencias'),
      ('resolutions.view', 'Ver resoluciones laborales'),
      ('resolutions.manage', 'Emitir y gestionar resoluciones laborales'),
      ('entity_audit.view', 'Ver historial y auditoría de la entidad')
    ON CONFLICT (code) DO UPDATE
    SET description = EXCLUDED.description;
  ELSIF to_regclass('public.tenant_permissions') IS NOT NULL THEN
    INSERT INTO public.tenant_permissions (code, description)
    VALUES
      ('sst.view', 'Ver seguridad y salud en el trabajo'),
      ('sst.manage', 'Gestionar seguridad y salud en el trabajo'),
      ('medical_certificates.view', 'Ver licencias y certificados médicos'),
      ('medical_certificates.manage', 'Gestionar certificados médicos y licencias'),
      ('resolutions.view', 'Ver resoluciones laborales'),
      ('resolutions.manage', 'Emitir y gestionar resoluciones laborales'),
      ('entity_audit.view', 'Ver historial y auditoría de la entidad')
    ON CONFLICT (code) DO UPDATE
    SET description = EXCLUDED.description;
  END IF;
END $$;
