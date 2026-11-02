-- ============================================================================
-- SITECORP · SCRIPT INDEPENDIENTE Y OPCIONAL DE VINCULACIÓN DE ACCESO AL DEMO
-- Cliente demostrativo: «Grupo Empresarial Horizonte»
-- Archivo: src/db/seeds/20261109_demo_grupo_horizonte_access.sql
-- ============================================================================
-- NOTA IMPORTANTE
--   1. Los usuarios con rol global `super_admin` o `is_platform_founder = true`
--      en `public.profiles` YA TIENEN ACCESO COMPLETO al cliente DEMO a través
--      de `public.is_super_admin()` sin necesidad de ejecutar este script.
--   2. Este script es EXCLUSIVAMENTE para el caso en que se desee autorizar
--      manualmente a un usuario específico (que NO sea SuperAdmin) a visualizar
--      el cliente DEMO «Grupo Empresarial Horizonte».
--   3. NO se ejecuta junto con `20261109_demo_grupo_horizonte.sql` ni modifica
--      permisos de forma masiva. Debe indicarse explícitamente el correo del
--      usuario en `v_target_user_email`.
-- ============================================================================

BEGIN;

DO $demo_horizonte_access$
DECLARE
  -- Correo del usuario a autorizar (preconfigurado con tu usuario de acceso):
  v_target_user_email CONSTANT text := 'imaceod96@gmail.com';

  v_target_user_id uuid;
  v_client_id uuid;
  v_osde_entity_id uuid;
  v_admin_role_id uuid;
  v_membership_id uuid;
BEGIN
  SELECT p.id INTO v_target_user_id
  FROM public.profiles AS p
  INNER JOIN auth.users AS u
      ON u.id = p.id
  WHERE lower(btrim(u.email)) = lower(btrim(v_target_user_email))
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'usuario_no_encontrado: No existe ningún perfil en public.profiles vinculado al usuario con correo % en auth.users.', v_target_user_email;
  END IF;

  SELECT id INTO v_client_id
  FROM public.company_clients
  WHERE lower(btrim(name)) = lower('Grupo Empresarial Horizonte')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'cliente_demo_no_encontrado: Primero debe existir el cliente «Grupo Empresarial Horizonte».';
  END IF;

  SELECT id INTO v_osde_entity_id
  FROM public.organization_entities
  WHERE company_client_id = v_client_id
    AND entity_type = 'business_group'
    AND parent_id IS NULL
  LIMIT 1;

  SELECT id INTO v_admin_role_id
  FROM public.company_client_roles
  WHERE company_client_id = v_client_id
    AND organization_entity_id = v_osde_entity_id
    AND is_system_role = true
    AND lower(name) = 'administrador'
  LIMIT 1;

  INSERT INTO public.company_client_memberships (
    company_client_id, user_id, role, status, is_active
  ) VALUES (
    v_client_id, v_target_user_id, 'admin', 'active', true
  )
  ON CONFLICT (company_client_id, user_id)
  DO UPDATE SET status = 'active', is_active = true
  RETURNING id INTO v_membership_id;

  IF v_admin_role_id IS NOT NULL THEN
    INSERT INTO public.company_client_user_roles (
      company_client_membership_id, company_client_role_id
    ) VALUES (
      v_membership_id, v_admin_role_id
    )
    ON CONFLICT (company_client_membership_id, company_client_role_id) DO NOTHING;

    INSERT INTO public.entity_user_access (
      company_client_membership_id, organization_entity_id, company_client_role_id, access_scope
    ) VALUES (
      v_membership_id, v_osde_entity_id, v_admin_role_id, 'SELF_AND_DESCENDANTS'
    )
    ON CONFLICT (company_client_membership_id, organization_entity_id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Acceso al cliente DEMO «Grupo Empresarial Horizonte» otorgado al usuario % (%).', v_target_user_email, v_target_user_id;
END
$demo_horizonte_access$;

COMMIT;
