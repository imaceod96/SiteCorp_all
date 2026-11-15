-- =============================================================================
-- QA Fixes #6 & #8 (Altos):
--   #6: Validación backend de fecha real (AAMMDD) en CI y coincidencia con birth_date
--   #8: resolve_entity_representatives con p_on_date NULL usa CURRENT_DATE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #6. Validación del carné de identidad cubano (11 dígitos + fecha real AAMMDD
--     + coincidencia con fecha de nacimiento si se informa)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_cuban_ci_and_birth_date(
  p_identification text,
  p_birth_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_ci text := btrim(COALESCE(p_identification, ''));
  v_yy integer;
  v_mm integer;
  v_dd integer;
  v_year integer;
  v_derived_date date;
BEGIN
  IF v_ci !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'El número de identificación debe contener exactamente 11 dígitos.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_yy := substring(v_ci, 1, 2)::integer;
  v_mm := substring(v_ci, 3, 2)::integer;
  v_dd := substring(v_ci, 5, 2)::integer;

  IF v_mm < 1 OR v_mm > 12 OR v_dd < 1 OR v_dd > 31 THEN
    RAISE EXCEPTION 'Los primeros 6 dígitos del carné de identidad no corresponden a una fecha válida (AAMMDD).'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Si se conoce la fecha de nacimiento usamos su siglo si coincide en YY;
  -- en caso contrario resolvemos el siglo estándar (50-99 => 1900, 00-49 => 2000).
  IF p_birth_date IS NOT NULL AND (EXTRACT(YEAR FROM p_birth_date)::integer % 100) = v_yy THEN
    v_year := EXTRACT(YEAR FROM p_birth_date)::integer;
  ELSIF v_yy >= 50 THEN
    v_year := 1900 + v_yy;
  ELSE
    v_year := 2000 + v_yy;
  END IF;

  BEGIN
    v_derived_date := pg_catalog.make_date(v_year, v_mm, v_dd);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Los primeros 6 dígitos del carné de identidad no corresponden a una fecha válida (AAMMDD).'
      USING ERRCODE = 'check_violation';
  END;

  IF p_birth_date IS NOT NULL AND pg_catalog.to_char(p_birth_date, 'YYMMDD') IS DISTINCT FROM left(v_ci, 6) THEN
    RAISE EXCEPTION 'Los primeros 6 dígitos del carné de identidad no coinciden con la fecha de nacimiento.'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_identification_format()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.identification IS DISTINCT FROM OLD.identification
     OR NEW.birth_date IS DISTINCT FROM OLD.birth_date THEN
    PERFORM public.validate_cuban_ci_and_birth_date(NEW.identification, NEW.birth_date);
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- #8. resolve_entity_representatives: COALESCE(p_on_date, CURRENT_DATE) para
--     que pasar NULL desde RPC resuelva correctamente al día actual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_entity_representatives(
  p_entity_id uuid,
  p_on_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  representative_position_id uuid,
  position_title text,
  display_order integer,
  assignment_id uuid,
  person_name text,
  effective_from date
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.title,
    p.display_order,
    a.id,
    a.person_name,
    a.effective_from
  FROM public.organization_representative_positions p
  LEFT JOIN LATERAL (
    SELECT asg.id, asg.person_name, asg.effective_from
    FROM public.organization_representative_assignments asg
    WHERE asg.representative_position_id = p.id
      AND asg.effective_from <= COALESCE(p_on_date, CURRENT_DATE)
      AND (asg.effective_to IS NULL OR asg.effective_to >= COALESCE(p_on_date, CURRENT_DATE))
    ORDER BY asg.effective_from DESC
    LIMIT 1
  ) a ON true
  WHERE p.organization_entity_id = p_entity_id
    AND p.is_active = true
  ORDER BY p.display_order, p.title
$function$;
