-- ============================================================================
-- Migración: Soporte de clientes de Cuenta propia y entidades TCP, MIPYME y PYME
-- ============================================================================
BEGIN;

-- 1. Columna is_self_employed en company_clients
ALTER TABLE public.company_clients
  ADD COLUMN IF NOT EXISTS is_self_employed boolean NOT NULL DEFAULT false;

-- 2. Impedir cambiar is_self_employed si el cliente ya tiene entidades registradas
CREATE OR REPLACE FUNCTION public.enforce_company_client_self_employed_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_self_employed IS DISTINCT FROM OLD.is_self_employed THEN
    IF EXISTS (
      SELECT 1
      FROM public.organization_entities oe
      WHERE oe.company_client_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'No se puede cambiar la modalidad Cuenta propia de un cliente que ya tiene entidades creadas'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS company_clients_self_employed_immutable ON public.company_clients;
CREATE TRIGGER company_clients_self_employed_immutable
  BEFORE UPDATE OF is_self_employed ON public.company_clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_company_client_self_employed_immutable();

-- 3. Actualizar RPC create_company_client con soporte para p_is_self_employed
DROP FUNCTION IF EXISTS public.create_company_client(text, text, boolean);

CREATE OR REPLACE FUNCTION public.create_company_client(
  p_name text,
  p_description text DEFAULT NULL::text,
  p_is_active boolean DEFAULT true,
  p_is_self_employed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_suffix_length CONSTANT integer := 6;
  v_max_attempts CONSTANT integer := 20;
  v_base_max_length CONSTANT integer := 48;
  v_name text;
  v_base text;
  v_code text;
  v_suffix text;
  v_attempt integer := 0;
  v_index integer;
  v_tenant public.company_clients%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_platform_superadmin() THEN
    RAISE EXCEPTION 'No tiene permiso para crear workspaces';
  END IF;

  v_name := btrim(coalesce(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'El nombre del workspace es obligatorio';
  END IF;

  -- Normalización del nombre: mayúsculas, sin acentos, separadores seguros
  v_base := upper(v_name);
  v_base := translate(
    v_base,
    'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙäëïöüÄËÏÖÜâêîôûÂÊÎÔÛçÇ',
    'aeiouunAEIOUUNaeiouAEIOUaeiouAEIOUaeiouAEIOUcC'
  );
  v_base := regexp_replace(v_base, '[^A-Z0-9]+', '-', 'g');
  v_base := btrim(regexp_replace(v_base, '-+', '-', 'g'), '-');

  IF v_base = '' THEN
    v_base := 'WORKSPACE';
  END IF;

  IF length(v_base) > v_base_max_length THEN
    v_base := btrim(substr(v_base, 1, v_base_max_length), '-');
  END IF;

  -- Sufijo alfanumérico único con reintento ante colisión
  LOOP
    v_attempt := v_attempt + 1;
    v_suffix := '';

    FOR v_index IN 1..v_suffix_length LOOP
      v_suffix := v_suffix || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::integer,
        1
      );
    END LOOP;

    v_code := v_base || '-' || v_suffix;

    BEGIN
      INSERT INTO public.company_clients (name, code, description, is_active, is_self_employed)
      VALUES (
        v_name,
        v_code,
        nullif(btrim(coalesce(p_description, '')), ''),
        coalesce(p_is_active, true),
        coalesce(p_is_self_employed, false)
      )
      RETURNING * INTO v_tenant;

      RETURN jsonb_build_object(
        'id', v_tenant.id,
        'name', v_tenant.name,
        'code', v_tenant.code,
        'description', v_tenant.description,
        'is_active', v_tenant.is_active,
        'is_self_employed', v_tenant.is_self_employed
      );
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= v_max_attempts THEN
        RAISE EXCEPTION 'No se pudo generar un código único para el workspace tras % intentos', v_max_attempts;
      END IF;
    END;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_company_client(text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company_client(text, text, boolean, boolean) TO authenticated, service_role;

-- 4. Ampliar constraint de tipos de entidad en organization_entities
ALTER TABLE public.organization_entities
  DROP CONSTRAINT IF EXISTS organization_entities_entity_type_check;

ALTER TABLE public.organization_entities
  ADD CONSTRAINT organization_entities_entity_type_check
  CHECK (
    entity_type = ANY (
      ARRAY[
        'business_group'::text,
        'company'::text,
        'ueb'::text,
        'tcp'::text,
        'mipyme'::text,
        'pyme'::text
      ]
    )
  );

-- 5. Actualizar validación jerárquica según modalidad del cliente (Cuenta propia vs Clásico)
CREATE OR REPLACE FUNCTION public.organization_entity_hierarchy_is_valid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  parent_type text;
  parent_tenant uuid;
  walker uuid;
  v_is_self_employed boolean := false;
BEGIN
  SELECT coalesce(cc.is_self_employed, false)
    INTO v_is_self_employed
  FROM public.company_clients cc
  WHERE cc.id = NEW.company_client_id;

  IF v_is_self_employed THEN
    IF NEW.entity_type NOT IN ('tcp', 'mipyme', 'pyme') THEN
      RAISE EXCEPTION 'Invalid organization entity type for self-employed client'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Self-employed entities must not have a parent'
        USING ERRCODE = '23514';
    END IF;

    NEW.regime_id := 'EMPRESARIAL';
    RETURN NEW;
  END IF;

  IF NEW.entity_type NOT IN ('business_group', 'company', 'ueb') THEN
    RAISE EXCEPTION 'Invalid organization entity type'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.entity_type = 'business_group' THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Business group must not have a parent'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'Company and UEB must have a parent'
      USING ERRCODE = '23514';
  END IF;

  SELECT entity_type, company_client_id
    INTO parent_type, parent_tenant
  FROM public.organization_entities
  WHERE id = NEW.parent_id;

  IF parent_type IS NULL THEN
    RAISE EXCEPTION 'Parent organization entity was not found'
      USING ERRCODE = '23514';
  END IF;

  IF parent_tenant <> NEW.company_client_id THEN
    RAISE EXCEPTION 'Organization entity parent must belong to the same tenant'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.entity_type = 'company' AND parent_type <> 'business_group' THEN
    RAISE EXCEPTION 'Company parent must be a business group'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.entity_type = 'ueb' AND parent_type <> 'company' THEN
    RAISE EXCEPTION 'UEB parent must be a company'
      USING ERRCODE = '23514';
  END IF;

  walker := NEW.parent_id;
  WHILE walker IS NOT NULL LOOP
    IF walker = NEW.id THEN
      RAISE EXCEPTION 'Organization hierarchy cycle is not allowed'
        USING ERRCODE = '23514';
    END IF;
    SELECT parent_id INTO walker
    FROM public.organization_entities
    WHERE id = walker;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS organization_entities_hierarchy_is_valid ON public.organization_entities;
CREATE TRIGGER organization_entities_hierarchy_is_valid
  BEFORE INSERT OR UPDATE OF parent_id, company_client_id, entity_type, regime_id
  ON public.organization_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.organization_entity_hierarchy_is_valid();

COMMIT;
