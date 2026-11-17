-- =============================================================================
-- MIGRACIÓN: 20261116000003_qa_round4d.sql
-- Correcciones QA:
--   1. Redefinir `resolve_vacation_assignment`, `worker_vacation_row_in_contract`,
--      `worker_position_on`, `worker_vacation_weekdays_on`
--      para considerar vigentes asignaciones con `is_current = true`, `start_date <= cuba_current_date()`
--      y `(end_date IS NULL OR end_date >= cuba_current_date())`.
--   2. Redefinir `entity_vacation_overview` con manejo de excepciones por trabajador
--      (BEGIN ... EXCEPTION WHEN OTHERS THEN status = 'ERROR' ...), evitando que un error
--      en un trabajador tumbe la consulta de toda la entidad.
--   3. Test SQL con bloque DO que verifica que `entity_vacation_overview` no falla.
-- =============================================================================

BEGIN;

-- 1. resolve_vacation_assignment
CREATE OR REPLACE FUNCTION public.resolve_vacation_assignment(
  p_worker_id uuid,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_today date := public.cuba_current_date();
  v_count integer;
  v_target uuid;
BEGIN
  IF p_assignment_id IS NOT NULL THEN
    SELECT a.id INTO v_target
    FROM public.worker_position_assignments a
    WHERE a.id = p_assignment_id
      AND a.worker_id = p_worker_id
      AND a.is_current = true
      AND a.start_date <= v_today
      AND (a.end_date IS NULL OR a.end_date >= v_today);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    END IF;
    RETURN v_target;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND a.start_date <= v_today
    AND (a.end_date IS NULL OR a.end_date >= v_today);

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_count > 1 THEN
    SELECT a.id INTO v_target
    FROM public.worker_position_assignments a
    WHERE a.worker_id = p_worker_id
      AND a.is_current = true
      AND a.start_date <= v_today
      AND (a.end_date IS NULL OR a.end_date >= v_today)
    ORDER BY a.start_date DESC LIMIT 1;
    IF v_target IS NOT NULL THEN
      RETURN v_target;
    END IF;
    RAISE EXCEPTION 'El trabajador tiene % contratos activos: identifique el contrato para operar las vacaciones', v_count;
  END IF;

  SELECT a.id INTO v_target
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND a.start_date <= v_today
    AND (a.end_date IS NULL OR a.end_date >= v_today)
  ORDER BY a.start_date DESC LIMIT 1;

  RETURN v_target;
END $$;

-- 2. worker_vacation_row_in_contract
CREATE OR REPLACE FUNCTION public.worker_vacation_row_in_contract(
  p_worker_id uuid,
  p_assignment_id uuid,
  p_row_assignment_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT p_assignment_id is null
      OR p_row_assignment_id = p_assignment_id
      OR (p_row_assignment_id is null
          AND (SELECT count(*)
               FROM public.worker_position_assignments a
               WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date is null or a.end_date >= public.cuba_current_date())) = 1
          AND p_assignment_id = (SELECT a.id
               FROM public.worker_position_assignments a
               WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date is null or a.end_date >= public.cuba_current_date())))
$$;

-- 3. worker_position_on
CREATE OR REPLACE FUNCTION public.worker_position_on(
  p_worker_id uuid,
  p_date date,
  p_assignment_id uuid default null
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT a.position_id
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND (p_assignment_id is null or a.id = p_assignment_id)
    AND a.start_date <= p_date
    and (a.end_date is null or a.end_date >= p_date)
  ORDER BY a.start_date desc, a.created_at desc
  limit 1
$$;

-- 4. worker_vacation_weekdays_on
CREATE OR REPLACE FUNCTION public.worker_vacation_weekdays_on(
  p_worker_id uuid,
  p_date date,
  p_assignment_id uuid default null
)
RETURNS integer[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE v_pos uuid; v_start date;
BEGIN
  v_pos := public.worker_position_on(p_worker_id, p_date, p_assignment_id);
  IF v_pos IS NULL THEN
    v_start := public.worker_vacation_accrual_start(p_worker_id);
    IF v_start IS NOT NULL AND p_date < v_start THEN
      SELECT position_id INTO v_pos FROM public.worker_position_assignments
      WHERE worker_id = p_worker_id AND (p_assignment_id is null or id = p_assignment_id)
      ORDER BY start_date ASC LIMIT 1;
    ELSE
      SELECT position_id INTO v_pos FROM public.worker_position_assignments
      WHERE worker_id = p_worker_id AND (p_assignment_id is null or id = p_assignment_id)
      ORDER BY end_date DESC NULLS LAST LIMIT 1;
    END IF;
  END IF;
  IF v_pos IS NULL THEN RETURN array[]::integer[]; END IF;
  RETURN public.position_working_weekdays(v_pos);
END;
$$;

-- 5. entity_vacation_overview con manejo de excepciones por trabajador
CREATE OR REPLACE FUNCTION public.entity_vacation_overview(p_entity_id uuid)
RETURNS TABLE(
  worker_id uuid,
  assignment_id uuid,
  full_name text,
  area_name text,
  job_name text,
  position_name text,
  balance numeric,
  next_accrual numeric,
  projected_balance numeric,
  status text,
  scheduled_future_days numeric,
  current_vacation_end date,
  next_vacation_start date,
  has_schedule boolean,
  active_vacation boolean,
  reconciliation_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  w record;
  a record;
  s jsonb;
  v_weekdays integer[];
  v_has_assignment boolean;
  v_reconciliation boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT (
    public.can_access_entity(p_entity_id, 'vacations.view')
    OR public.can_access_entity(p_entity_id, 'vacations.manage')
  ) THEN
    RAISE EXCEPTION 'Permission denied: vacations.view is required in this entity';
  END IF;

  FOR w IN
    SELECT wk.*
    FROM public.workers wk
    WHERE wk.organization_entity_id = p_entity_id
      AND wk.employment_status = 'active'
      AND (wk.hire_date IS NULL OR wk.hire_date <= v_today)
    ORDER BY wk.first_surname, wk.first_name
  LOOP
    BEGIN
      v_has_assignment := false;
      FOR a IN
        SELECT a2.id AS assignment_id, a2.position_id AS position_id
        FROM public.worker_position_assignments a2
        WHERE a2.worker_id = w.id
          AND a2.is_current = true
          AND a2.start_date <= v_today
          AND (a2.end_date IS NULL OR a2.end_date >= v_today)
        ORDER BY a2.start_date
      LOOP
        v_has_assignment := true;
        PERFORM public.run_worker_vacation_catchup(w.id, a.assignment_id);
        s := public.worker_vacation_summary(w.id, a.assignment_id);
        worker_id := w.id;
        assignment_id := a.assignment_id;
        full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));
        SELECT ar.name INTO area_name
        FROM public.organization_positions p
        JOIN public.organization_jobs j ON j.id = p.job_id
        JOIN public.organization_areas ar ON ar.id = j.area_id
        WHERE p.id = a.position_id;
        SELECT j.name INTO job_name
        FROM public.organization_positions p
        JOIN public.organization_jobs j ON j.id = p.job_id
        WHERE p.id = a.position_id;
        SELECT p.name INTO position_name
        FROM public.organization_positions p WHERE p.id = a.position_id;
        balance := (s->>'balance')::numeric;
        next_accrual := (s->>'next_accrual')::numeric;
        projected_balance := (s->>'projected_balance')::numeric;
        status := s->>'status';
        scheduled_future_days := (s->>'scheduled_future_days')::numeric;
        current_vacation_end := (s->>'current_vacation_end')::date;
        next_vacation_start := (s->>'next_vacation_start')::date;
        v_weekdays := public.worker_vacation_weekdays_on(w.id, v_today, a.assignment_id);
        has_schedule := v_weekdays IS NOT NULL AND coalesce(array_length(v_weekdays, 1), 0) > 0;
        active_vacation := current_vacation_end IS NOT NULL;
        v_reconciliation := coalesce((s->>'reconciliation_required')::boolean, false);
        reconciliation_required := v_reconciliation;
        RETURN NEXT;
      END LOOP;

      IF NOT v_has_assignment THEN
        PERFORM public.run_worker_vacation_catchup(w.id, NULL);
        s := public.worker_vacation_summary(w.id, NULL);
        worker_id := w.id;
        assignment_id := NULL;
        full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));
        area_name := NULL; job_name := NULL; position_name := NULL;
        balance := (s->>'balance')::numeric;
        next_accrual := (s->>'next_accrual')::numeric;
        projected_balance := (s->>'projected_balance')::numeric;
        status := s->>'status';
        scheduled_future_days := (s->>'scheduled_future_days')::numeric;
        current_vacation_end := (s->>'current_vacation_end')::date;
        next_vacation_start := (s->>'next_vacation_start')::date;
        v_weekdays := public.worker_vacation_weekdays_on(w.id, v_today, NULL);
        has_schedule := v_weekdays IS NOT NULL AND coalesce(array_length(v_weekdays, 1), 0) > 0;
        active_vacation := current_vacation_end IS NOT NULL;
        v_reconciliation := coalesce((s->>'reconciliation_required')::boolean, false);
        reconciliation_required := v_reconciliation;
        RETURN NEXT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      worker_id := w.id;
      assignment_id := NULL;
      full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));
      area_name := NULL; job_name := NULL; position_name := NULL;
      balance := 0; next_accrual := 0; projected_balance := 0;
      status := 'ERROR: ' || SQLERRM;
      scheduled_future_days := 0; current_vacation_end := NULL; next_vacation_start := NULL;
      has_schedule := false; active_vacation := false; reconciliation_required := false;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;

-- 6. Test SQL block
DO $$
DECLARE
  v_ent_id uuid;
  v_cnt integer;
BEGIN
  SELECT id INTO v_ent_id FROM public.organization_entities LIMIT 1;
  IF v_ent_id IS NOT NULL THEN
    SELECT count(*) INTO v_cnt FROM public.entity_vacation_overview(v_ent_id);
    RAISE NOTICE 'QA-Round4d Test: entity_vacation_overview returned % rows', v_cnt;
  END IF;
END $$;

COMMIT;
