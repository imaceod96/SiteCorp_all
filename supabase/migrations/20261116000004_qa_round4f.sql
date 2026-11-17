-- =============================================================================
-- MIGRACIÓN: 20261116000004_qa_round4f.sql
-- Ronda 4f de QA:
--   1. Vacaciones y pluriempleo:
--      a) `resolve_vacation_assignment`: mantiene excepción en pluriempleo
--         (`v_count > 1` sin `p_assignment_id` lanza
--         'El trabajador tiene % contratos activos: identifique el contrato para operar las vacaciones').
--      b) Test SQL en bloque DO independiente de `auth.uid()` que comprueba que
--         `resolve_vacation_assignment` devuelve la asignación activa con `end_date` futura
--         y hace `RAISE EXCEPTION` si devuelve `NULL`.
--      c/d) Redefinir todas las funciones vigentes en la base que filtraban asignaciones activas con
--         `is_current = true AND end_date IS NULL` para que usen:
--         `is_current = true AND start_date <= public.cuba_current_date() AND (end_date IS NULL OR end_date >= public.cuba_current_date())`
--   2. Cola documental y autoría (`requested_by` / `p_actor_user_id`)
--   3. Funciones documentales en el repositorio desde `pg_get_functiondef` + soporte `service_role` + `REVOKE EXECUTE FROM anon`
-- =============================================================================

BEGIN;

-- =============================================================================
-- PARTE 1. VACACIONES, PLURIEMPLEO Y ASIGNACIONES VIGENTES CON END_DATE FUTURA
-- =============================================================================

-- 1.1 public.resolve_vacation_assignment
CREATE OR REPLACE FUNCTION public.resolve_vacation_assignment(p_worker_id uuid, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_count integer;
  v_target uuid;
begin
  if p_assignment_id is not null then
    select a.id into v_target
    from public.worker_position_assignments a
    where a.id = p_assignment_id and a.worker_id = p_worker_id
      AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date());
    if v_target is null then
      raise exception 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    end if;
    return v_target;
  end if;

  select count(*) into v_count
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date());

  if v_count = 0 then return null; end if;
  if v_count > 1 then
    raise exception 'El trabajador tiene % contratos activos: identifique el contrato para operar las vacaciones', v_count;
  end if;

  select a.id into v_target
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date());
  return v_target;
end $function$
;

-- 1.2 public.worker_vacation_row_in_contract
CREATE OR REPLACE FUNCTION public.worker_vacation_row_in_contract(p_worker_id uuid, p_assignment_id uuid, p_row_assignment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select p_assignment_id is null
      or p_row_assignment_id = p_assignment_id
      or (p_row_assignment_id is null
          and (select count(*)
               from public.worker_position_assignments a
               where a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())) = 1
          and p_assignment_id = (select a.id
               from public.worker_position_assignments a
               where a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())))
$function$
;

-- 1.3 public.resolve_worker_target_assignment
CREATE OR REPLACE FUNCTION public.resolve_worker_target_assignment(p_worker_id uuid, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    -- Fallback por si el trabajador tiene incorporación futura (`start_date > v_today`)
    SELECT count(*) INTO v_count
    FROM public.worker_position_assignments a
    WHERE a.worker_id = p_worker_id
      AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date());
  END IF;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'El trabajador no tiene un puesto actual asignado';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'El trabajador tiene % contratos activos: identifique la asignación a modificar', v_count;
  END IF;

  SELECT a.id INTO v_target
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND (a.end_date IS NULL OR a.end_date >= v_today)
  ORDER BY
    CASE WHEN a.start_date <= v_today THEN 0 ELSE 1 END ASC,
    a.start_date DESC
  LIMIT 1;

  RETURN v_target;
END;
$function$
;

-- 1.4 public.run_worker_vacation_catchup
CREATE OR REPLACE FUNCTION public.run_worker_vacation_catchup(p_worker_id uuid, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_today date := public.cuba_current_date();
  v_start date;
  v_end date;
  v_last_closed date;
  v_cursor date;
  v_posted int := 0;
  v_result jsonb;
  v_assignments uuid[];
  v_assignment uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker was not found'; END IF;
  IF NOT (public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage')
          OR public.can_access_entity(v_worker.organization_entity_id, 'vacations.view')) THEN
    RAISE EXCEPTION 'Permission denied: vacations access is required in this entity';
  END IF;

  IF v_worker.hire_date IS NOT NULL AND v_worker.hire_date > v_today THEN
    RETURN jsonb_build_object('posted', 0, 'is_pending_hire', true);
  END IF;

  v_start := public.worker_vacation_accrual_start(p_worker_id);
  IF v_start IS NULL THEN RETURN jsonb_build_object('posted', 0); END IF;

  v_last_closed := (date_trunc('month', v_today) - interval '1 day')::date;

  IF p_assignment_id IS NULL THEN
    v_assignments := array(
      SELECT a.id FROM public.worker_position_assignments a
      WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date()));
    IF coalesce(array_length(v_assignments, 1), 0) = 0 THEN v_assignments := array[null]::uuid[]; END IF;
  ELSE
    v_assignments := array[public.resolve_vacation_assignment(p_worker_id, p_assignment_id)];
  END IF;

  FOREACH v_assignment IN ARRAY v_assignments LOOP
    v_end := public.worker_vacation_accrual_end(p_worker_id, v_assignment);
    v_last_closed := (date_trunc('month', v_today) - interval '1 day')::date;
    IF v_end IS NOT NULL AND v_end < v_last_closed THEN v_last_closed := v_end; END IF;

    v_cursor := date_trunc('month', v_start)::date;
    WHILE v_cursor <= v_last_closed LOOP
      v_result := public.vacation_post_accrual_internal(
        p_worker_id,
        extract(year FROM v_cursor)::int,
        extract(month FROM v_cursor)::int,
        v_assignment
      );
      IF v_result->>'status' = 'posted' THEN v_posted := v_posted + 1; END IF;
      v_cursor := (v_cursor + interval '1 month')::date;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('posted', v_posted);
END;
$function$
;

-- 1.5 public.worker_vacation_summary
CREATE OR REPLACE FUNCTION public.worker_vacation_summary(p_worker_id uuid, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_today date := public.cuba_current_date();
  v_is_pending_hire boolean := false;
  v_balance numeric(10,4);
  v_accrued_this numeric(10,4);
  v_consumed_this numeric(10,4);
  v_next numeric(10,4);
  v_calc jsonb;
  v_projected numeric(10,4);
  v_status text;
  v_current public.worker_vacations%ROWTYPE;
  v_next_vac public.worker_vacations%ROWTYPE;
  v_scheduled numeric(10,4);
  v_year int := extract(year FROM v_today)::int;
  v_weekdays integer[];
  v_cutoff date;
  v_assignment uuid;
  v_current_assignments integer;
  v_unassigned_movements integer;
  v_unassigned_days numeric(10,4);
  v_reconciliation boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker was not found'; END IF;
  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'vacations.view') THEN
    RAISE EXCEPTION 'Permission denied: vacations.view is required in this entity';
  END IF;

  v_is_pending_hire := (v_worker.hire_date IS NOT NULL AND v_worker.hire_date > v_today);
  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);

  SELECT coalesce(sum(amount), 0) INTO v_accrued_this
  FROM public.worker_vacation_movements m
  WHERE m.worker_id = p_worker_id AND m.movement_type = 'ACCRUAL' AND m.accrual_year = v_year
    AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  SELECT coalesce(-sum(amount), 0) INTO v_consumed_this
  FROM public.worker_vacation_movements m
  WHERE m.worker_id = p_worker_id AND m.movement_type IN ('VACATION_USAGE','REVERSAL')
    AND extract(year FROM m.effective_date)::int = v_year
    AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  IF v_is_pending_hire THEN
    v_calc := jsonb_build_object('calculated', 0, 'working_days_month', 0);
    v_next := 0;
    v_projected := least(24, v_balance);
  ELSE
    v_calc := public.calculate_worker_vacation_accrual(p_worker_id, v_year, extract(month FROM v_today)::int, v_assignment);
    v_next := (v_calc->>'calculated')::numeric;
    v_projected := least(24, v_balance + v_next);
  END IF;

  v_status := CASE
    WHEN v_balance >= 24 THEN 'LIMIT_REACHED'
    WHEN v_balance + v_next > 24 THEN 'NEAR_LIMIT'
    ELSE 'NORMAL'
  END;

  SELECT * INTO v_current FROM public.worker_vacations v
    WHERE v.worker_id = p_worker_id AND v.status <> 'CANCELLED'
      AND v.start_date <= v_today AND v.end_date >= v_today
      AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id)
    ORDER BY v.start_date DESC LIMIT 1;

  SELECT * INTO v_next_vac FROM public.worker_vacations v
    WHERE v.worker_id = p_worker_id AND v.status <> 'CANCELLED' AND v.start_date > v_today
      AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id)
    ORDER BY v.start_date ASC LIMIT 1;

  SELECT coalesce(sum(v.charged_days), 0) INTO v_scheduled FROM public.worker_vacations v
    WHERE v.worker_id = p_worker_id AND v.status <> 'CANCELLED' AND v.start_date > v_today
      AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id);

  v_weekdays := public.worker_vacation_weekdays_on(p_worker_id, v_today, v_assignment);
  SELECT max(m.effective_date) INTO v_cutoff FROM public.worker_vacation_movements m
    WHERE m.worker_id = p_worker_id AND m.movement_type = 'INITIAL_BALANCE'
      AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  SELECT count(*) INTO v_current_assignments
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date());

  SELECT count(*), coalesce(sum(m.amount), 0)
  INTO v_unassigned_movements, v_unassigned_days
  FROM public.worker_vacation_movements m
  WHERE m.worker_id = p_worker_id AND m.assignment_id IS NULL;

  v_reconciliation := v_current_assignments > 1 AND v_unassigned_movements > 0;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'assignment_id', v_assignment,
    'is_pending_hire', v_is_pending_hire,
    'hire_date', v_worker.hire_date,
    'reconciliation_required', v_reconciliation,
    'unassigned_movements', v_unassigned_movements,
    'unassigned_days', round(v_unassigned_days, 4),
    'balance', v_balance,
    'accrued_this_year', v_accrued_this,
    'consumed_this_year', v_consumed_this,
    'next_accrual', v_next,
    'next_accrual_working_days', nullif(v_calc->>'working_days_month','')::int,
    'projected_balance', v_projected,
    'unaccredited_projection', greatest(0, round(v_balance + v_next - 24, 4)),
    'status', v_status,
    'scheduled_future_days', v_scheduled,
    'free_balance', v_balance,
    'current_vacation_end', v_current.end_date,
    'current_vacation_return', CASE WHEN v_current.id IS NOT NULL THEN v_current.end_date + 1 ELSE NULL END,
    'next_vacation_start', v_next_vac.start_date,
    'next_vacation_end', v_next_vac.end_date,
    'opening_cutoff', v_cutoff,
    'has_schedule', v_weekdays IS NOT NULL AND coalesce(array_length(v_weekdays,1),0) > 0
  );
END;
$function$
;

-- 1.6 public.register_worker_separation
CREATE OR REPLACE FUNCTION public.register_worker_separation(p_worker_id uuid, p_effective_date date, p_separation_reason_id uuid, p_notes text DEFAULT NULL::text, p_target_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_reason public.worker_separation_reasons%rowtype;
  v_remaining integer;
  v_clean_notes text;
  v_old_job_id uuid;
  v_today date := public.cuba_current_date();
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if p_effective_date is null then
    raise exception 'La fecha efectiva de baja es obligatoria';
  end if;
  if p_separation_reason_id is null then
    raise exception 'El motivo de baja es obligatorio';
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    raise exception 'Trabajador no encontrado';
  end if;

  if not public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para gestionar trabajadores de esta entidad';
  end if;
  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  select * into v_reason from public.worker_separation_reasons
  where id = p_separation_reason_id and is_active = true;
  if not found then
    raise exception 'El motivo de baja seleccionado no es válido';
  end if;

  select * into v_current from public.worker_position_assignments
  where id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  for update;

  if p_effective_date < v_current.start_date then
    raise exception 'La fecha de baja no puede ser anterior al inicio del puesto actual';
  end if;

  v_clean_notes := nullif(btrim(coalesce(p_notes, '')), '');

  -- Si la fecha efectiva es FUTURA respecto a la fecha actual en Cuba, programar la baja
  if p_effective_date > v_today then
    if v_current.scheduled_separation_date is not null then
      raise exception 'El trabajador ya tiene una baja programada para el %',
        to_char(v_current.scheduled_separation_date, 'DD/MM/YYYY');
    end if;

    update public.worker_position_assignments
    set scheduled_separation_date = p_effective_date,
        scheduled_separation_reason_id = v_reason.id,
        scheduled_separation_notes = v_clean_notes,
        updated_at = now()
    where id = v_current.id;

    return jsonb_build_object(
      'assignment_id', v_current.id,
      'effective_date', p_effective_date,
      'separation_reason_id', v_reason.id,
      'scheduled', true,
      'remaining_active_assignments', 1
    );
  end if;

  select op.job_id into v_old_job_id
  from public.organization_positions op
  where op.id = v_current.position_id;

  -- Fecha efectiva <= public.cuba_current_date(): aplicar baja inmediata
  update public.worker_position_assignments
  set end_date = p_effective_date,
      is_current = false,
      scheduled_separation_date = null,
      scheduled_separation_reason_id = null,
      scheduled_separation_notes = null,
      updated_at = now()
  where id = v_current.id;

  update public.employment_contracts
  set is_current = false,
      actual_end_date = p_effective_date,
      updated_at = now()
  where assignment_id = v_current.id and is_current = true;

  select count(*) into v_remaining
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id
    AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    and a.id <> v_current.id;

  if v_remaining = 0 then
    update public.workers
    set employment_status = 'inactive', updated_at = now()
    where id = p_worker_id;

    update public.sst_onboarding_notifications
    set status = 'DESCARTADA'
    where worker_id = p_worker_id
      and status in ('PENDIENTE', 'EN_PROCESO');

    update public.training_initial_notifications
    set status = 'DESCARTADA'
    where worker_id = p_worker_id
      and status = 'PENDIENTE';
  elsif v_old_job_id is not null then
    update public.sst_onboarding_notifications
    set status = 'DESCARTADA'
    where worker_id = p_worker_id
      and job_id = v_old_job_id
      and status in ('PENDIENTE', 'EN_PROCESO');
  end if;

  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, separation_reason_id, created_by
  ) values (
    p_worker_id, 'BAJA', v_current.id, null,
    p_effective_date, v_reason.name,
    v_clean_notes, v_reason.id, auth.uid()
  );

  perform public.create_payroll_movement(
    p_worker_id, 'BAJA', p_effective_date,
    v_current.position_id, null, v_current.id, v_current.id
  );

  return jsonb_build_object(
    'assignment_id', v_current.id,
    'effective_date', p_effective_date,
    'separation_reason_id', v_reason.id,
    'scheduled', false,
    'remaining_active_assignments', v_remaining
  );
end;
$function$
;

-- 1.7 public.salary_change_impact
CREATE OR REPLACE FUNCTION public.salary_change_impact(p_salary_group_id uuid, p_new_amount numeric, p_effective_date date DEFAULT cuba_current_date())
 RETURNS TABLE(worker_id uuid, worker_code text, worker_name text, identification text, area_name text, job_name text, position_name text, group_sequence_number integer, previous_amount numeric, currency_code text, contract_id uuid, contract_start_date date, contract_type_name text, assignment_id uuid, position_id uuid, job_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  WITH ctx AS (
    SELECT COALESCE(p_effective_date, public.cuba_current_date()) AS ref_date
  ),
  base AS (
    SELECT
      w.id AS wid,
      w.code AS wcode,
      btrim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)) AS wname,
      w.identification AS wci,
      ar.name AS aname,
      j.name AS jname,
      p.name AS pname,
      g.sequence_number AS gseq,
      COALESCE(prev.amount, public.worker_last_recorded_salary(w.id, ctx.ref_date)) AS prev_amount,
      COALESCE(prev.currency_code, s.currency_code, 'CUP') AS cur_code,
      c.id AS cid,
      c.start_date AS cstart,
      ct.name AS ctname,
      a.id AS aid,
      p.id AS pid,
      j.id AS jid
    FROM public.workers w
    CROSS JOIN ctx
    JOIN public.worker_position_assignments a
      ON a.worker_id = w.id AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    JOIN public.organization_positions p ON p.id = a.position_id
    JOIN public.organization_jobs j ON j.id = p.job_id
    JOIN public.salary_groups g ON g.id = j.salary_group_id
    JOIN public.salary_scales s ON s.id = g.salary_scale_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.employment_contracts c
      ON c.worker_id = w.id AND c.assignment_id = a.id AND c.is_current = true
    LEFT JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
    LEFT JOIN LATERAL public.resolve_salary_group_value(g.id, ctx.ref_date - 1) prev ON true
    WHERE w.employment_status = 'active'
      AND g.id = p_salary_group_id
      AND COALESCE(c.start_date, a.start_date) <= ctx.ref_date
      AND public.resolve_salary_scale_for_entity(w.organization_entity_id) = g.salary_scale_id
      AND public.can_manage_salary_scale(g.salary_scale_id)
  )
  SELECT wid, wcode, wname, wci, aname, jname, pname, gseq, prev_amount, cur_code,
         cid, cstart, ctname, aid, pid, jid
  FROM base
  WHERE prev_amount IS NOT NULL
    AND prev_amount <> p_new_amount
  ORDER BY wname;
$function$
;

-- 1.8 public.create_worker_with_position
CREATE OR REPLACE FUNCTION public.create_worker_with_position(p_entity_id uuid, p_worker jsonb, p_position_id uuid, p_hire_date date DEFAULT cuba_current_date(), p_contract_type_id uuid DEFAULT NULL::uuid, p_contract_start_date date DEFAULT NULL::date, p_contract_end_date date DEFAULT NULL::date, p_representative_assignment_id uuid DEFAULT NULL::uuid, p_driving_license_category_ids text[] DEFAULT NULL::text[], p_signature_date date DEFAULT NULL::date, p_signature_place text DEFAULT NULL::text, p_payment_method_id uuid DEFAULT NULL::uuid, p_compensation_components jsonb DEFAULT NULL::jsonb, p_payment_schedule_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_position public.organization_positions%ROWTYPE;
  v_worker_id uuid;
  v_assignment_id uuid;
  v_contract_id uuid;
  v_contract_type public.employment_contract_types%ROWTYPE;
  v_code text;
  v_i int;
  v_occupied int;
  v_hire_date date := COALESCE(p_hire_date, public.cuba_current_date());
  v_contract_start date;
  v_licenses integer := 0;
  v_conditions jsonb;
  v_poscard jsonb;
  v_person_missing jsonb := '[]'::jsonb;
  v_all_missing jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  SELECT company_client_id INTO v_tenant_id FROM public.organization_entities
  WHERE id = p_entity_id AND is_active = true;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'La entidad no existe o no está activa';
  END IF;

  IF coalesce(btrim(p_worker->>'first_name'), '') = ''
     OR coalesce(btrim(p_worker->>'first_surname'), '') = ''
     OR coalesce(btrim(p_worker->>'identification'), '') = '' THEN
    RAISE EXCEPTION 'Nombre, primer apellido y carné de identidad son obligatorios';
  END IF;

  IF nullif(btrim(coalesce(p_worker->>'birth_date', '')), '') IS NULL THEN
    v_person_missing := v_person_missing || jsonb_build_object('code','worker.birth_date','label','Fecha de nacimiento','source','worker','sourceId',NULL,'section','Trabajador');
  END IF;
  IF nullif(btrim(coalesce(p_worker->>'profession_or_trade', '')), '') IS NULL THEN
    v_person_missing := v_person_missing || jsonb_build_object('code','worker.profession','label','Profesión u oficio','source','worker','sourceId',NULL,'section','Trabajador');
  END IF;
  IF nullif(btrim(coalesce(p_worker->>'address', '')), '') IS NULL THEN
    v_person_missing := v_person_missing || jsonb_build_object('code','worker.address','label','Dirección particular','source','worker','sourceId',NULL,'section','Trabajador');
  END IF;
  IF nullif(btrim(coalesce(p_worker->>'province', '')), '') IS NULL THEN
    v_person_missing := v_person_missing || jsonb_build_object('code','worker.province','label','Provincia','source','worker','sourceId',NULL,'section','Trabajador');
  END IF;
  IF nullif(btrim(coalesce(p_worker->>'municipality', '')), '') IS NULL THEN
    v_person_missing := v_person_missing || jsonb_build_object('code','worker.municipality','label','Municipio','source','worker','sourceId',NULL,'section','Trabajador');
  END IF;

  IF v_hire_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de incorporación es obligatoria';
  END IF;

  SELECT * INTO v_position FROM public.organization_positions
  WHERE id = p_position_id AND organization_entity_id = p_entity_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El puesto seleccionado no es válido o no está activo en esta entidad';
  END IF;

  v_poscard := public.validate_position_contract_readiness(p_position_id);
  v_all_missing := COALESCE(v_poscard->'missing', '[]'::jsonb) || v_person_missing;
  IF jsonb_array_length(v_all_missing) > 0 THEN
    RAISE EXCEPTION '%', public.format_contract_readiness_message(
      v_all_missing, 'No se puede crear el trabajador: faltan datos contractuales obligatorios.');
  END IF;

  SELECT COUNT(*) INTO v_occupied FROM public.worker_position_assignments a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.position_id = p_position_id
    AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    AND w.employment_status = 'active'
    AND w.company_client_id = v_tenant_id;

  IF v_occupied >= v_position.authorized_quantity THEN
    RAISE EXCEPTION 'No quedan vacantes disponibles para este puesto (capacidad alcanzada: %)', v_position.authorized_quantity;
  END IF;

  IF p_contract_type_id IS NOT NULL THEN
    SELECT * INTO v_contract_type FROM public.employment_contract_types
    WHERE id = p_contract_type_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
    END IF;
    v_contract_start := coalesce(p_contract_start_date, v_hire_date, public.cuba_current_date());
    IF v_contract_start IS NULL THEN
      RAISE EXCEPTION 'La fecha de inicio del contrato es obligatoria';
    END IF;
    IF v_contract_type.code = 'DETERMINADO' AND p_contract_end_date IS NULL THEN
      RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
    END IF;
    IF p_contract_end_date IS NOT NULL AND p_contract_end_date <= v_contract_start THEN
      RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.company_client_id = v_tenant_id
      AND w.identification = btrim(p_worker->>'identification')
      AND w.employment_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Ya existe un trabajador activo con ese carné de identidad en este workspace';
  END IF;

  v_worker_id := NULL;
  FOR v_i IN 1..5 LOOP
    v_code := 'TRB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    BEGIN
      INSERT INTO public.workers (
        company_client_id, organization_entity_id, code,
        first_name, first_surname, second_surname, identification, birth_date,
        gender_id, marital_status_id, education_level_id, specialty, skin_color_id,
        has_masters_degree, has_doctorate_degree,
        profession_or_trade,
        address, province, municipality, phone, email,
        hire_date, employment_status
      ) VALUES (
        v_tenant_id, p_entity_id, v_code,
        btrim(p_worker->>'first_name'), btrim(p_worker->>'first_surname'),
        nullif(btrim(p_worker->>'second_surname'), ''),
        btrim(p_worker->>'identification'),
        nullif(p_worker->>'birth_date', '')::date,
        nullif(p_worker->>'gender_id', ''),
        nullif(p_worker->>'marital_status_id', ''),
        nullif(p_worker->>'education_level_id', ''),
        nullif(btrim(p_worker->>'specialty'), ''),
        nullif(p_worker->>'skin_color_id', ''),
        coalesce((p_worker->>'has_masters_degree')::boolean, false),
        coalesce((p_worker->>'has_doctorate_degree')::boolean, false),
        nullif(btrim(p_worker->>'profession_or_trade'), ''),
        nullif(btrim(p_worker->>'address'), ''),
        nullif(btrim(p_worker->>'province'), ''),
        nullif(btrim(p_worker->>'municipality'), ''),
        nullif(btrim(p_worker->>'phone'), ''),
        nullif(btrim(p_worker->>'email'), ''),
        v_hire_date, 'active'
      ) RETURNING id INTO v_worker_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF SQLERRM LIKE '%workers_tenant_ci_active_unique%' THEN
        RAISE EXCEPTION 'Ya existe un trabajador activo con ese carné de identidad en este workspace';
      ELSIF SQLERRM LIKE '%workers_tenant_code_unique%' THEN
        v_worker_id := NULL;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo generar un código único de trabajador. Inténtalo de nuevo.';
  END IF;

  IF p_driving_license_category_ids IS NOT NULL THEN
    INSERT INTO public.worker_driving_license_categories (worker_id, driving_license_category_id)
    SELECT v_worker_id, c.id
    FROM (
      SELECT DISTINCT category_id
      FROM unnest(p_driving_license_category_ids) AS category_id
      WHERE category_id IS NOT NULL AND btrim(category_id) <> ''
    ) sel
    JOIN public.driving_license_categories c ON c.id = sel.category_id
    ON CONFLICT (worker_id, driving_license_category_id) DO NOTHING;
    GET DIAGNOSTICS v_licenses = ROW_COUNT;
  END IF;

  BEGIN
    INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
    VALUES (v_worker_id, p_position_id, v_hire_date, NULL, true)
    RETURNING id INTO v_assignment_id;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%wpa_current_per_worker_unique%' THEN
      RAISE EXCEPTION 'El trabajador ya tiene un puesto actual asignado';
    ELSE
      RAISE;
    END IF;
  END;

  IF p_contract_type_id IS NOT NULL THEN
    INSERT INTO public.employment_contracts (
      company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
      start_date, end_date, is_current
    ) VALUES (
      v_tenant_id, p_entity_id, v_worker_id, v_assignment_id, p_contract_type_id,
      v_contract_start, p_contract_end_date, true
    ) RETURNING id INTO v_contract_id;
  END IF;

  IF v_contract_id IS NOT NULL THEN
    PERFORM public.capture_contract_salary_snapshot(v_contract_id, 'INITIAL_CONTRACT', v_contract_start, NULL);
    PERFORM public.capture_contract_party_snapshot(
      v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, v_contract_start, public.cuba_current_date())
    );
    v_conditions := public.apply_contract_conditions(
      v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
      p_compensation_components, p_representative_assignment_id,
      nullif(btrim(coalesce(p_payment_schedule_text, '')), '')
    );
  END IF;

  INSERT INTO public.worker_employment_movements (
    worker_id,
    movement_type,
    previous_assignment_id,
    new_assignment_id,
    previous_contract_id,
    new_contract_id,
    effective_date,
    reason,
    notes,
    created_by
  ) VALUES (
    v_worker_id,
    'ALTA',
    NULL,
    v_assignment_id,
    NULL,
    v_contract_id,
    v_hire_date,
    COALESCE(v_contract_type.name, v_position.name, 'Incorporación inicial'),
    NULL,
    auth.uid()
  );

  RETURN jsonb_build_object(
    'worker_id', v_worker_id,
    'code', v_code,
    'assignment_id', v_assignment_id,
    'contract_id', v_contract_id,
    'driving_licenses', v_licenses,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$
;

-- 1.9 public.create_worker_pluriemploy
CREATE OR REPLACE FUNCTION public.create_worker_pluriemploy(p_worker_id uuid, p_position_id uuid, p_hire_date date, p_contract_type_id uuid, p_contract_start_date date DEFAULT NULL::date, p_contract_end_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_representative_assignment_id uuid DEFAULT NULL::uuid, p_signature_date date DEFAULT NULL::date, p_signature_place text DEFAULT NULL::text, p_payment_method_id uuid DEFAULT NULL::uuid, p_compensation_components jsonb DEFAULT NULL::jsonb, p_payment_schedule_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_worker public.workers%rowtype;
  v_position public.organization_positions%rowtype;
  v_job public.organization_jobs%rowtype;
  v_contract_type public.employment_contract_types%rowtype;
  v_active_contracts integer;
  v_occupied integer;
  v_contract_start date;
  v_new_assignment_id uuid;
  v_contract_id uuid;
  v_conditions jsonb;
  v_movement_id uuid;
  v_readiness jsonb;
  v_msg text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_position_id is null then
    raise exception 'El segundo puesto es obligatorio';
  end if;

  if p_hire_date is null then
    raise exception 'La fecha de incorporación al segundo puesto es obligatoria';
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    raise exception 'Trabajador no encontrado';
  end if;

  if not public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para gestionar trabajadores de esta entidad';
  end if;

  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  select count(*) into v_active_contracts
  from public.employment_contracts
  where worker_id = p_worker_id and is_current = true;

  if v_active_contracts = 0 then
    raise exception 'El trabajador no tiene un contrato activo: use la contratación normal';
  end if;

  if v_active_contracts >= 2 then
    raise exception 'El trabajador ya tiene 2 contratos activos: no se puede crear un tercero';
  end if;

  select * into v_position from public.organization_positions where id = p_position_id for update;
  if not found then
    raise exception 'El puesto seleccionado no existe';
  end if;

  if v_position.organization_entity_id <> v_worker.organization_entity_id then
    raise exception 'El puesto seleccionado no pertenece a la entidad del trabajador';
  end if;

  if not v_position.is_active then
    raise exception 'El puesto seleccionado no está activo';
  end if;

  if exists (
    select 1 from public.worker_position_assignments a
    where a.worker_id = p_worker_id
      and a.position_id = p_position_id
      AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
  ) then
    raise exception 'El trabajador ya ocupa el puesto seleccionado';
  end if;

  select * into v_job from public.organization_jobs where id = v_position.job_id;

  if coalesce(v_job.is_principal_specialist, false) then
    raise exception 'El segundo puesto pertenece a un Cargo Especialista Principal (Resolución); Pluriempleo sólo admite puestos con contrato laboral';
  end if;

  select count(*) into v_occupied
  from public.worker_position_assignments a
  join public.workers w on w.id = a.worker_id
  where a.position_id = p_position_id
    AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    and w.employment_status = 'active';

  if v_occupied >= v_position.authorized_quantity then
    raise exception 'El puesto seleccionado ya no tiene vacantes disponibles';
  end if;

  if p_contract_type_id is null then
    raise exception 'El tipo de contrato es obligatorio';
  end if;

  select * into v_contract_type from public.employment_contract_types
  where id = p_contract_type_id and is_active = true;
  if not found then
    raise exception 'El tipo de contrato seleccionado no es válido';
  end if;

  v_contract_start := coalesce(p_contract_start_date, p_hire_date);

  if v_contract_type.code = 'DETERMINADO' and p_contract_end_date is null then
    raise exception 'El contrato por tiempo determinado requiere una fecha de fin';
  end if;

  if p_contract_end_date is not null and p_contract_end_date <= v_contract_start then
    raise exception 'La fecha de fin del contrato debe ser posterior a su inicio';
  end if;

  v_readiness := public.validate_hiring_readiness(
    null, p_worker_id, p_position_id, p_signature_date, p_contract_type_id,
    p_signature_place, p_payment_method_id, p_representative_assignment_id,
    v_contract_start, p_contract_end_date
  );
  if not (v_readiness->>'ready')::boolean then
    v_msg := public.format_contract_readiness_message(v_readiness->'missing');
    raise exception '%', coalesce(
      v_msg, 'No se puede realizar la contratación por Pluriempleo: faltan datos obligatorios.'
    );
  end if;

  insert into public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
  values (p_worker_id, p_position_id, p_hire_date, null, true)
  returning id into v_new_assignment_id;

  insert into public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, is_current
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_new_assignment_id,
    p_contract_type_id, v_contract_start, p_contract_end_date, true
  ) returning id into v_contract_id;

  perform public.capture_contract_salary_snapshot(
    v_contract_id, 'INITIAL_CONTRACT', v_contract_start, null
  );
  perform public.capture_contract_party_snapshot(
    v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, v_contract_start)
  );

  v_conditions := public.apply_contract_conditions(
    v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    nullif(btrim(coalesce(p_payment_schedule_text, '')), '')
  );

  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    previous_contract_id, new_contract_id, effective_date, reason, notes, created_by
  ) values (
    p_worker_id, 'PLURIEMPLEO', null, v_new_assignment_id,
    null, v_contract_id, p_hire_date,
    coalesce(nullif(btrim(coalesce(v_job.name, '')), ''), 'Pluriempleo'),
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  v_movement_id := public.create_payroll_movement(
    p_worker_id    => p_worker_id,
    p_event_type   => 'ALTA',
    p_effective_date => p_hire_date,
    p_old_position_id => p_position_id,
    p_new_position_id => null,
    p_assignment_id  => v_new_assignment_id,
    p_event_id       => v_new_assignment_id
  );

  return jsonb_build_object(
    'worker_id', p_worker_id,
    'assignment_id', v_new_assignment_id,
    'contract_id', v_contract_id,
    'movement_id', v_movement_id,
    'effective_date', p_hire_date,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
end $function$
;

-- 1.10 public.reincorporate_worker
CREATE OR REPLACE FUNCTION public.reincorporate_worker(p_worker_id uuid, p_new_position_id uuid, p_reincorporation_date date, p_contract_type_id uuid, p_contract_start_date date DEFAULT NULL::date, p_contract_end_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_representative_assignment_id uuid DEFAULT NULL::uuid, p_signature_date date DEFAULT NULL::date, p_signature_place text DEFAULT NULL::text, p_payment_method_id uuid DEFAULT NULL::uuid, p_compensation_components jsonb DEFAULT NULL::jsonb, p_payment_schedule_text text DEFAULT NULL::text, p_resolution_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_position public.organization_positions%ROWTYPE;
  v_job public.organization_jobs%ROWTYPE;
  v_is_principal boolean := false;
  v_resolution_id uuid := NULL;
  v_res jsonb;
  v_contract_type public.employment_contract_types%ROWTYPE;
  v_occupied integer;
  v_new_assignment_id uuid;
  v_contract_id uuid;
  v_contract_start date;
  v_last_end date;
  v_conditions jsonb;
  v_readiness jsonb;
  v_msg text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_reincorporation_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de reincorporación es obligatoria';
  END IF;
  IF p_new_position_id IS NULL THEN
    RAISE EXCEPTION 'El puesto es obligatorio';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;
  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;
  IF v_worker.employment_status = 'active' THEN
    RAISE EXCEPTION 'El trabajador ya está activo';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.worker_position_assignments
    WHERE worker_id = p_worker_id AND is_current = true AND start_date <= public.cuba_current_date() AND (end_date IS NULL OR end_date >= public.cuba_current_date())
  ) THEN
    RAISE EXCEPTION 'El trabajador ya tiene un puesto actual asignado';
  END IF;

  SELECT * INTO v_position FROM public.organization_positions WHERE id = p_new_position_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El puesto seleccionado no existe';
  END IF;
  IF v_position.organization_entity_id <> v_worker.organization_entity_id THEN
    RAISE EXCEPTION 'El puesto seleccionado no pertenece a la entidad del trabajador';
  END IF;
  IF NOT v_position.is_active THEN
    RAISE EXCEPTION 'El puesto seleccionado no está activo';
  END IF;

  SELECT * INTO v_job FROM public.organization_jobs WHERE id = v_position.job_id;
  v_is_principal := coalesce(v_job.is_principal_specialist, false);

  SELECT max(end_date) INTO v_last_end
  FROM public.worker_position_assignments
  WHERE worker_id = p_worker_id;
  IF v_last_end IS NOT NULL AND p_reincorporation_date <= v_last_end THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior al fin del período laboral anterior (%)',
      to_char(v_last_end, 'DD/MM/YYYY');
  END IF;

  SELECT COUNT(*) INTO v_occupied
  FROM public.worker_position_assignments a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.position_id = p_new_position_id
    AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    AND w.employment_status = 'active';
  IF v_occupied >= v_position.authorized_quantity THEN
    RAISE EXCEPTION 'El puesto seleccionado ya no tiene vacantes disponibles';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.company_client_id = v_worker.company_client_id
      AND w.identification = v_worker.identification
      AND w.employment_status = 'active'
      AND w.id <> p_worker_id
  ) THEN
    RAISE EXCEPTION 'Ya existe otro trabajador activo con ese carné de identidad en este workspace';
  END IF;

  IF v_is_principal THEN
    v_readiness := public.validate_resolution_readiness(
      NULL, p_worker_id, p_new_position_id,
      coalesce(p_resolution_date, p_reincorporation_date),
      p_representative_assignment_id
    );
    IF NOT (v_readiness->>'ready')::boolean THEN
      v_msg := public.format_contract_readiness_message(v_readiness->'missing', 'No se puede completar la Resolución.');
      RAISE EXCEPTION '%', COALESCE(v_msg, 'No se puede completar la Resolución: faltan datos obligatorios.');
    END IF;

    UPDATE public.workers
    SET employment_status = 'active', updated_at = now()
    WHERE id = p_worker_id;

    UPDATE public.employment_contracts
    SET is_current = false, updated_at = now()
    WHERE worker_id = p_worker_id AND is_current = true;

    INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
    VALUES (p_worker_id, p_new_position_id, p_reincorporation_date, NULL, true)
    RETURNING id INTO v_new_assignment_id;

    INSERT INTO public.worker_employment_movements (
      worker_id, movement_type, previous_assignment_id, new_assignment_id,
      effective_date, reason, notes, created_by
    ) VALUES (
      p_worker_id, 'REINCORPORACION', NULL, v_new_assignment_id,
      p_reincorporation_date, v_job.name, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
    );

    v_res := public.create_worker_resolution(
      p_worker_id, v_new_assignment_id, p_new_position_id,
      coalesce(p_resolution_date, p_reincorporation_date),
      p_representative_assignment_id, NULL, 'MOVEMENT'
    );
    v_resolution_id := (v_res->>'resolution_id')::uuid;

    RETURN jsonb_build_object(
      'assignment_id', v_new_assignment_id,
      'contract_id', NULL,
      'effective_date', p_reincorporation_date,
      'is_principal_specialist', true,
      'resolution_id', v_resolution_id
    );
  END IF;

  IF p_contract_type_id IS NULL THEN
    RAISE EXCEPTION 'El tipo de contrato es obligatorio';
  END IF;
  SELECT * INTO v_contract_type FROM public.employment_contract_types
  WHERE id = p_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  v_contract_start := coalesce(p_contract_start_date, p_reincorporation_date);
  IF v_contract_start IS NULL THEN
    RAISE EXCEPTION 'La fecha de inicio del contrato es obligatoria';
  END IF;
  IF v_contract_type.code = 'DETERMINADO' AND p_contract_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
  END IF;
  IF p_contract_end_date IS NOT NULL AND p_contract_end_date <= v_contract_start THEN
    RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
  END IF;

  v_readiness := public.validate_hiring_readiness(
    NULL, p_worker_id, p_new_position_id, p_signature_date, p_contract_type_id,
    p_signature_place, p_payment_method_id, p_representative_assignment_id,
    v_contract_start, p_contract_end_date
  );
  IF NOT (v_readiness->>'ready')::boolean THEN
    v_msg := public.format_contract_readiness_message(v_readiness->'missing');
    RAISE EXCEPTION '%', COALESCE(v_msg, 'No se puede reincorporar: faltan datos obligatorios.');
  END IF;

  UPDATE public.workers
  SET employment_status = 'active', updated_at = now()
  WHERE id = p_worker_id;

  UPDATE public.employment_contracts
  SET is_current = false, updated_at = now()
  WHERE worker_id = p_worker_id AND is_current = true;

  INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
  VALUES (p_worker_id, p_new_position_id, p_reincorporation_date, NULL, true)
  RETURNING id INTO v_new_assignment_id;

  INSERT INTO public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, is_current
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_new_assignment_id,
    p_contract_type_id, v_contract_start, p_contract_end_date, true
  ) RETURNING id INTO v_contract_id;

  PERFORM public.capture_contract_salary_snapshot(v_contract_id, 'REINCORPORATION', v_contract_start, p_notes);
  PERFORM public.capture_contract_party_snapshot(
    v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, v_contract_start)
  );
  v_conditions := public.apply_contract_conditions(
    v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    nullif(btrim(coalesce(p_payment_schedule_text, '')), '')
  );

  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, created_by
  ) VALUES (
    p_worker_id, 'REINCORPORACION', NULL, v_new_assignment_id,
    p_reincorporation_date, v_contract_type.name,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'assignment_id', v_new_assignment_id,
    'contract_id', v_contract_id,
    'effective_date', p_reincorporation_date,
    'is_principal_specialist', false,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$
;

-- 1.11 public.prenomina_cla_config
CREATE OR REPLACE FUNCTION public.prenomina_cla_config(p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_entry public.prenomina_worker_entries%rowtype;
  v_period public.prenomina_periods%rowtype;
  v_job_id uuid;
  v_job_enabled boolean;
  v_day_enabled boolean;
  v_day_rate numeric;
  v_night_enabled boolean;
  v_s1 public.organization_job_cla_night_segments%rowtype;
  v_s2 public.organization_job_cla_night_segments%rowtype;
  v_night_out boolean := false;
begin
  select * into v_entry from public.prenomina_worker_entries where id = p_entry_id;
  if not found then
    return jsonb_build_object('applicable', false);
  end if;
  select * into v_period from public.prenomina_periods where id = v_entry.period_id;
  if not public.can_access_entity(v_period.organization_entity_id, 'prenomina.view')
     and not public.can_access_entity(v_period.organization_entity_id, 'prenomina.manage') then
    raise exception 'Sin permiso para ver la prenómina';
  end if;

  select j.id, coalesce(j.has_abnormal_conditions, false), coalesce(j.cla_day_enabled, false),
         j.cla_day_hourly_rate, coalesce(j.cla_night_enabled, false)
    into v_job_id, v_job_enabled, v_day_enabled, v_day_rate, v_night_enabled
  from public.worker_position_assignments a
  join public.organization_positions p on p.id = a.position_id and p.is_active = true
  join public.organization_jobs j on j.id = p.job_id
  where (
      (v_entry.assignment_id is not null and a.id = v_entry.assignment_id)
      or (v_entry.assignment_id is null and a.worker_id = v_entry.worker_id
          AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date()))
    )
    and p.organization_entity_id = v_entry.organization_entity_id
  limit 1;

  if coalesce(v_job_enabled, false) and coalesce(v_night_enabled, false) then
    select * into v_s1 from public.organization_job_cla_night_segments where organization_job_id = v_job_id and segment_order = 1;
    select * into v_s2 from public.organization_job_cla_night_segments where organization_job_id = v_job_id and segment_order = 2;
    v_night_out := v_s1.id is not null and v_s2.id is not null;
  end if;

  return jsonb_build_object(
    'applicable', coalesce(v_job_enabled, false),
    'day_enabled', coalesce(v_job_enabled, false) and coalesce(v_day_enabled, false),
    'day_rate', case when coalesce(v_job_enabled, false) and coalesce(v_day_enabled, false) then v_day_rate else null end,
    'night_enabled', v_night_out,
    'night1_start', case when v_night_out then to_char(v_s1.start_time, 'HH24:MI') else null end,
    'night1_end', case when v_night_out then to_char(v_s1.end_time, 'HH24:MI') else null end,
    'night1_rate', case when v_night_out then v_s1.hourly_rate else null end,
    'night2_start', case when v_night_out then to_char(v_s2.start_time, 'HH24:MI') else null end,
    'night2_end', case when v_night_out then to_char(v_s2.end_time, 'HH24:MI') else null end,
    'night2_rate', case when v_night_out then v_s2.hourly_rate else null end
  );
end;
$function$
;

-- 1.12 public.prenomina_save_cla
CREATE OR REPLACE FUNCTION public.prenomina_save_cla(p_entry_id uuid, p_applied boolean, p_day_used boolean, p_day_minutes numeric, p_night_used boolean, p_night1_minutes numeric, p_night2_minutes numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_entry public.prenomina_worker_entries%rowtype;
  v_period public.prenomina_periods%rowtype;
  v_job_id uuid;
  v_job_enabled boolean;
  v_day_enabled boolean;
  v_day_rate numeric;
  v_night_enabled boolean;
  v_s1 public.organization_job_cla_night_segments%rowtype;
  v_s2 public.organization_job_cla_night_segments%rowtype;
  v_apply boolean;
  v_day_used boolean;
  v_night_used boolean;
begin
  select * into v_entry from public.prenomina_worker_entries where id = p_entry_id;
  if not found then raise exception 'Registro de prenómina no encontrado'; end if;
  select * into v_period from public.prenomina_periods where id = v_entry.period_id;
  if not public.can_access_entity(v_period.organization_entity_id, 'prenomina.manage') then
    raise exception 'Sin permiso para gestionar la prenómina';
  end if;
  if v_period.status <> 'BORRADOR' then
    raise exception 'La prenómina está cerrada y no puede editarse';
  end if;

  if coalesce(p_day_minutes, 0) < 0 or coalesce(p_night1_minutes, 0) < 0 or coalesce(p_night2_minutes, 0) < 0 then
    raise exception 'Los minutos de CLA no pueden ser negativos';
  end if;
  if (p_day_minutes is not null and p_day_minutes <> round(p_day_minutes))
     or (p_night1_minutes is not null and p_night1_minutes <> round(p_night1_minutes))
     or (p_night2_minutes is not null and p_night2_minutes <> round(p_night2_minutes)) then
    raise exception 'Los minutos de CLA deben ser un número entero';
  end if;

  select j.id, coalesce(j.has_abnormal_conditions, false), coalesce(j.cla_day_enabled, false),
         j.cla_day_hourly_rate, coalesce(j.cla_night_enabled, false)
    into v_job_id, v_job_enabled, v_day_enabled, v_day_rate, v_night_enabled
  from public.worker_position_assignments a
  join public.organization_positions p on p.id = a.position_id and p.is_active = true
  join public.organization_jobs j on j.id = p.job_id
  where (
      (v_entry.assignment_id is not null and a.id = v_entry.assignment_id)
      or (v_entry.assignment_id is null and a.worker_id = v_entry.worker_id
          AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date()))
    )
    and p.organization_entity_id = v_entry.organization_entity_id
  limit 1;

  v_apply := coalesce(p_applied, false) and coalesce(v_job_enabled, false);
  v_day_used := v_apply and v_day_enabled and coalesce(p_day_used, false);
  v_night_used := v_apply and v_night_enabled and coalesce(p_night_used, false);

  if v_apply then
    if v_day_enabled and (v_day_rate is null or v_day_rate < 0) then
      raise exception 'El Cargo tiene Pago diurno activado pero sin tarifa horaria configurada';
    end if;
    if v_night_enabled then
      select * into v_s1 from public.organization_job_cla_night_segments where organization_job_id = v_job_id and segment_order = 1;
      select * into v_s2 from public.organization_job_cla_night_segments where organization_job_id = v_job_id and segment_order = 2;
      if v_s1.id is null or v_s2.id is null then
        raise exception 'El Cargo tiene Pago nocturno activado pero sin los dos tramos configurados';
      end if;
    end if;
  end if;

  update public.prenomina_worker_entries set
    cla_applied = v_apply,
    cla_day_enabled = case when v_apply then v_day_enabled else false end,
    cla_day_used = v_day_used,
    cla_day_hourly_rate = case when v_apply and v_day_enabled then v_day_rate else null end,
    cla_day_minutes = case when v_day_used then coalesce(p_day_minutes, 0) else 0 end,
    cla_night_enabled = case when v_apply then v_night_enabled else false end,
    cla_night_used = v_night_used,
    cla_night1_start = case when v_apply and v_night_enabled then v_s1.start_time else null end,
    cla_night1_end = case when v_apply and v_night_enabled then v_s1.end_time else null end,
    cla_night1_hourly_rate = case when v_apply and v_night_enabled then v_s1.hourly_rate else null end,
    cla_night1_minutes = case when v_night_used then coalesce(p_night1_minutes, 0) else 0 end,
    cla_night2_start = case when v_apply and v_night_enabled then v_s2.start_time else null end,
    cla_night2_end = case when v_apply and v_night_enabled then v_s2.end_time else null end,
    cla_night2_hourly_rate = case when v_apply and v_night_enabled then v_s2.hourly_rate else null end,
    cla_night2_minutes = case when v_night_used then coalesce(p_night2_minutes, 0) else 0 end,
    updated_at = now()
  where id = p_entry_id;

  perform public.prenomina_recalc_entry(p_entry_id);
end;
$function$
;

-- 1.13 public.link_worker_to_position
CREATE OR REPLACE FUNCTION public.link_worker_to_position(p_worker_id uuid, p_position_id uuid, p_start_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_worker public.workers%ROWTYPE;
    v_position public.organization_positions%ROWTYPE;
    v_occ integer;
    v_assignment_id uuid;
    v_start date;
BEGIN
    SELECT *
    INTO v_worker
    FROM public.workers
    WHERE id = p_worker_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trabajador no encontrado';
    END IF;

    IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    IF v_worker.employment_status <> 'active' THEN
        RAISE EXCEPTION 'Solo se pueden vincular trabajadores activos';
    END IF;

    -- No inventar historial: solo se admite una vinculación inicial.
    IF EXISTS (
        SELECT 1
        FROM public.worker_position_assignments a
        WHERE a.worker_id = p_worker_id
          AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    ) THEN
        RAISE EXCEPTION 'El trabajador ya tiene un puesto actual asignado';
    END IF;

    -- %ROWTYPE requiere cargar la fila completa con correspondencia exacta.
    SELECT op.*
    INTO v_position
    FROM public.organization_positions op
    WHERE op.id = p_position_id
      AND op.organization_entity_id = v_worker.organization_entity_id
      AND op.is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Puesto no encontrado, inactivo o de otra entidad';
    END IF;

    SELECT COUNT(*)
    INTO v_occ
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.position_id = v_position.id
      AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
      AND w.employment_status = 'active';

    IF v_occ >= v_position.authorized_quantity THEN
        RAISE EXCEPTION 'El puesto no tiene plazas disponibles (capacidad: %, ocupadas: %)',
            v_position.authorized_quantity, v_occ;
    END IF;

    -- La vinculación no modifica la fecha histórica de incorporación.
    v_start := COALESCE(p_start_date, public.cuba_current_date());
    IF v_start < v_worker.hire_date THEN
        v_start := v_worker.hire_date;
    END IF;

    INSERT INTO public.worker_position_assignments (
        worker_id,
        position_id,
        start_date,
        end_date,
        is_current
    )
    VALUES (p_worker_id, v_position.id, v_start, NULL, true)
    RETURNING id INTO v_assignment_id;

    RETURN jsonb_build_object(
        'assignment_id', v_assignment_id,
        'position_id', v_position.id,
        'position_name', v_position.name,
        'start_date', v_start
    );
END;
$function$
;

-- 1.14 public.entity_staffing_export
CREATE OR REPLACE FUNCTION public.entity_staffing_export(p_entity_id uuid)
 RETURNS TABLE(area_id uuid, area_name text, job_id uuid, job_name text, position_id uuid, position_name text, occupational_category text, worker_id uuid, worker_name text, gender_code text, identification text, preparation_level text, salary_group_sequence integer, salary numeric, cla_amount numeric, academic_amount numeric, academic_category text, service_start date, has_masters_degree boolean, has_doctorate_degree boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not public.can_access_entity(p_entity_id, 'workers.view')
     and not public.can_access_entity(p_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para exportar la plantilla de esta entidad';
  end if;

  return query
  with occ as (
    select
      p.id as position_id,
      w.id as worker_id,
      nullif(btrim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)), '') as worker_name,
      w.identification,
      case
        when g.code = 'male' then 'M'
        when g.code = 'female' then 'F'
        else g.code
      end as gender_code,
      el.name as preparation_level,
      w.employment_start_date,
      coalesce(w.has_masters_degree, false) as has_masters_degree,
      coalesce(w.has_doctorate_degree, false) as has_doctorate_degree,
      ac.res->>'category' as academic_category,
      case
        when ac.res->>'category' is null then null
        else (ac.res->>'amount')::numeric
      end as academic_amount,
      row_number() over (
        partition by p.id
        order by w.first_surname nulls last, w.second_surname nulls last,
                 w.first_name nulls last, w.id
      ) as rn
    from public.organization_positions p
    join public.worker_position_assignments a
      on a.position_id = p.id
     AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    join public.workers w
      on w.id = a.worker_id
     and w.employment_status = 'active'
    left join public.genders g          on g.id  = w.gender_id
    left join public.education_levels el on el.id = w.education_level_id
    left join lateral (
      select public.resolve_academic_category_payment_for_flags(
        p_entity_id,
        coalesce(w.has_masters_degree, false),
        coalesce(w.has_doctorate_degree, false)
      ) as res
    ) ac on true
    where p.organization_entity_id = p_entity_id
      and p.is_active = true
  ),
  occ_count as (
    select oc.position_id, count(*)::int as c
    from occ oc
    group by oc.position_id
  ),
  applicable_scale as (
    select public.resolve_salary_scale_for_entity(p_entity_id) as scale_id
  )
  select
    a.id    as area_id,
    a.name  as area_name,
    j.id    as job_id,
    j.name  as job_name,
    p.id    as position_id,
    p.name  as position_name,
    oc.name as occupational_category,
    o.worker_id,
    o.worker_name,
    o.gender_code,
    o.identification,
    o.preparation_level,
    sg.sequence_number as salary_group_sequence,
    case
      when sg.salary_scale_id is not null
           and sg.salary_scale_id = (select scale_id from applicable_scale)
        then (select v.amount from public.resolve_salary_group_value(sg.id) v)
      else null
    end as salary,
    null::numeric as cla_amount,
    o.academic_amount,
    o.academic_category,
    o.employment_start_date as service_start,
    coalesce(o.has_masters_degree, false) as has_masters_degree,
    coalesce(o.has_doctorate_degree, false) as has_doctorate_degree
  from public.organization_positions p
  join public.organization_jobs j on j.id = p.job_id
  left join public.organization_areas a on a.id = j.area_id
  left join public.occupational_categories oc on oc.id = j.occupational_category_id
  left join public.salary_groups sg on sg.id = j.salary_group_id
  left join occ_count cc on cc.position_id = p.id
  cross join lateral generate_series(
    1, greatest(coalesce(p.authorized_quantity, 0), coalesce(cc.c, 0))
  ) as i
  left join occ o on o.position_id = p.id and o.rn = i
  where p.organization_entity_id = p_entity_id
    and p.is_active = true
  order by
    coalesce(a.hierarchy_order, 2147483647), a.name,
    coalesce(j.hierarchy_order, 2147483647), j.name,
    coalesce(p.position_order, 2147483647), p.name,
    (o.worker_id is null),
    o.worker_name,
    p.id, i;
end;
$function$
;

-- 1.15 public.enforce_worker_assignment_limit
CREATE OR REPLACE FUNCTION public.enforce_worker_assignment_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_active integer;
begin
  if new.is_current is not true or new.end_date is not null then
    return new;
  end if;

  perform 1 from public.workers where id = new.worker_id for update;

  select count(*) into v_active
  from public.worker_position_assignments a
  where a.worker_id = new.worker_id
    AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
    and a.id <> new.id;

  if v_active >= 2 then
    raise exception 'El trabajador ya tiene 2 puestos vigentes: no se puede crear un tercero'
      using errcode = 'check_violation';
  end if;

  return new;
end $function$
;

-- 1.16 public.handle_worker_sst_assignment_notification
CREATE OR REPLACE FUNCTION public.handle_worker_sst_assignment_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_worker record;
  v_pos_name text;
  v_job_id uuid;
  v_job_name text;
  v_area_id uuid;
  v_area_name text;
  v_prev_job_id uuid;
  v_trigger_type text;
  v_effective_date date;
  v_event_key text;
  v_full_name text;
  v_existing_id uuid;
BEGIN
  SELECT
    w.id,
    w.code,
    w.first_name,
    w.first_surname,
    w.second_surname,
    w.identification,
    w.hire_date,
    w.organization_entity_id
  INTO v_worker
  FROM public.workers w
  WHERE w.id = NEW.worker_id;

  IF v_worker.id IS NULL OR v_worker.organization_entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    op.name,
    oj.id,
    oj.name,
    oa.id,
    oa.name
  INTO v_pos_name, v_job_id, v_job_name, v_area_id, v_area_name
  FROM public.organization_positions op
  LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
  LEFT JOIN public.organization_areas oa ON oa.id = oj.area_id
  WHERE op.id = NEW.position_id;

  SELECT oj.id
    INTO v_prev_job_id
  FROM public.worker_position_assignments wpa
  JOIN public.organization_positions op ON op.id = wpa.position_id
  LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
  WHERE wpa.worker_id = v_worker.id
    AND wpa.id <> NEW.id
  ORDER BY wpa.start_date DESC NULLS LAST, wpa.created_at DESC
  LIMIT 1;

  IF v_prev_job_id IS NULL THEN
    v_trigger_type := 'NUEVA_CONTRATACION';
  ELSIF v_job_id IS NOT NULL AND v_prev_job_id IS DISTINCT FROM v_job_id THEN
    v_trigger_type := 'CAMBIO_CARGO';
  ELSE
    RETURN NEW;
  END IF;

  v_effective_date := COALESCE(NEW.start_date, v_worker.hire_date, public.cuba_current_date());
  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  UPDATE public.sst_onboarding_notifications s
  SET status = 'DESCARTADA'
  WHERE s.organization_entity_id = v_worker.organization_entity_id
    AND s.worker_id = v_worker.id
    AND s.status IN ('PENDIENTE', 'EN_PROCESO')
    AND s.job_id IS DISTINCT FROM v_job_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.worker_position_assignments a2
      JOIN public.organization_positions op2 ON op2.id = a2.position_id
      WHERE a2.worker_id = v_worker.id
        AND a2.is_current = true AND a2.start_date <= public.cuba_current_date() AND (a2.end_date IS NULL OR a2.end_date >= public.cuba_current_date())
        AND a2.id <> NEW.id
        AND op2.job_id = s.job_id
    );

  SELECT s.id
    INTO v_existing_id
  FROM public.sst_onboarding_notifications s
  WHERE s.organization_entity_id = v_worker.organization_entity_id
    AND s.worker_id = v_worker.id
    AND s.job_id IS NOT DISTINCT FROM v_job_id
    AND s.status IN ('PENDIENTE', 'EN_PROCESO')
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.sst_onboarding_notifications
    SET position_name = v_pos_name,
        area_id = v_area_id,
        area_name = v_area_name,
        job_name = v_job_name,
        effective_date = v_effective_date,
        worker_name = COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
        worker_code = v_worker.code,
        worker_identification = v_worker.identification
    WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  v_event_key := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || COALESCE(v_job_id::text, 'no-job') || ':' || v_trigger_type || ':' || v_effective_date::text;

  INSERT INTO public.sst_onboarding_notifications (
    organization_entity_id,
    worker_id,
    event_key,
    trigger_type,
    worker_name,
    worker_code,
    worker_identification,
    job_id,
    job_name,
    area_id,
    area_name,
    position_name,
    effective_date,
    status
  )
  VALUES (
    v_worker.organization_entity_id,
    v_worker.id,
    v_event_key,
    v_trigger_type,
    COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
    v_worker.code,
    v_worker.identification,
    v_job_id,
    v_job_name,
    v_area_id,
    v_area_name,
    v_pos_name,
    v_effective_date,
    'PENDIENTE'
  )
  ON CONFLICT (organization_entity_id, event_key) DO UPDATE
  SET status = CASE
        WHEN public.sst_onboarding_notifications.status = 'COMPLETADA' THEN 'COMPLETADA'
        ELSE 'PENDIENTE'
      END,
      position_name = EXCLUDED.position_name,
      area_id = EXCLUDED.area_id,
      area_name = EXCLUDED.area_name,
      job_name = EXCLUDED.job_name,
      effective_date = EXCLUDED.effective_date;

  RETURN NEW;
END;
$function$
;

-- 1.17 public.list_entity_medical_certificates
CREATE OR REPLACE FUNCTION public.list_entity_medical_certificates(p_entity_id uuid, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_certificates jsonb;
  v_total_days integer;
  v_count integer;
  v_worker_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.can_access_entity(p_entity_id, 'medical_certificates.view')
    OR public.can_access_entity(p_entity_id, 'medical_certificates.manage')
  ) THEN
    RAISE EXCEPTION 'You do not have access to this entity medical certificates';
  END IF;

  SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'worker_id', w.id,
        'worker_full_name', w.first_name || ' ' || w.first_surname
                           || COALESCE(' ' || NULLIF(w.second_surname, ''), ''),
        'worker_identification', w.identification,
        'area_name', area.area_name,
        'start_date', c.start_date,
        'return_date', c.return_date,
        'days', c.days,
        'document', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object(
          'id', d.id,
          'file_name', d.file_name,
          'mime_type', d.mime_type,
          'file_size', d.file_size,
          'storage_path', d.storage_path
        ) ELSE null END,
        'created_at', c.created_at
      )
      ORDER BY c.start_date DESC, w.first_surname, w.first_name
    ), '[]'::jsonb) INTO v_certificates
  FROM public.worker_medical_certificates c
  JOIN public.workers w ON w.id = c.worker_id
  LEFT JOIN public.worker_documents d ON d.id = c.document_id
  LEFT JOIN LATERAL (
    SELECT a.name AS area_name
    FROM public.worker_position_assignments wpa
    JOIN public.organization_positions op ON op.id = wpa.position_id
    JOIN public.organization_jobs oj ON oj.id = op.job_id
    LEFT JOIN public.organization_areas a ON a.id = oj.area_id
    WHERE wpa.worker_id = w.id
      AND wpa.is_current = true AND wpa.start_date <= public.cuba_current_date() AND (wpa.end_date IS NULL OR wpa.end_date >= public.cuba_current_date())
    ORDER BY wpa.start_date DESC
    LIMIT 1
  ) area ON true
  WHERE w.organization_entity_id = p_entity_id
    AND (p_year IS NULL OR extract(year from c.start_date)::int = p_year);

  SELECT coalesce(sum(c.days), 0)::int INTO v_total_days
  FROM public.worker_medical_certificates c
  JOIN public.workers w ON w.id = c.worker_id
  WHERE w.organization_entity_id = p_entity_id
    AND (p_year IS NULL OR extract(year from c.start_date)::int = p_year);

  SELECT count(*)::int INTO v_count
  FROM public.worker_medical_certificates c
  JOIN public.workers w ON w.id = c.worker_id
  WHERE w.organization_entity_id = p_entity_id
    AND (p_year IS NULL OR extract(year from c.start_date)::int = p_year);

  SELECT count(DISTINCT c.worker_id)::int INTO v_worker_count
  FROM public.worker_medical_certificates c
  JOIN public.workers w ON w.id = c.worker_id
  WHERE w.organization_entity_id = p_entity_id
    AND (p_year IS NULL OR extract(year from c.start_date)::int = p_year);

  RETURN jsonb_build_object(
    'entity_id', p_entity_id,
    'year', p_year,
    'certificates', v_certificates,
    'total_days', v_total_days,
    'count', v_count,
    'worker_count', v_worker_count
  );
END;
$function$
;

-- 1.18 public.migration_create_worker
CREATE OR REPLACE FUNCTION public.migration_create_worker(p_entity_id uuid, p_row jsonb, p_batch_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_entity_name text;
    v_worker_id uuid;
    v_code text;
    v_assignment_id uuid;
    v_contract_id uuid;
    v_position public.organization_positions%rowtype;
    v_occ integer;
    v_ident text;
    v_start date;
    v_balance numeric;
    v_cutoff date;
    v_contract jsonb;
    v_rep public.organization_representative_assignments%rowtype;
    v_scale_id uuid;
    v_group_id uuid;
    v_group_seq integer;
    v_attempt integer;
    v_contract_type_code text;
    v_contract_start date;
    v_contract_end date;
BEGIN
    v_position := NULL;
    v_rep := NULL;

    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    SELECT company_client_id, name INTO v_tenant_id, v_entity_name
    FROM public.organization_entities
    WHERE id = p_entity_id AND is_active = true;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'La entidad no existe o no está activa';
    END IF;

    v_ident := NULLIF(btrim(COALESCE(p_row ->> 'identification', '')), '');
    IF v_ident IS NULL THEN
        RAISE EXCEPTION 'El carné de identidad es obligatorio';
    END IF;
    IF NULLIF(btrim(COALESCE(p_row ->> 'first_name', '')), '') IS NULL THEN
        RAISE EXCEPTION 'El nombre es obligatorio';
    END IF;
    IF NULLIF(btrim(COALESCE(p_row ->> 'first_surname', '')), '') IS NULL THEN
        RAISE EXCEPTION 'El primer apellido es obligatorio';
    END IF;

    v_start := NULLIF(btrim(COALESCE(p_row ->> 'employment_start_date', '')), '')::date;
    IF v_start IS NULL THEN
        RAISE EXCEPTION 'La fecha de incorporación es obligatoria';
    END IF;
    IF v_start > public.cuba_current_date() THEN
        RAISE EXCEPTION 'La fecha de incorporación no puede ser futura';
    END IF;

    IF NULLIF(btrim(COALESCE(p_row ->> 'position_id', '')), '') IS NOT NULL THEN
        SELECT op.id, op.authorized_quantity, op.job_id
        INTO v_position
        FROM public.organization_positions op
        WHERE op.id = (p_row ->> 'position_id')::uuid
          AND op.organization_entity_id = p_entity_id
          AND op.is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Puesto no encontrado o inactivo en esta entidad';
        END IF;

        SELECT COUNT(*) INTO v_occ
        FROM public.worker_position_assignments a
        JOIN public.workers w ON w.id = a.worker_id
        WHERE a.position_id = v_position.id
          AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
          AND w.employment_status = 'active';

        IF v_occ >= v_position.authorized_quantity THEN
            RAISE EXCEPTION 'El puesto no tiene plazas disponibles (capacidad: %, ocupadas: %)',
                v_position.authorized_quantity, v_occ;
        END IF;
    END IF;

    FOR v_attempt IN 1..5 LOOP
        v_code := 'TRB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            INSERT INTO public.workers (
                company_client_id, organization_entity_id, code,
                first_name, first_surname, second_surname, identification, birth_date,
                gender_id, marital_status_id, education_level_id, specialty, skin_color_id,
                profession_or_trade, address, province, municipality, phone, email,
                hire_date, employment_start_date, employment_status,
                origin, migrated_at, migration_batch_id
            ) VALUES (
                v_tenant_id, p_entity_id, v_code,
                btrim(p_row ->> 'first_name'),
                btrim(p_row ->> 'first_surname'),
                NULLIF(btrim(COALESCE(p_row ->> 'second_surname', '')), ''),
                v_ident,
                NULLIF(btrim(COALESCE(p_row ->> 'birth_date', '')), '')::date,
                NULLIF(btrim(COALESCE(p_row ->> 'gender_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'marital_status_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'education_level_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'specialty', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'skin_color_id', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'profession_or_trade', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'address', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'province', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'municipality', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'phone', '')), ''),
                NULLIF(btrim(COALESCE(p_row ->> 'email', '')), ''),
                v_start, v_start, 'active',
                'MIGRATION', now(), p_batch_id
            ) RETURNING id INTO v_worker_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF SQLERRM LIKE '%workers_tenant_code_unique%' THEN
                v_worker_id := NULL;
            ELSE
                RAISE;
            END IF;
        END;
    END LOOP;
    IF v_worker_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo generar un código único de trabajador. Inténtalo de nuevo.';
    END IF;

    IF jsonb_typeof(p_row -> 'driving_license_category_ids') = 'array' THEN
        INSERT INTO public.worker_driving_license_categories (worker_id, driving_license_category_id)
        SELECT DISTINCT v_worker_id, d.id
        FROM jsonb_array_elements_text(p_row -> 'driving_license_category_ids') AS c
        JOIN public.driving_license_categories d ON d.id = btrim(c)
        WHERE NULLIF(btrim(c), '') IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;

    IF v_position.id IS NOT NULL THEN
        INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
        VALUES (
            v_worker_id,
            v_position.id,
            COALESCE(NULLIF(btrim(COALESCE(p_row ->> 'assignment_start_date', '')), '')::date, v_start),
            NULL,
            true
        )
        RETURNING id INTO v_assignment_id;
    END IF;

    v_contract := p_row -> 'contract';
    IF v_assignment_id IS NOT NULL
       AND v_contract IS NOT NULL
       AND jsonb_typeof(v_contract) = 'object'
       AND NULLIF(btrim(COALESCE(v_contract ->> 'contract_type_id', '')), '') IS NOT NULL THEN

        v_contract_start := NULLIF(btrim(COALESCE(v_contract ->> 'start_date', '')), '')::date;
        v_contract_end := NULLIF(btrim(COALESCE(v_contract ->> 'end_date', '')), '')::date;
        IF v_contract_start IS NULL THEN
            RAISE EXCEPTION 'El contrato migrado requiere fecha de inicio';
        END IF;

        SELECT code INTO v_contract_type_code
        FROM public.employment_contract_types
        WHERE id = (v_contract ->> 'contract_type_id')::uuid AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Tipo de contrato no encontrado o inactivo';
        END IF;
        IF v_contract_type_code = 'DETERMINADO' AND v_contract_end IS NULL THEN
            RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
        END IF;
        IF v_contract_end IS NOT NULL AND v_contract_end <= v_contract_start THEN
            RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
        END IF;

        SELECT j.salary_group_id, sg.sequence_number
        INTO v_group_id, v_group_seq
        FROM public.organization_positions op
        JOIN public.organization_jobs j ON j.id = op.job_id
        LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
        WHERE op.id = v_position.id;

        v_scale_id := public.resolve_salary_scale_for_entity(p_entity_id);

        IF NULLIF(btrim(COALESCE(v_contract ->> 'representative_assignment_id', '')), '') IS NOT NULL THEN
            SELECT ora.person_name, rp.title
            INTO v_rep
            FROM public.organization_representative_assignments ora
            JOIN public.organization_representative_positions rp
              ON rp.id = ora.representative_position_id
            WHERE ora.id = (v_contract ->> 'representative_assignment_id')::uuid
              AND ora.organization_entity_id = p_entity_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Representante no válido para esta entidad';
            END IF;
        END IF;

        INSERT INTO public.employment_contracts (
            company_client_id, organization_entity_id, worker_id, assignment_id,
            contract_type_id, start_date, end_date, is_current,
            salary_group_id, salary_scale_id, salary_amount, salary_currency_code,
            salary_effective_date, salary_captured_at, salary_snapshot_status,
            representative_assignment_id, representative_name_snapshot,
            representative_position_snapshot, representative_captured_at,
            entity_name_snapshot,
            signature_date, signature_place, payment_method_id, payment_schedule_text,
            total_compensation_snapshot, conditions_captured_at
        ) VALUES (
            v_tenant_id, p_entity_id, v_worker_id, v_assignment_id,
            (v_contract ->> 'contract_type_id')::uuid, v_contract_start, v_contract_end, true,
            v_group_id, v_scale_id,
            NULLIF(btrim(COALESCE(v_contract ->> 'salary_amount', '')), '')::numeric,
            COALESCE(NULLIF(btrim(COALESCE(v_contract ->> 'salary_currency', '')), ''), 'CUP'),
            v_contract_start, now(), 'CAPTURED',
            (v_contract ->> 'representative_assignment_id')::uuid,
            v_rep.person_name, v_rep.title, now(),
            v_entity_name,
            NULLIF(btrim(COALESCE(v_contract ->> 'signature_date', '')), '')::date,
            NULLIF(btrim(COALESCE(v_contract ->> 'signature_place', '')), ''),
            NULLIF(btrim(COALESCE(v_contract ->> 'payment_method_id', '')), '')::uuid,
            NULLIF(btrim(COALESCE(v_contract ->> 'payment_schedule_text', '')), ''),
            NULLIF(btrim(COALESCE(v_contract ->> 'salary_amount', '')), '')::numeric,
            now()
        ) RETURNING id INTO v_contract_id;

        IF NULLIF(btrim(COALESCE(v_contract ->> 'salary_amount', '')), '') IS NOT NULL THEN
            PERFORM public.record_worker_salary_event(
                v_worker_id, v_contract_id, v_assignment_id,
                v_group_id, v_scale_id, NULL,
                NULL,
                (v_contract ->> 'salary_amount')::numeric,
                COALESCE(NULLIF(btrim(COALESCE(v_contract ->> 'salary_currency', '')), ''), 'CUP'),
                v_contract_start,
                'INITIAL_CONTRACT',
                'Contrato migrado (estado inicial)'
            );
        END IF;
    END IF;

    IF NULLIF(btrim(COALESCE(p_row ->> 'initial_vacation_balance', '')), '') IS NOT NULL THEN
        v_balance := (p_row ->> 'initial_vacation_balance')::numeric;
        v_cutoff := COALESCE(
            NULLIF(btrim(COALESCE(p_row ->> 'vacation_cutoff_date', '')), '')::date,
            v_start
        );
        IF v_balance < 0 OR v_balance > 24 THEN
            RAISE EXCEPTION 'El saldo inicial de vacaciones debe estar entre 0 y 24 días';
        END IF;

        INSERT INTO public.worker_vacation_movements (
            company_client_id, organization_entity_id, worker_id,
            movement_type, amount, calculated_amount, effective_date,
            description, created_by
        ) VALUES (
            v_tenant_id, p_entity_id, v_worker_id,
            'INITIAL_BALANCE', round(v_balance, 4), round(v_balance, 4), v_cutoff,
            format('Saldo inicial a %s', to_char(v_cutoff, 'DD/MM/YYYY')), auth.uid()
        );
    END IF;

    RETURN jsonb_build_object(
        'worker_id', v_worker_id,
        'code', v_code,
        'assignment_id', v_assignment_id,
        'contract_id', v_contract_id
    );
END;
$function$
;

-- 1.19 public.migration_validate_rows
CREATE OR REPLACE FUNCTION public.migration_validate_rows(p_entity_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_row jsonb;
    v_idx integer := 0;
    v_result jsonb := '[]'::jsonb;
    v_status text;
    v_messages text[];
    v_ident text;
    v_start date;
    v_position public.organization_positions%rowtype;
    v_pos_raw text;
    v_pos_id uuid;
    v_pos_label text;
    v_matches integer;
    v_occ integer;
    v_batch jsonb := '{}'::jsonb;
    v_seen jsonb := '{}'::jsonb;
    v_balance text;
    v_contract jsonb;
    v_contract_type_code text;
    v_cstart date;
    v_cend date;
    v_today date := public.cuba_current_date();
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    SELECT company_client_id INTO v_tenant_id
    FROM public.organization_entities WHERE id = p_entity_id AND is_active = true;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'La entidad no existe o no está activa';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'Se esperaba una lista de filas';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        v_status := 'VALID';
        v_messages := ARRAY[]::text[];
        v_pos_id := NULL;
        v_pos_label := NULL;
        v_position := NULL;
        v_contract_type_code := NULL;
        v_cstart := NULL;
        v_cend := NULL;

        IF NULLIF(btrim(COALESCE(v_row ->> 'first_name', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El nombre es obligatorio');
        END IF;
        IF NULLIF(btrim(COALESCE(v_row ->> 'first_surname', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El primer apellido es obligatorio');
        END IF;

        v_ident := NULLIF(btrim(COALESCE(v_row ->> 'identification', '')), '');
        IF v_ident IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El carné de identidad es obligatorio');
        ELSE
            IF v_ident !~ '^[0-9]{11}$' THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'El número de identificación debe contener exactamente 11 dígitos');
            END IF;

            IF v_seen ? v_ident THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Identificación repetida dentro del archivo (%s): otra fila usa el mismo carné. Corrija la identificación.', v_ident);
            ELSE
                v_seen := v_seen || jsonb_build_object(v_ident, true);
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.workers w
                WHERE w.company_client_id = v_tenant_id
                  AND w.identification = v_ident
            ) THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Ya existe un trabajador en este workspace con el carné de identidad %s. Se creará igualmente; corrija la identificación.', v_ident);
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.candidates c
                WHERE c.company_client_id = v_tenant_id
                  AND c.identification = v_ident
            ) THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Existe un candidato en este workspace con el carné de identidad %s. Corrija la identificación si no es la misma persona.', v_ident);
            END IF;
        END IF;

        BEGIN
            v_start := NULLIF(btrim(COALESCE(v_row ->> 'employment_start_date', '')), '')::date;
        EXCEPTION WHEN OTHERS THEN
            v_start := NULL;
        END;
        IF v_start IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'Fecha de incorporación inválida o vacía');
        ELSIF v_start > v_today THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'La fecha de incorporación no puede ser futura');
        END IF;

        v_pos_raw := NULLIF(btrim(COALESCE(v_row ->> 'position_id', '')), '');
        IF v_pos_raw IS NULL THEN
            v_pos_raw := NULLIF(btrim(COALESCE(v_row ->> 'position_code', '')), '');
        END IF;

        IF v_pos_raw IS NOT NULL THEN
            BEGIN
                v_pos_id := v_pos_raw::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_pos_id := NULL;
            END;
        END IF;

        IF v_pos_id IS NOT NULL THEN
            SELECT op.*
            INTO v_position
            FROM public.organization_positions op
            WHERE op.id = v_pos_id
              AND op.organization_entity_id = p_entity_id
              AND op.is_active = true;
            IF NOT FOUND THEN
                v_pos_id := NULL;
                v_status := 'ERROR';
                v_messages := v_messages || format('Puesto no encontrado (%s)', v_pos_raw);
            END IF;
        ELSIF v_pos_raw IS NOT NULL THEN
            SELECT COUNT(*) INTO v_matches
            FROM public.organization_positions op
            WHERE op.organization_entity_id = p_entity_id
              AND op.is_active = true
              AND upper(btrim(op.name)) = upper(btrim(v_pos_raw));
            IF v_matches = 0 THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Puesto no encontrado (%s)', v_pos_raw);
            ELSIF v_matches > 1 THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Referencia de puesto ambigua (%s): use el identificador', v_pos_raw);
            ELSE
                SELECT op.*
                INTO v_position
                FROM public.organization_positions op
                WHERE op.organization_entity_id = p_entity_id
                   AND op.is_active = true
                   AND upper(btrim(op.name)) = upper(btrim(v_pos_raw));
            END IF;
        END IF;

        IF v_position.id IS NOT NULL THEN
            v_pos_id := v_position.id;
            v_pos_label := v_position.name;

            SELECT COUNT(*) INTO v_occ
            FROM public.worker_position_assignments a
            JOIN public.workers w ON w.id = a.worker_id
            WHERE a.position_id = v_position.id
              AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
              AND w.employment_status = 'active';

            v_occ := v_occ + COALESCE((v_batch ->> v_position.id::text)::int, 0);

            IF v_occ >= v_position.authorized_quantity THEN
                v_status := 'ERROR';
                v_messages := v_messages || format(
                    'Puesto sin capacidad disponible: %s (capacidad %s, ocupadas %s)',
                    v_position.name, v_position.authorized_quantity, v_occ
                );
            ELSE
                v_batch := v_batch || jsonb_build_object(
                    v_position.id::text, COALESCE((v_batch ->> v_position.id::text)::int, 0) + 1
                );
            END IF;
        ELSIF v_pos_raw IS NULL THEN
            IF v_status <> 'ERROR' THEN
                v_status := 'WARNING';
            END IF;
            v_messages := array_append(v_messages, 'Se importará como pendiente de vinculación a plantilla');
        END IF;

        v_balance := NULLIF(btrim(COALESCE(v_row ->> 'initial_vacation_balance', '')), '');
        IF v_balance IS NOT NULL THEN
            BEGIN
                IF v_balance::numeric < 0 OR v_balance::numeric > 24 THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El saldo inicial de vacaciones debe estar entre 0 y 24 días');
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'Saldo inicial de vacaciones inválido');
            END;
            IF NULLIF(btrim(COALESCE(v_row ->> 'vacation_cutoff_date', '')), '') IS NULL
               AND v_status <> 'ERROR' THEN
                v_messages := array_append(v_messages, 'Sin fecha de corte: se usará la fecha de incorporación');
            END IF;
        END IF;

        v_contract := v_row -> 'contract';
        IF v_contract IS NOT NULL AND jsonb_typeof(v_contract) = 'object' THEN
            IF v_pos_id IS NULL THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'El contrato migrado requiere que el trabajador se vincule a un puesto');
            ELSE
                SELECT code INTO v_contract_type_code
                FROM public.employment_contract_types
                WHERE id = NULLIF(btrim(COALESCE(v_contract ->> 'contract_type_id', '')), '')::uuid
                  AND is_active = true;
                IF v_contract_type_code IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'Tipo de contrato no encontrado o inactivo');
                END IF;

                BEGIN
                    v_cstart := NULLIF(btrim(COALESCE(v_contract ->> 'start_date', '')), '')::date;
                    v_cend := NULLIF(btrim(COALESCE(v_contract ->> 'end_date', '')), '')::date;
                EXCEPTION WHEN OTHERS THEN
                    v_cstart := NULL; v_cend := NULL;
                END;

                IF v_cstart IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El contrato migrado requiere fecha de inicio');
                END IF;
                IF v_contract_type_code = 'DETERMINADO' AND v_cend IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El contrato por tiempo determinado requiere fecha de fin');
                END IF;
                IF v_cend IS NOT NULL AND v_cstart IS NOT NULL AND v_cend <= v_cstart THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'La fecha de fin del contrato debe ser posterior a su inicio');
                END IF;
            END IF;
        END IF;

        v_result := v_result || jsonb_build_object(
            'index', v_idx,
            'status', v_status,
            'messages', to_jsonb(v_messages),
            'position_id', v_pos_id,
            'position_label', v_pos_label
        );

        v_idx := v_idx + 1;
    END LOOP;

    RETURN v_result;
END;
$function$
;

-- 1.20 public.pending_contract_formalization
CREATE OR REPLACE FUNCTION public.pending_contract_formalization(p_entity_id uuid, p_position_id uuid, p_signature_date date, p_signature_place text, p_payment_method_id uuid, p_representative_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_entity public.organization_entities%ROWTYPE;
  v_job public.organization_jobs%ROWTYPE;
  v_group public.salary_groups%ROWTYPE;
  v_scale_id uuid;
  v_amount numeric;
  v_blocking text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_item text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.can_access_entity(p_entity_id, 'workers.view') THEN
    RAISE EXCEPTION 'No tiene permiso para consultar contratos de esta entidad';
  END IF;

  -- 1) Datos contractuales de la entidad (mismo conjunto que se incorpora al contrato)
  SELECT * INTO v_entity FROM public.organization_entities WHERE id = p_entity_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('blocking', to_jsonb(ARRAY['Entidad contractual']::text[]), 'warnings', to_jsonb(v_warnings));
  END IF;

  FOREACH v_item IN ARRAY ARRAY[
    CASE WHEN btrim(coalesce(v_entity.organism, '')) = '' THEN 'Organismo al que pertenece' END,
    CASE WHEN btrim(coalesce(v_entity.branch, '')) = '' THEN 'Rama' END,
    CASE WHEN btrim(coalesce(v_entity.labor_identification_code, '')) = '' THEN 'Código de identificación laboral/organizacional' END,
    CASE WHEN btrim(coalesce(v_entity.address, '')) = '' THEN 'Dirección' END,
    CASE WHEN btrim(coalesce(v_entity.province, '')) = '' THEN 'Provincia' END,
    CASE WHEN btrim(coalesce(v_entity.municipality, '')) = '' THEN 'Municipio' END
  ]
  LOOP
    IF v_item IS NOT NULL THEN
      v_blocking := array_append(v_blocking, v_item);
    END IF;
  END LOOP;

  -- 2) Datos de firma y forma de pago
  IF p_signature_date IS NULL THEN
    v_blocking := array_append(v_blocking, 'Fecha de firma');
  END IF;

  IF btrim(coalesce(p_signature_place, '')) = '' THEN
    v_blocking := array_append(v_blocking, 'Lugar de firma');
  END IF;

  IF p_payment_method_id IS NULL THEN
    v_blocking := array_append(v_blocking, 'Forma de pago');
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.payment_methods pm
    WHERE pm.id = p_payment_method_id AND pm.is_active = true
  ) THEN
    v_blocking := array_append(v_blocking, 'Forma de pago válida');
  END IF;

  -- 3) Representante autorizado vigente en la FECHA DE FIRMA (resolución por fecha)
  IF p_representative_assignment_id IS NULL THEN
    v_blocking := array_append(v_blocking, 'Representante autorizado vigente en la fecha de firma');
  ELSIF p_signature_date IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_representative_assignments ra
      JOIN public.organization_representative_positions rp ON rp.id = ra.representative_position_id
      WHERE ra.id = p_representative_assignment_id
        AND rp.organization_entity_id = p_entity_id
        AND ra.effective_from <= p_signature_date
        AND (ra.effective_to IS NULL OR ra.effective_to >= p_signature_date)
    ) THEN
      v_blocking := array_append(v_blocking, 'Representante autorizado vigente en la fecha de firma');
    END IF;
  END IF;

  -- 4) Estructura salarial (sin fallback entre regímenes: Empresarial nunca usa la Presupuestada)
  v_scale_id := public.resolve_salary_scale_for_entity(p_entity_id);

  IF v_scale_id IS NULL THEN
    IF upper(btrim(coalesce(v_entity.regime_id, ''))) = 'PRESUPUESTADA' THEN
      v_blocking := array_append(v_blocking, 'Escala salarial presupuestada configurada');
    ELSE
      v_blocking := array_append(v_blocking, 'Escala salarial empresarial configurada para la entidad');
    END IF;
  ELSIF p_position_id IS NOT NULL THEN
    SELECT j.* INTO v_job
    FROM public.organization_positions p
    JOIN public.organization_jobs j ON j.id = p.job_id
    WHERE p.id = p_position_id;

    IF FOUND THEN
      IF v_job.salary_group_id IS NULL THEN
        v_blocking := array_append(v_blocking, 'Grupo salarial configurado en el cargo del puesto');
      ELSE
        SELECT * INTO v_group FROM public.salary_groups WHERE id = v_job.salary_group_id;
        IF v_group.salary_scale_id IS DISTINCT FROM v_scale_id THEN
          v_blocking := array_append(v_blocking, 'Grupo salarial del cargo en la escala aplicable a la entidad');
        ELSE
          SELECT r.amount INTO v_amount
          FROM public.resolve_salary_group_value(v_group.id, COALESCE(p_signature_date, public.cuba_current_date())) r;
          IF v_amount IS NULL THEN
            v_blocking := array_append(v_blocking, 'Salario de escala configurado para el grupo del cargo');
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 5) Avisos (no bloquean la formalización): profesión u oficio de la persona
  IF p_position_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.worker_position_assignments a
      JOIN public.workers w ON w.id = a.worker_id
      WHERE a.position_id = p_position_id
        AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
        AND btrim(coalesce(w.profession_or_trade, '')) = ''
        AND w.organization_entity_id = p_entity_id
    ) THEN
      v_warnings := array_append(v_warnings, 'Profesión u oficio de la persona');
    END IF;
  END IF;

  RETURN jsonb_build_object('blocking', to_jsonb(v_blocking), 'warnings', to_jsonb(v_warnings));
END;
$function$
;

-- 1.21 public.trg_fn_sync_employment_period_on_movement
CREATE OR REPLACE FUNCTION public.trg_fn_sync_employment_period_on_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_active_period public.worker_employment_periods%ROWTYPE;
  v_remaining_assignments integer;
  v_reason_name text;
  v_reason_code text;
  v_validation_status text;
  v_other_reason text;
  v_next_seq integer;
  v_pos text;
  v_area text;
  v_cat text;
  v_prior_baja record;
  v_last_closed_assignment_end date;
BEGIN
  SELECT * INTO v_worker
  FROM public.workers
  WHERE id = NEW.worker_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Asegurar que exista al menos el período inicial (seq = 1)
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_employment_periods WHERE worker_id = NEW.worker_id
  ) THEN
    SELECT s.position_name, s.area_name, s.occupational_category_name
      INTO v_pos, v_area, v_cat
    FROM public.get_worker_assignment_snapshot(NEW.worker_id, coalesce(NEW.previous_assignment_id, NEW.new_assignment_id)) s;

    INSERT INTO public.worker_employment_periods (
      company_client_id,
      organization_entity_id,
      worker_id,
      period_sequence,
      origin_type,
      hire_date,
      position_name_snapshot,
      area_name_snapshot,
      occupational_category_snapshot,
      status
    ) VALUES (
      v_worker.company_client_id,
      v_worker.organization_entity_id,
      v_worker.id,
      1,
      CASE WHEN v_worker.origin = 'MIGRATION' THEN 'MIGRATION' ELSE 'INITIAL_HIRE' END,
      coalesce(v_worker.employment_start_date, v_worker.hire_date, NEW.effective_date),
      v_pos,
      v_area,
      v_cat,
      'ACTIVE'
    );
  END IF;

  -- ==========================================================================
  -- CASO A: Movimiento de BAJA
  -- ==========================================================================
  IF NEW.movement_type = 'BAJA' THEN
    -- Comprobar cuántos puestos activos restantes tiene el trabajador en la entidad
    -- (independientemente del orden en que se actualice workers.employment_status).
    SELECT count(*)
      INTO v_remaining_assignments
    FROM public.worker_position_assignments a
    WHERE a.worker_id = NEW.worker_id
      AND a.is_current = true AND a.start_date <= public.cuba_current_date() AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
      AND (NEW.previous_assignment_id IS NULL OR a.id <> NEW.previous_assignment_id);

    -- Si aún conserva otra plaza activa (baja parcial en pluriempleo), NO cierra el período laboral
    IF v_remaining_assignments > 0 AND v_worker.employment_status = 'active' THEN
      RETURN NEW;
    END IF;

    SELECT *
      INTO v_active_period
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.worker_id
      AND wep.status = 'ACTIVE'
    ORDER BY wep.period_sequence DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    IF NEW.separation_reason_id IS NOT NULL THEN
      SELECT r.name, r.code
        INTO v_reason_name, v_reason_code
      FROM public.worker_separation_reasons r
      WHERE r.id = NEW.separation_reason_id;
    END IF;

    v_other_reason := CASE
      WHEN v_reason_code = 'OTRO' OR lower(btrim(coalesce(v_reason_name, ''))) = 'otro'
        THEN coalesce(
          nullif(btrim(coalesce(NEW.separation_other_reason, '')), ''),
          nullif(btrim(coalesce(NEW.notes, '')), '')
        )
      ELSE nullif(btrim(coalesce(NEW.separation_other_reason, '')), '')
    END;

    v_validation_status := CASE
      WHEN NEW.separation_reason_id IS NULL THEN 'PENDING_VALIDATION'
      WHEN v_reason_name IS NOT NULL
           AND NEW.reason IS NOT NULL
           AND lower(btrim(v_reason_name)) = lower(btrim(NEW.reason))
        THEN 'AUTO_MATCHED'
      ELSE 'PENDING_VALIDATION'
    END;

    SELECT s.position_name, s.area_name, s.occupational_category_name
      INTO v_pos, v_area, v_cat
    FROM public.get_worker_assignment_snapshot(NEW.worker_id, NEW.previous_assignment_id) s;

    UPDATE public.worker_employment_periods wep
    SET
      separation_movement_id = NEW.id,
      separation_date = greatest(NEW.effective_date, wep.hire_date),
      separation_number = nullif(btrim(coalesce(NEW.separation_number, '')), ''),
      separation_reason_id = NEW.separation_reason_id,
      separation_reason_catalog_snapshot = v_reason_name,
      separation_reason_movement_snapshot = NEW.reason,
      separation_other_reason = v_other_reason,
      separation_notes = NEW.notes,
      reason_validation_status = v_validation_status,
      inconsistency_code = CASE
        WHEN NEW.effective_date < wep.hire_date THEN 'SEPARATION_BEFORE_HIRE_ADJUSTED'
        WHEN v_validation_status = 'PENDING_VALIDATION' THEN 'REASON_TEXT_MISMATCH'
        ELSE wep.inconsistency_code
      END,
      inconsistency_details = CASE
        WHEN NEW.effective_date < wep.hire_date
          THEN format('La fecha del movimiento de baja (%s) era anterior al alta (%s).', NEW.effective_date, wep.hire_date)
        WHEN v_validation_status = 'PENDING_VALIDATION'
          THEN format('Motivo catálogo: "%s" vs texto movimiento: "%s".', coalesce(v_reason_name, 'N/A'), coalesce(NEW.reason, 'N/A'))
        ELSE wep.inconsistency_details
      END,
      position_name_snapshot = coalesce(wep.position_name_snapshot, v_pos),
      area_name_snapshot = coalesce(wep.area_name_snapshot, v_area),
      occupational_category_snapshot = coalesce(wep.occupational_category_snapshot, v_cat),
      status = 'CLOSED',
      updated_at = now()
    WHERE wep.id = v_active_period.id;

    RETURN NEW;
  END IF;

  -- ==========================================================================
  -- CASO B: Movimiento de REINCORPORACION
  -- ==========================================================================
  IF NEW.movement_type = 'REINCORPORACION' THEN
    -- Idempotencia: si ya existe un período asociado a este movimiento de reincorporación, actualizarlo
    IF EXISTS (
      SELECT 1
      FROM public.worker_employment_periods wep
      WHERE wep.reincorporation_movement_id = NEW.id
    ) THEN
      RETURN NEW;
    END IF;

    -- Verificar si quedó un período previo ACTIVE sin cerrar (por ejemplo, datos previos no sincronizados)
    SELECT *
      INTO v_active_period
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.worker_id
      AND wep.status = 'ACTIVE'
    ORDER BY wep.period_sequence DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      -- Buscar si existe un movimiento de BAJA no vinculado aún para cerrar el período previo
      SELECT m.*, r.name AS catalog_name, r.code AS catalog_code
        INTO v_prior_baja
      FROM public.worker_employment_movements m
      LEFT JOIN public.worker_separation_reasons r ON r.id = m.separation_reason_id
      WHERE m.worker_id = NEW.worker_id
        AND m.movement_type = 'BAJA'
        AND m.effective_date >= v_active_period.hire_date
        AND m.effective_date <= NEW.effective_date
        AND NOT EXISTS (
          SELECT 1
          FROM public.worker_employment_periods p2
          WHERE p2.separation_movement_id = m.id
        )
      ORDER BY m.effective_date DESC, m.created_at DESC
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.worker_employment_periods wep
        SET
          separation_movement_id = v_prior_baja.id,
          separation_date = greatest(v_prior_baja.effective_date, wep.hire_date),
          separation_number = nullif(btrim(coalesce(v_prior_baja.separation_number, '')), ''),
          separation_reason_id = v_prior_baja.separation_reason_id,
          separation_reason_catalog_snapshot = v_prior_baja.catalog_name,
          separation_reason_movement_snapshot = v_prior_baja.reason,
          separation_other_reason = CASE
            WHEN v_prior_baja.catalog_code = 'OTRO' OR lower(btrim(coalesce(v_prior_baja.catalog_name, ''))) = 'otro'
              THEN coalesce(nullif(btrim(coalesce(v_prior_baja.separation_other_reason, '')), ''), nullif(btrim(coalesce(v_prior_baja.notes, '')), ''))
            ELSE nullif(btrim(coalesce(v_prior_baja.separation_other_reason, '')), '')
          END,
          separation_notes = v_prior_baja.notes,
          reason_validation_status = CASE
            WHEN v_prior_baja.catalog_name = 'Fallecimiento' THEN 'PENDING_VALIDATION'
            WHEN v_prior_baja.catalog_name IS NOT NULL
                 AND v_prior_baja.reason IS NOT NULL
                 AND lower(btrim(v_prior_baja.catalog_name)) = lower(btrim(v_prior_baja.reason))
              THEN 'AUTO_MATCHED'
            ELSE 'PENDING_VALIDATION'
          END,
          inconsistency_code = CASE
            WHEN v_prior_baja.catalog_name = 'Fallecimiento' THEN ' CONTRADICTION_DECEASED_REINCORPORATED'
            WHEN v_prior_baja.catalog_name IS DISTINCT FROM v_prior_baja.reason THEN 'REASON_TEXT_MISMATCH'
            ELSE wep.inconsistency_code
          END,
          inconsistency_details = CASE
            WHEN v_prior_baja.catalog_name = 'Fallecimiento'
              THEN 'Contradicción material: baja por Fallecimiento seguida de reincorporación posterior.'
            WHEN v_prior_baja.catalog_name IS DISTINCT FROM v_prior_baja.reason
              THEN format('Motivo catálogo: "%s" vs texto movimiento: "%s".', coalesce(v_prior_baja.catalog_name, 'N/A'), coalesce(v_prior_baja.reason, 'N/A'))
            ELSE wep.inconsistency_details
          END,
          status = 'CLOSED',
          updated_at = now()
        WHERE wep.id = v_active_period.id;
      ELSE
        -- No bloquear reincorporate_worker: cerrar el período previo usando el fin de asignación anterior y marcar para revisión
        SELECT max(wpa.end_date)
          INTO v_last_closed_assignment_end
        FROM public.worker_position_assignments wpa
        WHERE wpa.worker_id = NEW.worker_id
          AND (NEW.new_assignment_id IS NULL OR wpa.id <> NEW.new_assignment_id)
          AND wpa.end_date IS NOT NULL
          AND wpa.end_date <= NEW.effective_date;

        UPDATE public.worker_employment_periods wep
        SET
          separation_date = greatest(coalesce(v_last_closed_assignment_end, NEW.effective_date), wep.hire_date),
          reason_validation_status = 'PENDING_VALIDATION',
          inconsistency_code = 'REENTRY_WITHOUT_PRIOR_BAJA_MOVEMENT',
          inconsistency_details = 'Se registró una reincorporación sin movimiento de BAJA previo sincronizado; cerrado preventivamente para revisión.',
          status = 'CLOSED',
          updated_at = now()
        WHERE wep.id = v_active_period.id;
      END IF;
    END IF;

    -- Si la baja del período inmediatamente anterior fue "Fallecimiento", marcar contradicción material en ese período
    UPDATE public.worker_employment_periods wep
    SET
      reason_validation_status = 'PENDING_VALIDATION',
      inconsistency_code = 'CONTRADICTION_DECEASED_REINCORPORATED',
      inconsistency_details = 'Contradicción material: baja registrada como Fallecimiento seguida de reincorporación.',
      updated_at = now()
    WHERE wep.worker_id = NEW.worker_id
      AND wep.status = 'CLOSED'
      AND wep.separation_reason_catalog_snapshot = 'Fallecimiento';

    SELECT coalesce(max(wep.period_sequence), 0) + 1
      INTO v_next_seq
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.worker_id;

    SELECT s.position_name, s.area_name, s.occupational_category_name
      INTO v_pos, v_area, v_cat
    FROM public.get_worker_assignment_snapshot(NEW.worker_id, NEW.new_assignment_id) s;

    INSERT INTO public.worker_employment_periods (
      company_client_id,
      organization_entity_id,
      worker_id,
      period_sequence,
      origin_type,
      reincorporation_movement_id,
      hire_date,
      position_name_snapshot,
      area_name_snapshot,
      occupational_category_snapshot,
      status
    ) VALUES (
      v_worker.company_client_id,
      v_worker.organization_entity_id,
      v_worker.id,
      v_next_seq,
      'REINCORPORATION',
      NEW.id,
      NEW.effective_date,
      v_pos,
      v_area,
      v_cat,
      'ACTIVE'
    );

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.resolve_vacation_assignment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_vacation_assignment(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.worker_vacation_row_in_contract(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_vacation_row_in_contract(uuid, uuid, uuid) TO authenticated, service_role;

-- Adoptar vacaciones y movimientos históricos sin assignment_id cuando el trabajador tiene exactamente 1 asignación vigente (incluyendo end_date futura)
UPDATE public.worker_vacations v
SET assignment_id = a.id, updated_at = now()
FROM public.worker_position_assignments a
WHERE v.assignment_id IS NULL
  AND a.worker_id = v.worker_id
  AND a.is_current = true
  AND a.start_date <= public.cuba_current_date()
  AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
  AND (SELECT count(*)
       FROM public.worker_position_assignments a2
       WHERE a2.worker_id = v.worker_id
         AND a2.is_current = true
         AND a2.start_date <= public.cuba_current_date()
         AND (a2.end_date IS NULL OR a2.end_date >= public.cuba_current_date())) = 1;

UPDATE public.worker_vacation_movements m
SET assignment_id = a.id
FROM public.worker_position_assignments a
WHERE m.assignment_id IS NULL
  AND a.worker_id = m.worker_id
  AND a.is_current = true
  AND a.start_date <= public.cuba_current_date()
  AND (a.end_date IS NULL OR a.end_date >= public.cuba_current_date())
  AND (SELECT count(*)
       FROM public.worker_position_assignments a2
       WHERE a2.worker_id = m.worker_id
         AND a2.is_current = true
         AND a2.start_date <= public.cuba_current_date()
         AND (a2.end_date IS NULL OR a2.end_date >= public.cuba_current_date())) = 1;

-- =============================================================================
-- PARTE 2. TEST AUTOMÁTICO SIN AUTH.UID() PARA `resolve_vacation_assignment`
-- Verifica que una asignación vigente con `end_date > cuba_current_date()` es
-- devuelta por `resolve_vacation_assignment` y lanza `RAISE EXCEPTION` si devuelve NULL.
-- =============================================================================
DO $$
DECLARE
  v_today date := public.cuba_current_date();
  v_entity_id uuid;
  v_tenant_id uuid;
  v_position_id uuid;
  v_tmp_worker_id uuid := '99999999-4444-4444-8888-999999999904'::uuid;
  v_tmp_assignment_id uuid := '99999999-4444-4444-8888-999999999905'::uuid;
  v_resolved_id uuid;
BEGIN
  SELECT p.id, p.organization_entity_id, e.company_client_id
    INTO v_position_id, v_entity_id, v_tenant_id
  FROM public.organization_positions p
  JOIN public.organization_entities e ON e.id = p.organization_entity_id
  WHERE p.is_active = true
  LIMIT 1;

  IF v_position_id IS NULL THEN
    RAISE EXCEPTION 'QA-Round4f TEST FAILED: no existe ningún puesto activo para probar resolve_vacation_assignment';
  END IF;

  BEGIN
    INSERT INTO public.workers (
      id, company_client_id, organization_entity_id, code,
      first_name, first_surname, identification,
      hire_date, employment_start_date, employment_status
    ) VALUES (
      v_tmp_worker_id, v_tenant_id, v_entity_id, 'TRB-QA4F04',
      'Prueba', 'Vacaciones', '90010199904',
      v_today - 30, v_today - 30, 'active'
    );

    INSERT INTO public.worker_position_assignments (
      id, worker_id, position_id, start_date, end_date, is_current
    ) VALUES (
      v_tmp_assignment_id, v_tmp_worker_id, v_position_id,
      v_today - 30, v_today + 10, true
    );

    v_resolved_id := public.resolve_vacation_assignment(v_tmp_worker_id, NULL);
    IF v_resolved_id IS NULL OR v_resolved_id IS DISTINCT FROM v_tmp_assignment_id THEN
      RAISE EXCEPTION 'QA-Round4f TEST FAILED: resolve_vacation_assignment(worker, NULL) devolvió % en vez de % para asignación vigente con end_date futura',
        COALESCE(v_resolved_id::text, 'NULL'), v_tmp_assignment_id;
    END IF;

    v_resolved_id := public.resolve_vacation_assignment(v_tmp_worker_id, v_tmp_assignment_id);
    IF v_resolved_id IS NULL OR v_resolved_id IS DISTINCT FROM v_tmp_assignment_id THEN
      RAISE EXCEPTION 'QA-Round4f TEST FAILED: resolve_vacation_assignment(worker, assignment) devolvió % en vez de % para asignación vigente con end_date futura',
        COALESCE(v_resolved_id::text, 'NULL'), v_tmp_assignment_id;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'QA40F', MESSAGE = 'Rollback controlado tras verificar resolve_vacation_assignment';
  EXCEPTION
    WHEN SQLSTATE 'QA40F' THEN
      NULL;
  END;
END $$;

-- =============================================================================
-- PARTE 3. AUTORÍA EN `document_generation_jobs` (`requested_by`) Y TRIGGERS
-- =============================================================================

ALTER TABLE public.document_generation_jobs
  ADD COLUMN IF NOT EXISTS requested_by uuid;

-- Backfill de `requested_by` desde los documentos o registros origen
UPDATE public.document_generation_jobs j
SET requested_by = wd.uploaded_by
FROM public.worker_documents wd
WHERE j.worker_document_id = wd.id
  AND j.requested_by IS NULL
  AND wd.uploaded_by IS NOT NULL;

UPDATE public.document_generation_jobs j
SET requested_by = COALESCE(ca.formalized_by, ca.created_by)
FROM public.contract_addendums ca
WHERE j.kind = 'ADDENDUM'
  AND j.source_id = ca.id
  AND j.requested_by IS NULL
  AND COALESCE(ca.formalized_by, ca.created_by) IS NOT NULL;

UPDATE public.document_generation_jobs j
SET requested_by = wr.created_by
FROM public.worker_resolutions wr
WHERE j.kind = 'RESOLUTION'
  AND j.source_id = wr.id
  AND j.requested_by IS NULL
  AND wr.created_by IS NOT NULL;

UPDATE public.document_generation_jobs j
SET requested_by = wpm.created_by
FROM public.worker_payroll_movements wpm
WHERE j.kind = 'PAYROLL_MOVEMENT'
  AND j.source_id = wpm.id
  AND j.requested_by IS NULL
  AND wpm.created_by IS NOT NULL;

UPDATE public.document_generation_jobs j
SET requested_by = wv.created_by
FROM public.worker_vacations wv
WHERE j.kind = 'VACATION'
  AND j.source_id = wv.id
  AND j.requested_by IS NULL
  AND wv.created_by IS NOT NULL;

UPDATE public.document_generation_jobs j
SET requested_by = wmc.created_by
FROM public.worker_medical_certificates wmc
WHERE j.kind = 'MEDICAL_CERTIFICATE'
  AND j.source_id = wmc.id
  AND j.requested_by IS NULL
  AND wmc.created_by IS NOT NULL;

-- Limpiar sobrecargas previas de `enqueue_document_generation_job`
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enqueue_document_generation_job'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_document_generation_job(
  p_kind text,
  p_source_id uuid,
  p_force_retry boolean DEFAULT false,
  p_requested_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_clean_kind text := upper(btrim(COALESCE(p_kind, '')));
  v_ctx record;
  v_actor uuid := COALESCE(p_requested_by, auth.uid());
  v_job public.document_generation_jobs%ROWTYPE;
BEGIN
  IF v_clean_kind NOT IN (
    'CONTRACT',
    'ADDENDUM',
    'RESOLUTION',
    'PAYROLL_MOVEMENT',
    'VACATION',
    'MEDICAL_CERTIFICATE'
  ) THEN
    RAISE EXCEPTION 'Tipo de trabajo documental no válido: %', p_kind;
  END IF;

  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'El identificador de origen (source_id) es obligatorio';
  END IF;

  SELECT * INTO v_ctx
  FROM public.resolve_document_job_context(v_clean_kind, p_source_id);

  IF v_ctx.organization_entity_id IS NULL THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'SOURCE_NOT_FOUND');
  END IF;

  IF v_ctx.skip_generation THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'SKIPPED_BY_RULE');
  END IF;

  IF v_actor IS NULL THEN
    IF v_clean_kind = 'ADDENDUM' THEN
      SELECT COALESCE(ca.formalized_by, ca.created_by) INTO v_actor
      FROM public.contract_addendums ca WHERE ca.id = p_source_id;
    ELSIF v_clean_kind = 'RESOLUTION' THEN
      SELECT wr.created_by INTO v_actor
      FROM public.worker_resolutions wr WHERE wr.id = p_source_id;
    ELSIF v_clean_kind = 'PAYROLL_MOVEMENT' THEN
      SELECT wpm.created_by INTO v_actor
      FROM public.worker_payroll_movements wpm WHERE wpm.id = p_source_id;
    ELSIF v_clean_kind = 'VACATION' THEN
      SELECT wv.created_by INTO v_actor
      FROM public.worker_vacations wv WHERE wv.id = p_source_id;
    ELSIF v_clean_kind = 'MEDICAL_CERTIFICATE' THEN
      SELECT wmc.created_by INTO v_actor
      FROM public.worker_medical_certificates wmc WHERE wmc.id = p_source_id;
    END IF;
  END IF;

  IF v_ctx.completed_worker_document_id IS NOT NULL AND NOT COALESCE(p_force_retry, false) THEN
    INSERT INTO public.document_generation_jobs (
      organization_entity_id,
      worker_id,
      kind,
      source_id,
      status,
      attempts,
      last_error,
      next_attempt_at,
      worker_document_id,
      requested_by,
      updated_at
    ) VALUES (
      v_ctx.organization_entity_id,
      v_ctx.worker_id,
      v_clean_kind,
      p_source_id,
      'GENERADO',
      0,
      NULL,
      now(),
      v_ctx.completed_worker_document_id,
      v_actor,
      now()
    )
    ON CONFLICT (kind, source_id) DO UPDATE
      SET status = 'GENERADO',
          worker_document_id = EXCLUDED.worker_document_id,
          requested_by = COALESCE(EXCLUDED.requested_by, public.document_generation_jobs.requested_by),
          last_error = NULL,
          updated_at = now()
    RETURNING * INTO v_job;

    RETURN jsonb_build_object(
      'enqueued', false,
      'job_id', v_job.id,
      'status', v_job.status,
      'worker_document_id', v_job.worker_document_id
    );
  END IF;

  INSERT INTO public.document_generation_jobs (
    organization_entity_id,
    worker_id,
    kind,
    source_id,
    status,
    attempts,
    last_error,
    next_attempt_at,
    worker_document_id,
    requested_by,
    updated_at
  ) VALUES (
    v_ctx.organization_entity_id,
    v_ctx.worker_id,
    v_clean_kind,
    p_source_id,
    'PENDIENTE',
    0,
    NULL,
    now(),
    v_ctx.completed_worker_document_id,
    v_actor,
    now()
  )
  ON CONFLICT (kind, source_id) DO UPDATE
    SET status = CASE
          WHEN COALESCE(p_force_retry, false) THEN 'PENDIENTE'
          WHEN public.document_generation_jobs.status = 'GENERADO' THEN 'GENERADO'
          ELSE 'PENDIENTE'
        END,
        attempts = CASE
          WHEN COALESCE(p_force_retry, false) THEN 0
          ELSE public.document_generation_jobs.attempts
        END,
        last_error = CASE
          WHEN COALESCE(p_force_retry, false) THEN NULL
          ELSE public.document_generation_jobs.last_error
        END,
        next_attempt_at = CASE
          WHEN COALESCE(p_force_retry, false) THEN now()
          ELSE LEAST(public.document_generation_jobs.next_attempt_at, now())
        END,
        organization_entity_id = EXCLUDED.organization_entity_id,
        worker_id = EXCLUDED.worker_id,
        requested_by = COALESCE(EXCLUDED.requested_by, public.document_generation_jobs.requested_by),
        updated_at = now()
  RETURNING * INTO v_job;

  IF v_clean_kind = 'CONTRACT' AND v_job.status = 'PENDIENTE' THEN
    UPDATE public.employment_contracts
    SET document_status = 'PENDIENTE',
        document_error = NULL,
        document_status_updated_at = now()
    WHERE id = p_source_id;
  END IF;

  IF v_job.status = 'PENDIENTE' THEN
    PERFORM public.notify_process_document_jobs(v_job.id);
  END IF;

  RETURN jsonb_build_object(
    'enqueued', (v_job.status = 'PENDIENTE'),
    'job_id', v_job.id,
    'status', v_job.status,
    'worker_document_id', v_job.worker_document_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_document_generation_job(text, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_document_generation_job(text, uuid, boolean, uuid) TO authenticated, service_role;


-- Asegurar columnas en worker_documents antes del trigger trg_fn_sync_contract_document_status
ALTER TABLE public.worker_documents
  ADD COLUMN IF NOT EXISTS organization_entity_id uuid,
  ADD COLUMN IF NOT EXISTS generation_error text;

-- Actualizar `trg_fn_sync_contract_document_status` para resolver `v_entity_id` desde `workers` si `NEW.organization_entity_id` es NULL y propagar `requested_by`
CREATE OR REPLACE FUNCTION public.trg_fn_sync_contract_document_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_kind text := NULL;
  v_source_id uuid := NULL;
  v_entity_id uuid := NEW.organization_entity_id;
  v_actor uuid := COALESCE(NEW.uploaded_by, auth.uid());
BEGIN
  IF v_entity_id IS NULL AND NEW.worker_id IS NOT NULL THEN
    SELECT w.organization_entity_id INTO v_entity_id
    FROM public.workers w
    WHERE w.id = NEW.worker_id;
  END IF;

  IF NEW.employment_contract_id IS NOT NULL THEN
    v_kind := 'CONTRACT';
    v_source_id := NEW.employment_contract_id;
    IF COALESCE(NEW.generation_status, 'COMPLETED') = 'COMPLETED' AND NEW.storage_path IS NOT NULL AND NEW.storage_path <> 'pending' THEN
      UPDATE public.employment_contracts
      SET document_status = 'GENERADO',
          document_error = NULL,
          document_status_updated_at = now()
      WHERE id = NEW.employment_contract_id;
    ELSIF NEW.generation_status = 'FAILED' THEN
      UPDATE public.employment_contracts
      SET document_status = 'ERROR',
          document_error = COALESCE(NEW.generation_error, 'No se pudo completar la generación del documento.'),
          document_status_updated_at = now()
      WHERE id = NEW.employment_contract_id
        AND document_status <> 'GENERADO';
    END IF;
  ELSIF NEW.contract_addendum_id IS NOT NULL THEN
    v_kind := 'ADDENDUM';
    v_source_id := NEW.contract_addendum_id;
  ELSIF NEW.document_source_id IS NOT NULL
        AND NEW.document_source_type IN ('RESOLUTION', 'PAYROLL_MOVEMENT', 'VACATION', 'MEDICAL_CERTIFICATE') THEN
    v_kind := NEW.document_source_type;
    v_source_id := NEW.document_source_id;
  END IF;

  IF v_kind IS NOT NULL AND v_source_id IS NOT NULL AND v_entity_id IS NOT NULL THEN
    IF COALESCE(NEW.generation_status, 'COMPLETED') = 'COMPLETED' AND NEW.storage_path IS NOT NULL AND NEW.storage_path <> 'pending' THEN
      INSERT INTO public.document_generation_jobs (
        organization_entity_id,
        worker_id,
        kind,
        source_id,
        status,
        attempts,
        last_error,
        next_attempt_at,
        worker_document_id,
        requested_by,
        updated_at
      ) VALUES (
        v_entity_id,
        NEW.worker_id,
        v_kind,
        v_source_id,
        'GENERADO',
        0,
        NULL,
        now(),
        NEW.id,
        v_actor,
        now()
      )
      ON CONFLICT (kind, source_id) DO UPDATE
        SET status = 'GENERADO',
            worker_document_id = NEW.id,
            requested_by = COALESCE(EXCLUDED.requested_by, public.document_generation_jobs.requested_by),
            last_error = NULL,
            updated_at = now();
    ELSIF NEW.generation_status = 'FAILED' THEN
      UPDATE public.document_generation_jobs
      SET status = CASE
            WHEN COALESCE(NEW.generation_error, '') ILIKE '%plantilla%' THEN 'SIN_PLANTILLA'
            ELSE 'ERROR'
          END,
          last_error = COALESCE(NEW.generation_error, 'Error al generar el documento.'),
          attempts = attempts + 1,
          next_attempt_at = now() + interval '1 minute',
          requested_by = COALESCE(requested_by, v_actor),
          updated_at = now()
      WHERE kind = v_kind
        AND source_id = v_source_id
        AND status <> 'GENERADO';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Actualizar las 6 funciones trigger de encolado para pasar `auth.uid()` / autoría a `enqueue_document_generation_job`
CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_contract_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NEW.signature_date IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.signature_date IS NULL) THEN
    PERFORM public.enqueue_document_generation_job('CONTRACT', NEW.id, false, auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_addendum_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NEW.status = 'FORMALIZED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'FORMALIZED') THEN
    PERFORM public.enqueue_document_generation_job(
      'ADDENDUM',
      NEW.id,
      false,
      COALESCE(auth.uid(), NEW.formalized_by, NEW.created_by)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_resolution_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job(
    'RESOLUTION',
    NEW.id,
    false,
    COALESCE(auth.uid(), NEW.created_by)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_payroll_movement_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job(
    'PAYROLL_MOVEMENT',
    NEW.id,
    false,
    COALESCE(auth.uid(), NEW.created_by)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_vacation_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF COALESCE(NEW.status, '') <> 'CANCELLED' THEN
    PERFORM public.enqueue_document_generation_job(
      'VACATION',
      NEW.id,
      false,
      COALESCE(auth.uid(), NEW.created_by)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_medical_certificate_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job(
    'MEDICAL_CERTIFICATE',
    NEW.id,
    false,
    COALESCE(auth.uid(), NEW.created_by)
  );
  RETURN NEW;
END;
$function$;

-- Recompilar `claim_due_document_generation_jobs` con la nueva columna `requested_by` en el tipo compuesto
CREATE OR REPLACE FUNCTION public.claim_due_document_generation_jobs(
  p_limit integer DEFAULT 10,
  p_source_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL
)
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_clean_kind text := NULLIF(upper(btrim(COALESCE(p_kind, ''))), '');
BEGIN
  UPDATE public.document_generation_jobs
  SET status = 'ERROR',
      last_error = COALESCE(last_error, 'Tiempo de espera agotado durante la generación; reintentando.'),
      next_attempt_at = now(),
      updated_at = now()
  WHERE status = 'GENERANDO'
    AND updated_at < now() - interval '3 minutes';

  RETURN QUERY
  WITH due AS (
    SELECT j.id
    FROM public.document_generation_jobs j
    WHERE (
        (p_source_id IS NOT NULL AND j.source_id = p_source_id AND (v_clean_kind IS NULL OR j.kind = v_clean_kind) AND j.status <> 'GENERADO')
        OR (
          p_source_id IS NULL
          AND (v_clean_kind IS NULL OR j.kind = v_clean_kind)
          AND j.status IN ('PENDIENTE', 'ERROR')
          AND j.attempts < 5
          AND j.next_attempt_at <= now()
        )
      )
    ORDER BY
      CASE WHEN j.status = 'PENDIENTE' THEN 0 ELSE 1 END ASC,
      j.next_attempt_at ASC,
      j.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.document_generation_jobs target
  SET status = 'GENERANDO',
      updated_at = now()
  FROM due
  WHERE target.id = due.id
  RETURNING target.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_due_document_generation_jobs(integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_due_document_generation_jobs(integer, uuid, text) TO authenticated, service_role;

-- =============================================================================
-- PARTE 4. FUNCIONES DOCUMENTALES DESDE pg_get_functiondef + SOPORTE service_role
--          + PROPAGACIÓN DE p_actor_user_id + REVOKE DE anon
-- =============================================================================

-- Compatibilidad retroactiva para `worker_medical_certificates`
ALTER TABLE public.worker_medical_certificates
  ADD COLUMN IF NOT EXISTS certificate_number text,
  ADD COLUMN IF NOT EXISTS diagnosis text,
  ADD COLUMN IF NOT EXISTS issued_at date;

-- Limpiar sobrecargas previas de las funciones documentales que reciben p_actor_user_id DEFAULT NULL
DROP FUNCTION IF EXISTS public.begin_document_generation(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.begin_resolution_generation(uuid, uuid);
DROP FUNCTION IF EXISTS public.begin_payroll_movement_generation(uuid, uuid);
DROP FUNCTION IF EXISTS public.begin_sc404_generation(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.complete_document_generation(uuid, text, bigint, text);

-- 4.1 public.get_contract_document_data
CREATE OR REPLACE FUNCTION public.get_contract_document_data(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_contract public.employment_contracts%ROWTYPE;
  v_type public.employment_contract_types%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_formalized jsonb;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_contract FROM public.employment_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado';
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (public.can_access_entity(v_contract.organization_entity_id, 'workers.view')
              OR public.can_access_entity(v_contract.organization_entity_id, 'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este contrato';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_contract.worker_id;
  SELECT * INTO v_type FROM public.employment_contract_types WHERE id = v_contract.contract_type_id;

  v_formalized := public.contract_formalized_conditions(p_contract_id);

  RETURN jsonb_build_object(
    'document_type', 'CONTRACT',
    'contract_id', p_contract_id,
    'contract_type_code', v_type.code,
    'contract_type_name', v_type.name,
    'entity', jsonb_build_object(
      'name', v_contract.entity_name_snapshot,
      'organism', v_contract.entity_organism_snapshot,
      'branch', v_contract.entity_branch_snapshot,
      'labor_code', v_contract.entity_labor_code_snapshot,
      'address', v_contract.entity_address_snapshot,
      'province', v_contract.entity_province_snapshot,
      'municipality', v_contract.entity_municipality_snapshot,
      'revolution_year', v_contract.revolution_year_snapshot
    ),
    'representative', jsonb_build_object(
      'name', v_contract.representative_name_snapshot,
      'position', v_contract.representative_position_snapshot
    ),
    'worker', jsonb_build_object(
      'full_name', nullif(btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname)), ''),
      'identification', nullif(btrim(coalesce(v_worker.identification, '')), ''),
      'birth_date', v_worker.birth_date,
      'profession', COALESCE(nullif(btrim(coalesce(v_contract.profession_or_trade_snapshot, '')), ''),
                             nullif(btrim(coalesce(v_worker.profession_or_trade, '')), '')),
      'address', nullif(btrim(coalesce(v_worker.address, '')), ''),
      'province', nullif(btrim(coalesce(v_worker.province, '')), ''),
      'municipality', nullif(btrim(coalesce(v_worker.municipality, '')), '')
    ),
    'job', jsonb_build_object(
      'name', v_formalized->'job_name',
      'occupational_category', v_formalized->'occupational_category',
      'salary_group_sequence', v_formalized->'salary_group_sequence'
    ),
    'position', jsonb_build_object(
      'name', v_formalized->'position_name',
      'code', v_formalized->'position_code',
      'work_location', v_formalized->'work_location'
    ),
    'schedule', jsonb_build_object(
      'daily_hours', v_formalized->'daily_hours',
      'weekly_hours', v_formalized->'weekly_hours',
      'monthly_hours', v_formalized->'monthly_hours',
      'break_minutes', v_formalized->'break_minutes',
      'text', COALESCE(v_formalized->'work_schedule', v_formalized->'jornada')
    ),
    'contract', jsonb_build_object(
      'type_name', v_type.name,
      'type_code', v_type.code,
      'start_date', v_contract.start_date,
      'end_date', v_contract.end_date,
      'signature_date', v_contract.signature_date,
      'signature_place', v_contract.signature_place,
      'payment_method', v_formalized->'payment_method_name',
      'payment_schedule', to_jsonb(COALESCE(nullif(btrim(v_formalized->>'payment_schedule'), ''), 'Mensual'))
    ),
    'compensation', jsonb_build_object(
      'base_salary', v_formalized->'salary_amount',
      'additional_payments', to_jsonb(COALESCE(nullif(btrim(v_formalized->>'additional_payment'), ''), 'No aplica')),
      'abnormal_conditions_payments', to_jsonb(COALESCE(nullif(btrim(v_formalized->>'abnormal_conditions'), ''), 'No aplica')),
      'other_payments', to_jsonb(COALESCE(nullif(btrim(v_formalized->>'other_payment'), ''), 'No aplica')),
      'total', v_formalized->'total_compensation',
      'currency', v_formalized->'currency_code'
    ),
    'formalized_addendums', COALESCE(v_formalized->'applied_addendums', '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contract_document_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contract_document_data(uuid) TO authenticated, service_role;

-- 4.2 public.get_addendum_document_data
CREATE OR REPLACE FUNCTION public.get_addendum_document_data(p_addendum_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_addendum public.contract_addendums%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_previous jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_row record;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_addendum FROM public.contract_addendums WHERE id = p_addendum_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anexo no encontrado';
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (public.can_access_entity(v_addendum.organization_entity_id, 'workers.view')
              OR public.can_access_entity(v_addendum.organization_entity_id, 'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este anexo';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_addendum.worker_id;

  FOR v_row IN
    SELECT c.field_code,
           c.old_value, c.old_display_value,
           c.new_value, c.new_display_value,
           c.display_order
    FROM public.employment_contract_addendum_changes c
    WHERE c.addendum_id = p_addendum_id
    ORDER BY c.display_order
  LOOP
    v_previous := v_previous || jsonb_build_object(
      v_row.field_code,
      jsonb_build_object('value', v_row.old_value, 'display', v_row.old_display_value)
    );
    v_new := v_new || jsonb_build_object(
      v_row.field_code,
      jsonb_build_object('value', v_row.new_value, 'display', v_row.new_display_value)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'document_type', 'ADDENDUM',
    'addendum_id', p_addendum_id,
    'addendum', jsonb_build_object(
      'number', v_addendum.addendum_number,
      'reason_code', v_addendum.reason_code,
      'reason', v_addendum.reason,
      'effective_date', v_addendum.effective_date,
      'signature_date', v_addendum.signature_date,
      'signature_place', v_addendum.signature_place,
      'status', v_addendum.status
    ),
    'entity', jsonb_build_object(
      'name', v_addendum.entity_name_snapshot,
      'organism', v_addendum.entity_organism_snapshot,
      'branch', v_addendum.entity_branch_snapshot,
      'labor_code', v_addendum.entity_labor_code_snapshot,
      'address', v_addendum.entity_address_snapshot,
      'province', v_addendum.entity_province_snapshot,
      'municipality', v_addendum.entity_municipality_snapshot,
      'revolution_year', v_addendum.entity_revolution_year_snapshot
    ),
    'representative', jsonb_build_object(
      'name', v_addendum.representative_name_snapshot,
      'position', v_addendum.representative_position_snapshot
    ),
    'worker', jsonb_build_object(
      'full_name', COALESCE(nullif(btrim(coalesce(v_addendum.worker_name_snapshot, '')), ''),
                            nullif(btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname)), '')),
      'identification', COALESCE(nullif(btrim(coalesce(v_addendum.worker_identification_snapshot, '')), ''),
                                 nullif(btrim(coalesce(v_worker.identification, '')), '')),
      'birth_date', v_worker.birth_date,
      'profession', COALESCE(nullif(btrim(coalesce(v_addendum.worker_profession_snapshot, '')), ''),
                             nullif(btrim(coalesce(v_worker.profession_or_trade, '')), '')),
      'address', nullif(btrim(coalesce(v_worker.address, '')), ''),
      'province', nullif(btrim(coalesce(v_worker.province, '')), ''),
      'municipality', nullif(btrim(coalesce(v_worker.municipality, '')), '')
    ),
    'previous_conditions', v_previous,
    'new_conditions', v_new,
    'totals', jsonb_build_object(
      'before', v_addendum.total_before,
      'after', v_addendum.total_after,
      'currency', v_addendum.currency_code
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_addendum_document_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_addendum_document_data(uuid) TO authenticated, service_role;

-- 4.3 public.get_resolution_document_data
CREATE OR REPLACE FUNCTION public.get_resolution_document_data(p_resolution_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v public.worker_resolutions%rowtype;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v from public.worker_resolutions where id = p_resolution_id;
  if not found then
    raise exception 'Resolución no encontrada';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.can_access_entity(v.organization_entity_id, 'workers.view')
              or public.can_access_entity(v.organization_entity_id, 'workers.manage')) then
    raise exception 'No tiene permiso para consultar esta Resolución';
  end if;

  return jsonb_build_object(
    'document_type', 'RESOLUTION',
    'resolution_id', v.id,
    'entity', jsonb_build_object(
      'name', v.entity_name_snapshot,
      'municipality', v.municipality_snapshot,
      'revolution_year', v.revolution_year_snapshot
    ),
    'parent_company', jsonb_build_object('name', v.parent_company_name_snapshot),
    'representative', jsonb_build_object(
      'name', v.representative_name_snapshot,
      'position', v.representative_position_snapshot
    ),
    'worker', jsonb_build_object(
      'full_name', v.worker_name_snapshot,
      'identification', v.worker_identification_snapshot
    ),
    'job', jsonb_build_object(
      'name', v.job_name_snapshot,
      'salary_group_sequence', v.salary_group_sequence_snapshot,
      'salary_amount', v.salary_amount_snapshot,
      'currency_code', v.salary_currency_snapshot,
      'work_content', v.work_content_snapshot
    ),
    'resolution', jsonb_build_object('date', v.resolution_date)
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_resolution_document_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resolution_document_data(uuid) TO authenticated, service_role;

-- 4.4 public.get_payroll_movement_document_data
CREATE OR REPLACE FUNCTION public.get_payroll_movement_document_data(p_movement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v public.worker_payroll_movements%rowtype;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v from public.worker_payroll_movements where id = p_movement_id;
  if not found then raise exception 'Movimiento de Nómina no encontrado'; end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.can_access_entity(v.organization_entity_id, 'workers.view')
              or public.can_access_entity(v.organization_entity_id, 'workers.manage')) then
    raise exception 'No tiene permiso para consultar este Movimiento de Nómina';
  end if;

  return jsonb_build_object(
    'document_type', 'PAYROLL_MOVEMENT',
    'movement_id', v.id,
    'event_type', v.event_type,
    'effective_date', v.effective_date,
    'entity', jsonb_build_object(
      'organism', v.organism_snapshot,
      'company', v.company_snapshot,
      'unit', v.unit_snapshot
    ),
    'worker', jsonb_build_object(
      'full_name', v.worker_name_snapshot,
      'first_name', v.first_name_snapshot,
      'first_surname', v.first_surname_snapshot,
      'second_surname', v.second_surname_snapshot,
      'identification', v.identification_snapshot,
      'gender_code', v.gender_code_snapshot
    ),
    'actual', jsonb_build_object(
      'area', v.area_act_snapshot,
      'job', v.cargo_act_snapshot,
      'salary_group_sequence', v.ge_act_sequence,
      'salary_amount', v.sal_act_snapshot,
      'currency', v.currency_snapshot
    ),
    'next', jsonb_build_object(
      'area', v.area_nva_snapshot,
      'job', v.cargo_nva_snapshot,
      'salary_group_sequence', v.ge_nva_sequence,
      'salary_amount', v.sal_nva_snapshot,
      'currency', v.currency_snapshot
    )
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_payroll_movement_document_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_movement_document_data(uuid) TO authenticated, service_role;

-- 4.5 public.validate_contract_document_data
CREATE OR REPLACE FUNCTION public.validate_contract_document_data(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_data jsonb;
  v_type_code text;
  v_missing jsonb := '[]'::jsonb;
  v_auth_entity uuid;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT c.organization_entity_id INTO v_auth_entity
  FROM public.employment_contracts c WHERE c.id = p_contract_id;

  IF coalesce(auth.role(), '') <> 'service_role'
     AND v_auth_entity IS NOT NULL
     AND NOT (public.can_access_entity(v_auth_entity, NULL)
              OR public.has_platform_permission('salary.manage')) THEN
    RAISE EXCEPTION 'Permiso denegado: sin autoridad sobre el contrato';
  END IF;

  v_data := public.get_contract_document_data(p_contract_id);
  v_type_code := v_data->'contract'->>'type_code';

  IF nullif(btrim(coalesce(v_data->'representative'->>'name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'representative.name', 'label', 'Representante de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'representative'->>'position', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'representative.position', 'label', 'Cargo del representante');
  END IF;

  IF nullif(btrim(coalesce(v_data->'entity'->>'name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.name', 'label', 'Nombre de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'organism', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.organism', 'label', 'Organismo al que pertenece');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'address', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.address', 'label', 'Dirección de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'province', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.province', 'label', 'Provincia de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'municipality', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.municipality', 'label', 'Municipio de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'branch', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.branch', 'label', 'Rama');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'labor_code', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.labor_code', 'label', 'Código de identificación laboral');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'revolution_year', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.revolution_year', 'label', 'Año de la Revolución');
  END IF;

  IF nullif(btrim(coalesce(v_data->'worker'->>'full_name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.full_name', 'label', 'Nombre del trabajador');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'identification', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.identification', 'label', 'Carné de identidad');
  END IF;
  IF (v_data->'worker'->>'birth_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.birth_date', 'label', 'Fecha de nacimiento');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'profession', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.profession', 'label', 'Profesión u oficio');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'address', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.address', 'label', 'Dirección del trabajador');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'province', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.province', 'label', 'Provincia del trabajador');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'municipality', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.municipality', 'label', 'Municipio del trabajador');
  END IF;

  IF nullif(btrim(coalesce(v_data->'job'->>'name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'job.name', 'label', 'Cargo');
  END IF;
  IF (v_data->'job'->>'salary_group_sequence') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'job.salary_group', 'label', 'Grupo salarial');
  END IF;
  IF nullif(btrim(coalesce(v_data->'job'->>'occupational_category', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'job.occupational_category', 'label', 'Categoría ocupacional');
  END IF;
  IF nullif(btrim(coalesce(v_data->'position'->>'name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'position.name', 'label', 'Puesto de trabajo');
  END IF;
  IF nullif(btrim(coalesce(v_data->'position'->>'work_location', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'position.work_location', 'label', 'Lugar de trabajo');
  END IF;

  IF (v_data->'compensation'->>'base_salary') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'compensation.base_salary', 'label', 'Salario');
  END IF;
  IF nullif(btrim(coalesce(v_data->'contract'->>'payment_method', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'contract.payment_method', 'label', 'Forma de pago');
  END IF;
  IF nullif(btrim(coalesce(v_data->'contract'->>'payment_schedule', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'contract.payment_schedule', 'label', 'Día / momento de pago');
  END IF;

  IF (v_data->'contract'->>'start_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'contract.start_date', 'label', 'Fecha de inicio');
  END IF;
  IF nullif(btrim(coalesce(v_data->'contract'->>'signature_place', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'contract.signature_place', 'label', 'Lugar de firma');
  END IF;
  IF (v_data->'contract'->>'signature_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'contract.signature_date', 'label', 'Fecha de firma');
  END IF;

  IF v_type_code = 'DETERMINADO' THEN
    IF (v_data->'contract'->>'end_date') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'contract.end_date', 'label', 'Fecha de fin (contrato determinado)');
    END IF;
  ELSIF v_type_code = 'INDETERMINADO' THEN
    IF (v_data->'schedule'->>'daily_hours') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'schedule.daily_hours', 'label', 'Horas diarias');
    END IF;
    IF (v_data->'schedule'->>'weekly_hours') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'schedule.weekly_hours', 'label', 'Horas semanales');
    END IF;
    IF (v_data->'schedule'->>'monthly_hours') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'schedule.monthly_hours', 'label', 'Horas mensuales');
    END IF;
    IF nullif(btrim(coalesce(v_data->'schedule'->>'text', '')), '') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'schedule.text', 'label', 'Horario');
    END IF;
    IF (v_data->'schedule'->>'break_minutes') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'schedule.break', 'label', 'Descanso');
    END IF;
    IF (v_data->'compensation'->>'total') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'compensation.total', 'label', 'Total contractual');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'document_type', 'CONTRACT',
    'contract_type_code', v_type_code,
    'ready', jsonb_array_length(v_missing) = 0,
    'missing', v_missing
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.validate_contract_document_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_contract_document_data(uuid) TO authenticated, service_role;

-- 4.6 public.validate_addendum_document_data
CREATE OR REPLACE FUNCTION public.validate_addendum_document_data(p_addendum_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_data jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_field text;
  v_codes text[] := ARRAY['JOB','SALARY_GROUP','OCCUPATIONAL_CATEGORY','SALARY','OTHER_PAYMENT','TOTAL_COMPENSATION'];
  v_labels jsonb := '{"JOB":"Cargo","SALARY_GROUP":"Grupo salarial","OCCUPATIONAL_CATEGORY":"Categoría ocupacional","SALARY":"Salario","OTHER_PAYMENT":"Otros pagos","TOTAL_COMPENSATION":"Total"}'::jsonb;
  v_auth_entity uuid;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT organization_entity_id INTO v_auth_entity
  FROM public.contract_addendums
  WHERE id = p_addendum_id;

  IF coalesce(auth.role(), '') <> 'service_role'
     AND v_auth_entity IS NOT NULL
     AND NOT (public.can_access_entity(v_auth_entity, NULL) OR public.has_platform_permission('salary.manage')) THEN
    RAISE EXCEPTION 'Permiso denegado: sin autoridad sobre la entidad del anexo';
  END IF;

  v_data := public.get_addendum_document_data(p_addendum_id);

  IF (v_data->'addendum'->>'number') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'addendum.number', 'label', 'Número de anexo');
  END IF;
  IF nullif(btrim(coalesce(v_data->'addendum'->>'reason', '') || coalesce(v_data->'addendum'->>'reason_code', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'addendum.reason', 'label', 'Motivo del anexo');
  END IF;
  IF (v_data->'addendum'->>'effective_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'addendum.effective_date', 'label', 'Fecha efectiva');
  END IF;
  IF (v_data->'addendum'->>'signature_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'addendum.signature_date', 'label', 'Fecha de firma');
  END IF;
  IF nullif(btrim(coalesce(v_data->'addendum'->>'signature_place', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'addendum.signature_place', 'label', 'Lugar de firma');
  END IF;

  IF nullif(btrim(coalesce(v_data->'representative'->>'name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'representative.name', 'label', 'Representante de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'representative'->>'position', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'representative.position', 'label', 'Cargo del representante');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.name', 'label', 'Nombre de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'address', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.address', 'label', 'Dirección de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'province', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.province', 'label', 'Provincia de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'municipality', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.municipality', 'label', 'Municipio de la entidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'entity'->>'revolution_year', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'entity.revolution_year', 'label', 'Año de la Revolución');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'full_name', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.full_name', 'label', 'Nombre del trabajador');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'identification', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.identification', 'label', 'Carné de identidad');
  END IF;
  IF nullif(btrim(coalesce(v_data->'worker'->>'profession', '')), '') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('key', 'worker.profession', 'label', 'Profesión u oficio');
  END IF;

  FOREACH v_field IN ARRAY v_codes LOOP
    CONTINUE WHEN NOT (v_data->'new_conditions' ? v_field);

    IF v_data->'previous_conditions' ? v_field THEN
      IF nullif(btrim(coalesce(v_data->'previous_conditions'->v_field->>'display', v_data->'previous_conditions'->v_field->>'value', '')), '') IS NULL THEN
        v_missing := v_missing || jsonb_build_object('key', 'addendum.previous.' || lower(v_field), 'label', COALESCE(v_labels->>v_field, v_field) || ' anterior');
      END IF;
    END IF;

    IF nullif(btrim(coalesce(v_data->'new_conditions'->v_field->>'display', v_data->'new_conditions'->v_field->>'value', '')), '') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('key', 'addendum.new.' || lower(v_field), 'label', COALESCE(v_labels->>v_field, v_field) || ' nuevo');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('document_type', 'ADDENDUM', 'addendum_status', v_data->'addendum'->>'status', 'ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.validate_addendum_document_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_addendum_document_data(uuid) TO authenticated, service_role;

-- 4.7 public.resolve_document_template_version
CREATE OR REPLACE FUNCTION public.resolve_document_template_version(p_entity_id uuid, p_document_type_code text, p_reference_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_type text := nullif(btrim(coalesce(p_document_type_code, '')), '');
  v_date date := coalesce(p_reference_date, public.cuba_current_date());
  v_total integer := 0;
  v_top record;
  v_second record;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  if v_type is null then
    raise exception 'El tipo documental es obligatorio';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' and not (
    public.can_access_entity(p_entity_id, 'workers.view')
    or public.can_access_entity(p_entity_id, 'workers.manage')
    or public.can_access_entity(p_entity_id, 'organization.view')
    or public.can_access_entity(p_entity_id, 'organization.manage')
    or public.can_access_entity(p_entity_id, 'vacations.view')
    or public.can_access_entity(p_entity_id, 'vacations.manage')
    or public.can_access_entity(p_entity_id, 'medical_certificates.view')
    or public.can_access_entity(p_entity_id, 'medical_certificates.manage')
  ) then
    raise exception 'No tiene permiso para consultar las plantillas de esta entidad';
  end if;

  select count(*) into v_total
  from public.document_template_versions v
  where v.organization_entity_id = p_entity_id
    and v.document_type_code = v_type
    and v.status <> 'DRAFT'
    and v.effective_from is not null
    and v.effective_from <= v_date
    and (v.effective_to is null or v.effective_to >= v_date)
    and (v_type <> 'PAYROLL_MOVEMENT' or v.configured_file_format = 'XLSX');

  if v_total = 0 then
    return jsonb_build_object('status', 'NONE', 'document_type_code', v_type, 'reference_date', v_date);
  end if;

  select v.id, v.version_number, v.status, v.effective_from, v.effective_to,
         (v.status = 'ACTIVE') as is_active, v.configured_file_path, v.configured_file_format,
         t.name as template_name
  into v_top
  from public.document_template_versions v
  join public.document_templates t on t.id = v.template_id
  where v.organization_entity_id = p_entity_id
    and v.document_type_code = v_type
    and v.status <> 'DRAFT'
    and v.effective_from is not null
    and v.effective_from <= v_date
    and (v.effective_to is null or v.effective_to >= v_date)
    and (v_type <> 'PAYROLL_MOVEMENT' or v.configured_file_format = 'XLSX')
  order by v.effective_from desc, (v.status = 'ACTIVE') desc, v.version_number desc
  limit 1;

  select v.id, v.status, v.effective_from
  into v_second
  from public.document_template_versions v
  where v.organization_entity_id = p_entity_id
    and v.document_type_code = v_type
    and v.status <> 'DRAFT'
    and v.effective_from is not null
    and v.effective_from <= v_date
    and (v.effective_to is null or v.effective_to >= v_date)
    and (v_type <> 'PAYROLL_MOVEMENT' or v.configured_file_format = 'XLSX')
  order by v.effective_from desc, (v.status = 'ACTIVE') desc, v.version_number desc
  offset 1 limit 1;

  if v_second.id is not null
     and v_second.effective_from = v_top.effective_from
     and v_second.status = v_top.status then
    return jsonb_build_object('status', 'AMBIGUOUS', 'document_type_code', v_type, 'reference_date', v_date);
  end if;

  return jsonb_build_object(
    'status', 'RESOLVED',
    'document_type_code', v_type,
    'reference_date', v_date,
    'version_id', v_top.id,
    'version_number', v_top.version_number,
    'version_status', v_top.status,
    'template_name', v_top.template_name,
    'effective_from', v_top.effective_from,
    'effective_to', v_top.effective_to,
    'configured_file_path', v_top.configured_file_path,
    'configured_file_format', v_top.configured_file_format
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_document_template_version(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_document_template_version(uuid, text, date) TO authenticated, service_role;

-- 4.8 public.set_contract_document_template_version
CREATE OR REPLACE FUNCTION public.set_contract_document_template_version(p_contract_id uuid, p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_contract public.employment_contracts%rowtype;
  v_type_code text;
  v_expected text;
  v_version public.document_template_versions%rowtype;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v_contract from public.employment_contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Contrato no encontrado';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_access_entity(v_contract.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para generar documentos de este contrato';
  end if;

  select code into v_type_code from public.employment_contract_types where id = v_contract.contract_type_id;
  v_expected := case v_type_code
    when 'DETERMINADO' then 'EMPLOYMENT_CONTRACT_DETERMINED'
    when 'INDETERMINADO' then 'EMPLOYMENT_CONTRACT_INDETERMINED'
    else null end;

  if v_expected is null then
    raise exception 'No existe una plantilla documental para este tipo de contrato';
  end if;

  select * into v_version from public.document_template_versions where id = p_version_id;
  if not found then
    raise exception 'Versión de plantilla no encontrada';
  end if;

  if v_version.organization_entity_id <> v_contract.organization_entity_id then
    raise exception 'La plantilla no pertenece a la entidad del contrato';
  end if;

  if v_version.document_type_code <> v_expected then
    raise exception 'El tipo de la plantilla no corresponde al tipo de este contrato';
  end if;

  if v_contract.document_template_version_id is not null
     and v_contract.document_template_version_id <> p_version_id then
    raise exception 'La versión de plantilla del contrato ya está fijada y no puede cambiarse';
  end if;

  if v_contract.document_template_version_id is null then
    update public.employment_contracts
    set document_template_version_id = p_version_id, updated_at = now()
    where id = p_contract_id;
  end if;

  return jsonb_build_object('contract_id', p_contract_id, 'document_template_version_id', p_version_id);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_contract_document_template_version(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contract_document_template_version(uuid, uuid) TO authenticated, service_role;

-- 4.9 public.set_addendum_document_template_version
CREATE OR REPLACE FUNCTION public.set_addendum_document_template_version(p_addendum_id uuid, p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_addendum public.contract_addendums%rowtype;
  v_version public.document_template_versions%rowtype;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v_addendum from public.contract_addendums where id = p_addendum_id for update;
  if not found then
    raise exception 'Anexo no encontrado';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_access_entity(v_addendum.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para generar documentos de este anexo';
  end if;

  select * into v_version from public.document_template_versions where id = p_version_id;
  if not found then
    raise exception 'Versión de plantilla no encontrada';
  end if;

  if v_version.organization_entity_id <> v_addendum.organization_entity_id then
    raise exception 'La plantilla no pertenece a la entidad del anexo';
  end if;

  if v_version.document_type_code <> 'EMPLOYMENT_CONTRACT_ADDENDUM' then
    raise exception 'La plantilla indicada no es una plantilla de anexo';
  end if;

  if v_addendum.document_template_version_id is not null
     and v_addendum.document_template_version_id <> p_version_id then
    raise exception 'La versión de plantilla del anexo ya está fijada y no puede cambiarse';
  end if;

  if v_addendum.document_template_version_id is null then
    update public.contract_addendums
    set document_template_version_id = p_version_id, updated_at = now()
    where id = p_addendum_id;
  end if;

  return jsonb_build_object('addendum_id', p_addendum_id, 'document_template_version_id', p_version_id);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_addendum_document_template_version(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_addendum_document_template_version(uuid, uuid) TO authenticated, service_role;

-- 4.10 public.begin_document_generation
CREATE OR REPLACE FUNCTION public.begin_document_generation(
  p_employment_contract_id uuid DEFAULT NULL::uuid,
  p_contract_addendum_id uuid DEFAULT NULL::uuid,
  p_template_version_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_entity_id uuid;
  v_worker_id uuid;
  v_expected_type text;
  v_document_type_id text;
  v_entity public.organization_entities%rowtype;
  v_version public.document_template_versions%rowtype;
  v_contract public.employment_contracts%rowtype;
  v_addendum public.contract_addendums%rowtype;
  v_type_code text;
  v_generation_number integer;
  v_document_id uuid;
  v_storage_path text;
  v_required jsonb;
  v_actor uuid := coalesce(p_actor_user_id, auth.uid());
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  if (p_employment_contract_id is null) = (p_contract_addendum_id is null) then
    raise exception 'Debe indicarse un contrato o un anexo (nunca ambos)';
  end if;

  if p_employment_contract_id is not null then
    select * into v_contract from public.employment_contracts
    where id = p_employment_contract_id for update;
    if not found then
      raise exception 'Contrato no encontrado';
    end if;

    if v_contract.signature_date is null then
      raise exception 'Solo se puede generar el documento de un contrato formalizado';
    end if;

    select code into v_type_code from public.employment_contract_types where id = v_contract.contract_type_id;
    v_expected_type := case v_type_code
      when 'DETERMINADO' then 'EMPLOYMENT_CONTRACT_DETERMINED'
      when 'INDETERMINADO' then 'EMPLOYMENT_CONTRACT_INDETERMINED'
      else null end;
    if v_expected_type is null then
      raise exception 'No existe una plantilla documental para este tipo de contrato';
    end if;

    v_entity_id := v_contract.organization_entity_id;
    v_worker_id := v_contract.worker_id;
    v_document_type_id := 'EMPLOYMENT_CONTRACT';
  else
    select * into v_addendum from public.contract_addendums
    where id = p_contract_addendum_id for update;
    if not found then
      raise exception 'Anexo no encontrado';
    end if;

    if v_addendum.status <> 'FORMALIZED' then
      raise exception 'Solo se puede generar el documento de un anexo formalizado';
    end if;

    v_expected_type := 'EMPLOYMENT_CONTRACT_ADDENDUM';
    v_entity_id := v_addendum.organization_entity_id;
    v_worker_id := v_addendum.worker_id;
    v_document_type_id := 'CONTRACT_ADDENDUM';
    v_actor := coalesce(v_actor, v_addendum.formalized_by, v_addendum.created_by);
  end if;

  select * into v_entity from public.organization_entities where id = v_entity_id;
  if not found then
    raise exception 'Entidad no encontrada';
  end if;
  if coalesce(v_entity.is_sitecorp_account, false) = false then
    raise exception 'Esta entidad no utiliza los módulos internos de SiteCorp';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_access_entity(v_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para generar documentos de esta entidad';
  end if;

  select * into v_version from public.document_template_versions where id = p_template_version_id;
  if not found then
    raise exception 'Versión de plantilla no encontrada';
  end if;

  if v_version.organization_entity_id <> v_entity_id then
    raise exception 'La plantilla no pertenece a la entidad del documento';
  end if;

  if v_version.document_type_code <> v_expected_type then
    raise exception 'La plantilla no corresponde al tipo documental de la fuente';
  end if;

  if v_version.configured_file_path is null then
    raise exception 'La versión de plantilla no tiene un documento configurado';
  end if;

  if v_version.configured_file_format is distinct from 'DOCX' then
    raise exception 'El documento configurado de esta plantilla es Word 97-2003 (.doc): cárguelo en formato .docx para poder generar documentos';
  end if;

  if v_version.analysis is null then
    raise exception 'La versión de plantilla no tiene un análisis de variables válido';
  end if;

  v_required := coalesce(v_version.analysis->'required_variables', '[]'::jsonb);

  if exists (
    select 1 from public.worker_documents
    where source = 'GENERATED' and generation_status = 'PROCESSING'
      and (
        (p_employment_contract_id is not null and employment_contract_id = p_employment_contract_id)
        or (p_contract_addendum_id is not null and contract_addendum_id = p_contract_addendum_id)
      )
  ) then
    raise exception 'Ya hay una generación de documento en curso para esta fuente';
  end if;

  select coalesce(max(generation_number), 0) + 1 into v_generation_number
  from public.worker_documents
  where (p_employment_contract_id is not null and employment_contract_id = p_employment_contract_id)
     or (p_contract_addendum_id is not null and contract_addendum_id = p_contract_addendum_id);

  insert into public.worker_documents (
    worker_id, organization_entity_id, document_type_id, employment_contract_id, contract_addendum_id,
    file_name, storage_path, mime_type, file_size, description,
    source, document_template_version_id, generation_number, generation_status, uploaded_by
  ) values (
    v_worker_id, v_entity_id, v_document_type_id, p_employment_contract_id, p_contract_addendum_id,
    'Documento en preparación', 'pending', null, null, null,
    'GENERATED', p_template_version_id, v_generation_number, 'PROCESSING', v_actor
  ) returning id into v_document_id;

  v_storage_path := 'workers/' || v_worker_id::text || '/generated/' || v_document_id::text || '.docx';

  return jsonb_build_object(
    'worker_document_id', v_document_id,
    'worker_id', v_worker_id,
    'generation_number', v_generation_number,
    'storage_path', v_storage_path,
    'document_template_version_id', p_template_version_id,
    'required_variables', v_required
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.begin_document_generation(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_document_generation(uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- 4.11 public.begin_resolution_generation
CREATE OR REPLACE FUNCTION public.begin_resolution_generation(
  p_resolution_id uuid,
  p_template_version_id uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_res public.worker_resolutions%rowtype;
  v_version public.document_template_versions%rowtype;
  v_generation_number integer;
  v_document_id uuid;
  v_storage_path text;
  v_required jsonb;
  v_actor uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v_res from public.worker_resolutions where id = p_resolution_id for update;
  if not found then
    raise exception 'Resolución no encontrada';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_access_entity(v_res.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para generar documentos de esta entidad';
  end if;

  v_actor := coalesce(p_actor_user_id, auth.uid(), v_res.created_by);

  select * into v_version from public.document_template_versions where id = p_template_version_id;
  if not found then
    raise exception 'Versión de plantilla no encontrada';
  end if;

  if v_version.organization_entity_id <> v_res.organization_entity_id then
    raise exception 'La plantilla no pertenece a la entidad del documento';
  end if;

  if v_version.document_type_code <> 'RESOLUTION' then
    raise exception 'La plantilla no corresponde al tipo documental Resolución';
  end if;

  if v_version.configured_file_path is null then
    raise exception 'La versión de plantilla no tiene un documento configurado';
  end if;

  if v_version.configured_file_format is distinct from 'DOCX' then
    raise exception 'El documento configurado de esta plantilla es Word 97-2003 (.doc): cárguelo en formato .docx para poder generar documentos';
  end if;

  if v_version.analysis is null then
    raise exception 'La versión de plantilla no tiene un análisis de variables válido';
  end if;

  v_required := coalesce(v_version.analysis->'required_variables', '[]'::jsonb);

  if exists (
    select 1 from public.worker_documents
    where source = 'GENERATED' and generation_status = 'PROCESSING'
      and document_source_type = 'RESOLUTION' and document_source_id = p_resolution_id
  ) then
    raise exception 'Ya hay una generación de documento en curso para esta Resolución';
  end if;

  select coalesce(max(generation_number), 0) + 1 into v_generation_number
  from public.worker_documents
  where document_source_type = 'RESOLUTION' and document_source_id = p_resolution_id;

  insert into public.worker_documents (
    worker_id, organization_entity_id, document_type_id, document_source_type, document_source_id,
    file_name, storage_path, mime_type, file_size, description,
    source, document_template_version_id, generation_number, generation_status, uploaded_by
  ) values (
    v_res.worker_id, v_res.organization_entity_id, 'RESOLUTION', 'RESOLUTION', p_resolution_id,
    'Documento en preparación', 'pending', null, null, null,
    'GENERATED', p_template_version_id, v_generation_number, 'PROCESSING', v_actor
  ) returning id into v_document_id;

  update public.worker_resolutions
  set document_template_version_id = coalesce(document_template_version_id, p_template_version_id),
      updated_at = now()
  where id = p_resolution_id;

  v_storage_path := 'workers/' || v_res.worker_id::text || '/generated/' || v_document_id::text || '.docx';

  return jsonb_build_object(
    'worker_document_id', v_document_id,
    'worker_id', v_res.worker_id,
    'generation_number', v_generation_number,
    'storage_path', v_storage_path,
    'document_template_version_id', p_template_version_id,
    'required_variables', v_required
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.begin_resolution_generation(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_resolution_generation(uuid, uuid, uuid) TO authenticated, service_role;

-- 4.12 public.begin_payroll_movement_generation
CREATE OR REPLACE FUNCTION public.begin_payroll_movement_generation(
  p_movement_id uuid,
  p_template_version_id uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_mov public.worker_payroll_movements%rowtype;
  v_version public.document_template_versions%rowtype;
  v_generation_number integer;
  v_document_id uuid;
  v_storage_path text;
  v_required jsonb;
  v_actor uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v_mov from public.worker_payroll_movements where id = p_movement_id for update;
  if not found then raise exception 'Movimiento de Nómina no encontrado'; end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_access_entity(v_mov.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para generar documentos de esta entidad';
  end if;

  v_actor := coalesce(p_actor_user_id, auth.uid(), v_mov.created_by);

  select * into v_version from public.document_template_versions where id = p_template_version_id;
  if not found then raise exception 'Versión de plantilla no encontrada'; end if;

  if v_version.organization_entity_id <> v_mov.organization_entity_id then
    raise exception 'La plantilla no pertenece a la entidad del documento';
  end if;
  if v_version.document_type_code <> 'PAYROLL_MOVEMENT' then
    raise exception 'La plantilla no corresponde al tipo documental Movimiento de Nómina';
  end if;
  if v_version.configured_file_path is null then
    raise exception 'La versión de plantilla no tiene un documento configurado';
  end if;
  if v_version.configured_file_format is distinct from 'XLSX' then
    raise exception 'El documento configurado de esta plantilla debe estar en formato .xlsx';
  end if;
  if v_version.analysis is null then
    raise exception 'La versión de plantilla no tiene un análisis de variables válido';
  end if;

  v_required := coalesce(v_version.analysis->'required_variables', '[]'::jsonb);

  if exists (
    select 1 from public.worker_documents
    where source = 'GENERATED' and generation_status = 'PROCESSING'
      and document_source_type = 'PAYROLL_MOVEMENT' and document_source_id = p_movement_id
  ) then
    raise exception 'Ya hay una generación de documento en curso para este Movimiento de Nómina';
  end if;

  select coalesce(max(generation_number), 0) + 1 into v_generation_number
  from public.worker_documents
  where document_source_type = 'PAYROLL_MOVEMENT' and document_source_id = p_movement_id;

  insert into public.worker_documents (
    worker_id, organization_entity_id, document_type_id, document_source_type, document_source_id,
    file_name, storage_path, mime_type, file_size, description,
    source, document_template_version_id, generation_number, generation_status, uploaded_by
  ) values (
    v_mov.worker_id, v_mov.organization_entity_id, 'PAYROLL_MOVEMENT', 'PAYROLL_MOVEMENT', p_movement_id,
    'Documento en preparación', 'pending', null, null, null,
    'GENERATED', p_template_version_id, v_generation_number, 'PROCESSING', v_actor
  ) returning id into v_document_id;

  update public.worker_payroll_movements
  set document_template_version_id = coalesce(document_template_version_id, p_template_version_id),
      updated_at = now()
  where id = p_movement_id;

  v_storage_path := 'workers/' || v_mov.worker_id::text || '/generated/' || v_document_id::text || '.xlsx';

  return jsonb_build_object(
    'worker_document_id', v_document_id,
    'worker_id', v_mov.worker_id,
    'generation_number', v_generation_number,
    'storage_path', v_storage_path,
    'document_template_version_id', p_template_version_id,
    'required_variables', v_required
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.begin_payroll_movement_generation(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_payroll_movement_generation(uuid, uuid, uuid) TO authenticated, service_role;

-- 4.13 public.begin_sc404_generation
CREATE OR REPLACE FUNCTION public.begin_sc404_generation(
  p_source_type text,
  p_source_id uuid,
  p_template_version_id uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_entity_id uuid;
  v_worker_id uuid;
  v_source_creator uuid;
  v_required_permission text;
  v_entity public.organization_entities%rowtype;
  v_version public.document_template_versions%rowtype;
  v_generation_number integer;
  v_document_id uuid;
  v_storage_path text;
  v_required jsonb;
  v_existing_id uuid;
  v_actor uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  if p_source_type = 'VACATION' then
    select organization_entity_id, worker_id, created_by into v_entity_id, v_worker_id, v_source_creator
    from public.worker_vacations
    where id = p_source_id and status <> 'CANCELLED';
    if v_worker_id is null then
      raise exception 'Período de vacaciones no encontrado (o cancelado)';
    end if;
    v_required_permission := 'vacations.manage';
  elsif p_source_type = 'MEDICAL_CERTIFICATE' then
    select organization_entity_id, worker_id, created_by into v_entity_id, v_worker_id, v_source_creator
    from public.worker_medical_certificates
    where id = p_source_id;
    if v_worker_id is null then
      raise exception 'Certificado médico no encontrado';
    end if;
    v_required_permission := 'medical_certificates.manage';
  else
    raise exception 'Tipo de origen no soportado para SC-4-04';
  end if;

  v_actor := coalesce(p_actor_user_id, auth.uid(), v_source_creator);

  select * into v_entity from public.organization_entities where id = v_entity_id;
  if not found then
    raise exception 'Entidad no encontrada';
  end if;
  if coalesce(v_entity.is_sitecorp_account, false) = false then
    raise exception 'Esta entidad no utiliza los módulos internos de SiteCorp';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_access_entity(v_entity_id, v_required_permission) then
    raise exception 'No tiene permiso (%I) para generar documentos de esta entidad', v_required_permission;
  end if;

  select * into v_version from public.document_template_versions where id = p_template_version_id;
  if not found then
    raise exception 'Versión de plantilla no encontrada';
  end if;

  if v_version.organization_entity_id <> v_entity_id then
    raise exception 'La plantilla no pertenece a la entidad del documento';
  end if;

  if v_version.document_type_code <> 'SC_4_04' then
    raise exception 'La plantilla no corresponde al tipo documental SC-4-04';
  end if;

  if v_version.configured_file_path is null then
    raise exception 'La versión de plantilla no tiene un documento configurado';
  end if;

  if v_version.configured_file_format is distinct from 'DOCX' then
    raise exception 'El documento configurado de esta plantilla es Word 97-2003 (.doc): cárguelo en formato .docx para poder generar documentos';
  end if;

  if v_version.analysis is null then
    raise exception 'La versión de plantilla no tiene un análisis de variables válido';
  end if;

  v_required := coalesce(v_version.analysis->'required_variables', '[]'::jsonb);

  if exists (
    select 1 from public.worker_documents
    where source = 'GENERATED' and generation_status = 'PROCESSING'
      and document_source_type = p_source_type
      and document_source_id = p_source_id
  ) then
    raise exception 'Ya hay una generación de documento en curso para este registro';
  end if;

  select id into v_existing_id from public.worker_documents
  where source = 'GENERATED' and generation_status = 'COMPLETED'
    and document_source_type = p_source_type
    and document_source_id = p_source_id
    and document_template_version_id = p_template_version_id
  limit 1;

  if v_existing_id is not null then
    raise exception 'SC404_ALREADY_EXISTS|%', v_existing_id using errcode = 'P0001';
  end if;

  select coalesce(max(generation_number), 0) + 1 into v_generation_number
  from public.worker_documents
  where document_source_type = p_source_type
    and document_source_id = p_source_id;

  insert into public.worker_documents (
    worker_id, organization_entity_id, document_type_id, document_source_type, document_source_id,
    file_name, storage_path, mime_type, file_size, description,
    source, document_template_version_id, generation_number, generation_status, uploaded_by
  ) values (
    v_worker_id, v_entity_id, 'SC_4_04', p_source_type, p_source_id,
    'Documento en preparación', 'pending', null, null, null,
    'GENERATED', p_template_version_id, v_generation_number, 'PROCESSING', v_actor
  ) returning id into v_document_id;

  v_storage_path := 'workers/' || v_worker_id::text || '/generated/' || v_document_id::text || '.docx';

  return jsonb_build_object(
    'worker_document_id', v_document_id,
    'worker_id', v_worker_id,
    'generation_number', v_generation_number,
    'storage_path', v_storage_path,
    'document_template_version_id', p_template_version_id,
    'required_variables', v_required
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.begin_sc404_generation(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_sc404_generation(text, uuid, uuid, uuid) TO authenticated, service_role;

-- 4.14 public.complete_document_generation
CREATE OR REPLACE FUNCTION public.complete_document_generation(
  p_worker_document_id uuid,
  p_file_name text,
  p_file_size bigint DEFAULT NULL::bigint,
  p_mime_type text DEFAULT NULL::text,
  p_actor_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_doc public.worker_documents%rowtype;
  v_entity_id uuid;
  v_storage_path text;
  v_name text := btrim(coalesce(p_file_name, ''));
  v_actor uuid := coalesce(p_actor_user_id, auth.uid());
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v_doc from public.worker_documents where id = p_worker_document_id for update;
  if not found then
    raise exception 'Documento generado no encontrado';
  end if;

  if v_doc.source <> 'GENERATED' or v_doc.generation_status is distinct from 'PROCESSING' then
    raise exception 'El documento no está en proceso de generación';
  end if;

  select organization_entity_id into v_entity_id from public.workers where id = v_doc.worker_id;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_doc.document_source_type = 'VACATION' then
      if not public.can_access_entity(v_entity_id, 'vacations.manage') then
        raise exception 'No tiene permiso para completar la generación de este documento';
      end if;
    elsif v_doc.document_source_type = 'MEDICAL_CERTIFICATE' then
      if not public.can_access_entity(v_entity_id, 'medical_certificates.manage') then
        raise exception 'No tiene permiso para completar la generación de este documento';
      end if;
    else
      if not public.can_access_entity(v_entity_id, 'workers.manage') then
        raise exception 'No tiene permiso para registrar documentos de esta entidad';
      end if;
    end if;
  end if;

  if v_name = '' or position('/' in v_name) > 0 then
    raise exception 'El nombre del archivo no es válido';
  end if;

  v_storage_path := 'workers/' || v_doc.worker_id::text || '/generated/' || v_doc.id::text ||
    case when v_doc.document_source_type = 'PAYROLL_MOVEMENT' then '.xlsx' else '.docx' end;

  update public.worker_documents
  set file_name = v_name,
      storage_path = v_storage_path,
      file_size = p_file_size,
      mime_type = p_mime_type,
      organization_entity_id = coalesce(organization_entity_id, v_entity_id),
      generation_status = 'COMPLETED',
      uploaded_by = coalesce(uploaded_by, v_actor),
      updated_at = now()
  where id = v_doc.id;

  if v_doc.employment_contract_id is not null then
    update public.employment_contracts
    set document_template_version_id = coalesce(document_template_version_id, v_doc.document_template_version_id),
        updated_at = now()
    where id = v_doc.employment_contract_id;
  end if;

  if v_doc.contract_addendum_id is not null then
    update public.contract_addendums
    set document_template_version_id = coalesce(document_template_version_id, v_doc.document_template_version_id),
        worker_document_id = v_doc.id,
        generated_at = now(),
        generation_error = null,
        updated_at = now()
    where id = v_doc.contract_addendum_id;
  end if;

  if v_doc.document_source_type = 'RESOLUTION' and v_doc.document_source_id is not null then
    update public.worker_resolutions
    set document_template_version_id = coalesce(document_template_version_id, v_doc.document_template_version_id),
        worker_document_id = v_doc.id,
        status = 'GENERATED',
        generated_at = now(),
        updated_at = now()
    where id = v_doc.document_source_id;
  end if;

  if v_doc.document_source_type = 'PAYROLL_MOVEMENT' and v_doc.document_source_id is not null then
    update public.worker_payroll_movements
    set document_template_version_id = coalesce(document_template_version_id, v_doc.document_template_version_id),
        worker_document_id = v_doc.id,
        status = 'GENERATED',
        generated_at = now(),
        updated_at = now()
    where id = v_doc.document_source_id;
  end if;

  if v_doc.document_source_type = 'MEDICAL_CERTIFICATE' and v_doc.document_source_id is not null then
    update public.worker_medical_certificates
    set document_id = coalesce(document_id, v_doc.id),
        updated_at = now()
    where id = v_doc.document_source_id;
  end if;

  return jsonb_build_object(
    'status', 'COMPLETED',
    'worker_document_id', v_doc.id,
    'generation_number', v_doc.generation_number,
    'storage_path', v_storage_path,
    'file_name', v_name
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_document_generation(uuid, text, bigint, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_document_generation(uuid, text, bigint, text, uuid) TO authenticated, service_role;

-- 4.15 public.fail_document_generation
CREATE OR REPLACE FUNCTION public.fail_document_generation(
  p_worker_document_id uuid,
  p_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_doc public.worker_documents%rowtype;
  v_entity_id uuid;
  v_storage_path text;
  v_allowed boolean;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'No autenticado';
  end if;

  select * into v_doc from public.worker_documents where id = p_worker_document_id for update;
  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  if v_doc.source <> 'GENERATED' then
    raise exception 'Solo se pueden cancelar documentos generados';
  end if;

  select organization_entity_id into v_entity_id from public.workers where id = v_doc.worker_id;

  if coalesce(auth.role(), '') = 'service_role' then
    v_allowed := true;
  else
    v_allowed :=
      case v_doc.document_source_type
        when 'VACATION' then public.can_access_entity(v_entity_id, 'vacations.manage')
        when 'MEDICAL_CERTIFICATE' then public.can_access_entity(v_entity_id, 'medical_certificates.manage')
        else public.can_access_entity(v_entity_id, 'workers.manage')
      end;
  end if;

  if not v_allowed then
    raise exception 'No tiene permiso para gestionar documentos de esta entidad';
  end if;

  v_storage_path := 'workers/' || v_doc.worker_id::text || '/generated/' || v_doc.id::text || '.docx';

  if v_doc.generation_status = 'PROCESSING' then
    delete from public.worker_documents where id = v_doc.id;
    return jsonb_build_object('status', 'DELETED', 'storage_path', v_storage_path);
  end if;

  return jsonb_build_object('status', 'UNCHANGED', 'storage_path', v_storage_path);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fail_document_generation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_document_generation(uuid, text) TO authenticated, service_role;

-- Reencolar trabajos documentales fallidos previamente
UPDATE public.document_generation_jobs
SET status = 'PENDIENTE',
    attempts = 0,
    last_error = NULL,
    next_attempt_at = now(),
    updated_at = now()
WHERE status IN ('ERROR', 'GENERANDO');



-- Helpers invocados por generación documental de contratos bajo service_role

CREATE OR REPLACE FUNCTION public.contract_retribution_components(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  WITH latest AS (
    SELECT a.id
    FROM public.contract_addendums a
    WHERE a.employment_contract_id = p_contract_id
      AND a.status = 'FORMALIZED'
      AND EXISTS (
        SELECT 1 FROM public.employment_contract_compensation_components cc
        WHERE cc.addendum_id = a.id
      )
    ORDER BY a.effective_date DESC, a.addendum_number DESC NULLS LAST, a.created_at DESC
    LIMIT 1
  ),
  current_source AS (
    SELECT COALESCE((SELECT id FROM latest), NULL) AS addendum_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'component_type', cc.component_type,
           'description', cc.description,
           'amount', cc.amount,
           'display_order', cc.display_order,
           'addendum_id', cc.addendum_id
         ) ORDER BY cc.display_order, cc.created_at), '[]'::jsonb)
  FROM public.employment_contract_compensation_components cc
  CROSS JOIN current_source src
  WHERE cc.employment_contract_id = p_contract_id
    AND (
      (src.addendum_id IS NOT NULL AND cc.addendum_id = src.addendum_id)
      OR (src.addendum_id IS NULL AND cc.addendum_id IS NULL)
    )
    -- S3: lectura contractual sensible — ámbito organizativo del contrato
    AND (coalesce(auth.role(), '') = 'service_role' OR public.can_access_entity((SELECT c.organization_entity_id FROM public.employment_contracts c WHERE c.id = p_contract_id), NULL)
         OR public.has_platform_permission('salary.manage'));
$function$;

REVOKE EXECUTE ON FUNCTION public.contract_retribution_components(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contract_retribution_components(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contract_formalized_conditions(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_contract public.employment_contracts%ROWTYPE;
  v_addendum record;
  v_change record;
  v_area_name text;
  v_job_name text;
  v_position_name text;
  v_position_code text;
  v_category text;
  v_work_location text;
  v_daily_hours numeric;
  v_weekly_hours numeric;
  v_monthly_hours numeric;
  v_break_minutes integer;
  v_work_schedule text;
  v_jornada text;
  v_group_id uuid;
  v_group_sequence integer;
  v_salary numeric;
  v_currency text;
  v_payment_id uuid;
  v_payment_name text;
  v_payment_schedule text;
  v_additional numeric := 0;
  v_abnormal numeric := 0;
  v_other numeric := 0;
  v_total numeric;
  v_components jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_last_number integer;
  v_changed boolean := false;
  v_override_code text;
  v_override_break integer;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_contract FROM public.employment_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado';
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(v_contract.organization_entity_id, 'workers.view')
          OR public.can_access_entity(v_contract.organization_entity_id, 'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este contrato';
  END IF;

  -- Base: SIEMPRE snapshots históricos congelados en el contrato.
  -- Nunca se leen datos vivos del puesto/cargo: cambiar el puesto después no
  -- debe modificar el documento de un contrato anterior.
  v_area_name := v_contract.area_name_snapshot;
  v_job_name := v_contract.job_name_snapshot;
  v_position_name := v_contract.position_name_snapshot;
  v_position_code := v_contract.position_code_snapshot;
  v_category := v_contract.occupational_category_snapshot;
  v_work_location := v_contract.work_location_snapshot;
  v_work_schedule := v_contract.work_schedule_snapshot;
  v_daily_hours := v_contract.daily_hours_snapshot;
  v_weekly_hours := v_contract.weekly_hours_snapshot;
  v_monthly_hours := v_contract.monthly_hours_snapshot;
  v_break_minutes := v_contract.break_minutes_snapshot;

  v_jornada := COALESCE(
    v_contract.work_jornada_snapshot,
    concat_ws(' · ',
      CASE WHEN v_daily_hours IS NOT NULL THEN public.format_hours_text(v_daily_hours) || ' h/día' END,
      CASE WHEN v_weekly_hours IS NOT NULL THEN public.format_hours_text(v_weekly_hours) || ' h/semana' END,
      CASE WHEN v_monthly_hours IS NOT NULL THEN public.format_hours_text(v_monthly_hours) || ' h/mes' END
    )
  );

  v_group_id := v_contract.salary_group_id;
  SELECT sequence_number INTO v_group_sequence FROM public.salary_groups WHERE id = v_group_id;
  v_salary := v_contract.salary_amount;
  v_currency := COALESCE(v_contract.salary_currency_code, 'CUP');

  v_payment_id := v_contract.payment_method_id;
  IF v_payment_id IS NOT NULL THEN
    SELECT name INTO v_payment_name FROM public.payment_methods WHERE id = v_payment_id;
  END IF;

  v_payment_schedule := nullif(btrim(coalesce(v_contract.payment_schedule_text, '')), '');

  v_components := public.contract_retribution_components(p_contract_id);
  SELECT COALESCE(SUM(CASE WHEN value->>'component_type' = 'ADDITIONAL_PAYMENT' THEN (value->>'amount')::numeric ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN value->>'component_type' = 'ABNORMAL_CONDITIONS' THEN (value->>'amount')::numeric ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN value->>'component_type' = 'OTHER' THEN (value->>'amount')::numeric ELSE 0 END), 0)
  INTO v_additional, v_abnormal, v_other
  FROM jsonb_array_elements(v_components);

  v_total := COALESCE(v_contract.total_compensation_snapshot,
                      COALESCE(v_salary, 0) + v_additional + v_abnormal + v_other);

  FOR v_addendum IN
    SELECT a.id, a.addendum_number, a.effective_date
    FROM public.contract_addendums a
    WHERE a.employment_contract_id = p_contract_id
      AND a.status = 'FORMALIZED'
    ORDER BY a.effective_date, a.addendum_number NULLS FIRST, a.created_at
  LOOP
    v_changed := true;
    v_last_number := v_addendum.addendum_number;
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'addendum_id', v_addendum.id,
      'addendum_number', v_addendum.addendum_number,
      'effective_date', v_addendum.effective_date
    ));

    IF EXISTS (SELECT 1 FROM public.employment_contract_compensation_components cc WHERE cc.addendum_id = v_addendum.id) THEN
      SELECT COALESCE(SUM(CASE WHEN cc.component_type = 'ADDITIONAL_PAYMENT' THEN cc.amount ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN cc.component_type = 'ABNORMAL_CONDITIONS' THEN cc.amount ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN cc.component_type = 'OTHER' THEN cc.amount ELSE 0 END), 0)
      INTO v_additional, v_abnormal, v_other
      FROM public.employment_contract_compensation_components cc
      WHERE cc.addendum_id = v_addendum.id;
    END IF;

    FOR v_change IN
      SELECT c.field_code, c.new_value, c.new_display_value, c.new_reference_id
      FROM public.employment_contract_addendum_changes c
      WHERE c.addendum_id = v_addendum.id
      ORDER BY c.display_order
    LOOP
      CASE v_change.field_code
        WHEN 'AREA' THEN v_area_name := v_change.new_value;
        WHEN 'JOB' THEN v_job_name := v_change.new_value;
        WHEN 'POSITION' THEN v_position_name := v_change.new_value;
        WHEN 'OCCUPATIONAL_CATEGORY' THEN v_category := v_change.new_value;
        WHEN 'SALARY_GROUP' THEN
          v_group_sequence := nullif(v_change.new_value, '')::integer;
          v_group_id := COALESCE(v_change.new_reference_id, v_group_id);
        WHEN 'SALARY' THEN
          v_salary := nullif(v_change.new_value, '')::numeric;
          IF v_change.new_display_value ~ ' [A-Z]{3}$' THEN
            v_currency := right(v_change.new_display_value, 3);
          END IF;
        WHEN 'WORK_LOCATION' THEN v_work_location := v_change.new_value;
        WHEN 'DAILY_HOURS' THEN v_daily_hours := nullif(v_change.new_value, '')::numeric;
        WHEN 'WEEKLY_HOURS' THEN v_weekly_hours := nullif(v_change.new_value, '')::numeric;
        WHEN 'MONTHLY_HOURS' THEN v_monthly_hours := nullif(v_change.new_value, '')::numeric;
        WHEN 'WORK_SCHEDULE' THEN v_work_schedule := v_change.new_value;
        WHEN 'PAYMENT_METHOD' THEN
          v_payment_id := v_change.new_reference_id;
          SELECT name INTO v_payment_name FROM public.payment_methods WHERE id = v_payment_id;
        WHEN 'PAYMENT_SCHEDULE' THEN
          v_payment_schedule := nullif(btrim(coalesce(v_change.new_value, '')), '');
        WHEN 'ADDITIONAL_PAYMENT' THEN v_additional := nullif(v_change.new_value, '')::numeric;
        WHEN 'ABNORMAL_CONDITIONS' THEN v_abnormal := nullif(v_change.new_value, '')::numeric;
        WHEN 'OTHER_PAYMENT' THEN v_other := nullif(v_change.new_value, '')::numeric;
        WHEN 'TOTAL_COMPENSATION' THEN v_total := nullif(v_change.new_value, '')::numeric;
        ELSE NULL;
      END CASE;
    END LOOP;

    v_jornada := concat_ws(' · ',
      CASE WHEN v_daily_hours IS NOT NULL THEN public.format_hours_text(v_daily_hours) || ' h/día' END,
      CASE WHEN v_weekly_hours IS NOT NULL THEN public.format_hours_text(v_weekly_hours) || ' h/semana' END,
      CASE WHEN v_monthly_hours IS NOT NULL THEN public.format_hours_text(v_monthly_hours) || ' h/mes' END
    );
  END LOOP;

  -- Código y descanso del puesto: sólo se sobrescriben si existe un anexo
  -- formalizado que cambió el puesto (sin anexos, se conservan los del contrato)
  SELECT NULL::text, pos.break_minutes INTO v_override_code, v_override_break
  FROM public.contract_addendums a
  JOIN public.employment_contract_addendum_changes c ON c.addendum_id = a.id
  JOIN public.organization_positions pos ON pos.id = c.new_reference_id
  WHERE a.employment_contract_id = p_contract_id
    AND a.status = 'FORMALIZED'
    AND c.field_code = 'POSITION'
    AND c.new_reference_id IS NOT NULL
  ORDER BY a.effective_date DESC, a.addendum_number DESC NULLS LAST, a.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_position_code := v_override_code;
    v_break_minutes := v_override_break;
  END IF;

  RETURN jsonb_build_object(
    'employment_contract_id', p_contract_id,
    'worker_id', v_contract.worker_id,
    'organization_entity_id', v_contract.organization_entity_id,
    'contract_start_date', v_contract.start_date,
    'contract_end_date', v_contract.end_date,
    'contract_type_id', v_contract.contract_type_id,
    'has_formalized_addendums', v_changed,
    'applied_addendums', v_applied,
    'last_addendum_number', v_last_number,
    'area_name', v_area_name,
    'job_name', v_job_name,
    'position_name', v_position_name,
    'position_code', v_position_code,
    'occupational_category', v_category,
    'work_location', v_work_location,
    'work_schedule', v_work_schedule,
    'daily_hours', v_daily_hours,
    'weekly_hours', v_weekly_hours,
    'monthly_hours', v_monthly_hours,
    'break_minutes', v_break_minutes,
    'jornada', nullif(v_jornada, ''),
    'salary_group_id', v_group_id,
    'salary_group_sequence', v_group_sequence,
    'salary_amount', v_salary,
    'currency_code', v_currency,
    'payment_method_id', v_payment_id,
    'payment_method_name', v_payment_name,
    'payment_schedule', v_payment_schedule,
    'additional_payment', v_additional,
    'abnormal_conditions', v_abnormal,
    'other_payment', v_other,
    'total_compensation', v_total,
    'components', v_components
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.contract_formalized_conditions(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contract_formalized_conditions(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_contract_document_status(p_contract_id uuid, p_status text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_contract public.employment_contracts%ROWTYPE;
  v_clean_status text := upper(btrim(COALESCE(p_status, '')));
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF v_clean_status NOT IN ('PENDIENTE', 'GENERADO', 'ERROR') THEN
    RAISE EXCEPTION 'Estado de documento contractual no válido: %', p_status;
  END IF;

  SELECT * INTO v_contract
  FROM public.employment_contracts
  WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(v_contract.organization_entity_id, 'workers.manage')
    OR public.can_access_entity(v_contract.organization_entity_id, 'contracts.manage')
    OR public.can_access_entity(v_contract.organization_entity_id, 'workers.view')
  ) THEN
    RAISE EXCEPTION 'No tiene permiso para actualizar el estado documental de este contrato';
  END IF;

  UPDATE public.employment_contracts
  SET document_status = v_clean_status,
      document_error = CASE WHEN v_clean_status = 'GENERADO' THEN NULL ELSE nullif(btrim(COALESCE(p_error, '')), '') END,
      document_status_updated_at = now(),
      updated_at = now()
  WHERE id = p_contract_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_contract_document_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_contract_document_status(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_employment_contract_readiness(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_contract public.employment_contracts%ROWTYPE;
  v_data jsonb;
  v_type_code text;
  v_missing jsonb := '[]'::jsonb;
  v_section text := 'Contrato';
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_contract FROM public.employment_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array(
      jsonb_build_object('code','contract','label','Contrato','source','contract','sourceId',p_contract_id,'section',v_section)));
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(v_contract.organization_entity_id,'workers.view')
          OR public.can_access_entity(v_contract.organization_entity_id,'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este contrato';
  END IF;

  v_data := public.get_contract_document_data(p_contract_id);
  v_type_code := v_data->'contract'->>'type_code';

  IF v_type_code IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.type','label','Tipo de contrato','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF (v_data->'contract'->>'start_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.start_date','label','Fecha de inicio','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF (v_data->'contract'->>'signature_date') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.signature_date','label','Fecha de firma','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_data->'contract'->>'signature_place','')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.signature_place','label','Lugar de firma','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_data->'contract'->>'payment_method','')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.payment_method','label','Forma de pago','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_data->'contract'->>'payment_schedule','')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.payment_schedule','label','Día / momento de pago','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_data->'representative'->>'name','')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','representative.name','label','Representante de la entidad','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_data->'representative'->>'position','')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','representative.position','label','Cargo del representante','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF (v_data->'compensation'->>'base_salary') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','compensation.base_salary','label','Salario de escala','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_data->'compensation'->>'currency','')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','compensation.currency','label','Moneda','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;
  IF (v_data->'compensation'->>'total') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','compensation.total','label','Total contractual','source','contract','sourceId',p_contract_id,'section',v_section);
  END IF;

  IF v_type_code = 'DETERMINADO' THEN
    IF (v_data->'contract'->>'end_date') IS NULL THEN
      v_missing := v_missing || jsonb_build_object('code','contract.end_date','label','Fecha de fin (contrato determinado)','source','contract','sourceId',p_contract_id,'section',v_section);
    ELSIF (v_data->'contract'->>'start_date') IS NOT NULL
          AND (v_data->'contract'->>'end_date')::date <= (v_data->'contract'->>'start_date')::date THEN
      v_missing := v_missing || jsonb_build_object('code','contract.end_date_order','label','Fecha de fin posterior al inicio','source','contract','sourceId',p_contract_id,'section',v_section);
    END IF;
  END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END $function$;

REVOKE EXECUTE ON FUNCTION public.validate_employment_contract_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_employment_contract_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_entity_contract_readiness(p_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_e public.organization_entities%ROWTYPE;
  v_missing jsonb := '[]'::jsonb;
  v_section text := 'Entidad';
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_e FROM public.organization_entities WHERE id = p_entity_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array(
      jsonb_build_object('code','entity','label','Entidad','source','entity','sourceId',p_entity_id,'section',v_section)));
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(p_entity_id,'contract_data.view')
          OR public.can_access_entity(p_entity_id,'contract_data.manage')
          OR public.can_access_entity(p_entity_id,'workers.view')
          OR public.can_access_entity(p_entity_id,'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar los datos contractuales de esta entidad';
  END IF;

  IF nullif(btrim(coalesce(v_e.name,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.name','label','Nombre de la entidad','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.organism,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.organism','label','Organismo al que pertenece','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.branch,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.branch','label','Rama','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.labor_identification_code,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.labor_code','label','Código de identificación laboral','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.address,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.address','label','Dirección de la entidad','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.province,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.province','label','Provincia de la entidad','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.municipality,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.municipality','label','Municipio de la entidad','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_e.revolution_year,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','entity.revolution_year','label','Año de la Revolución','source','entity','sourceId',p_entity_id,'section',v_section);
  END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END $function$;

REVOKE EXECUTE ON FUNCTION public.validate_entity_contract_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_entity_contract_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_worker_contract_readiness(p_worker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_w public.workers%ROWTYPE;
  v_missing jsonb := '[]'::jsonb;
  v_section text := 'Trabajador';
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_w FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array(
      jsonb_build_object('code','worker','label','Trabajador','source','worker','sourceId',p_worker_id,'section',v_section)));
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(v_w.organization_entity_id,'workers.view')
          OR public.can_access_entity(v_w.organization_entity_id,'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este trabajador';
  END IF;

  IF nullif(btrim(concat_ws(' ', coalesce(v_w.first_name,''), coalesce(v_w.first_surname,''))),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.full_name','label','Nombre completo','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_w.identification,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.identification','label','Carné de identidad','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;
  IF v_w.birth_date IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.birth_date','label','Fecha de nacimiento','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_w.profession_or_trade,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.profession','label','Profesión u oficio','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_w.address,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.address','label','Dirección particular','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_w.province,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.province','label','Provincia','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_w.municipality,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','worker.municipality','label','Municipio','source','worker','sourceId',p_worker_id,'section',v_section);
  END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END $function$;

REVOKE EXECUTE ON FUNCTION public.validate_worker_contract_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_worker_contract_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_position_contract_readiness(p_position_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_pos public.organization_positions%ROWTYPE;
  v_missing jsonb := '[]'::jsonb;
  v_section text := 'Puesto';
  v_job jsonb;
  v_has_schedule boolean;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_pos FROM public.organization_positions WHERE id = p_position_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array(
      jsonb_build_object('code','position','label','Puesto','source','position','sourceId',p_position_id,'section',v_section)));
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(v_pos.organization_entity_id,'staffing.view')
          OR public.can_access_entity(v_pos.organization_entity_id,'staffing.manage')
          OR public.can_access_entity(v_pos.organization_entity_id,'workers.view')
          OR public.can_access_entity(v_pos.organization_entity_id,'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este puesto';
  END IF;

  v_job := public.validate_job_contract_readiness(v_pos.job_id);
  v_missing := v_missing || (v_job->'missing');

  IF nullif(btrim(coalesce(v_pos.name,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','position.name','label','Nombre del puesto','source','position','sourceId',p_position_id,'section',v_section);
  END IF;
  IF v_pos.authorized_quantity IS NULL OR v_pos.authorized_quantity < 1 THEN
    v_missing := v_missing || jsonb_build_object('code','position.authorized_quantity','label','Cantidad autorizada','source','position','sourceId',p_position_id,'section',v_section);
  END IF;
  IF nullif(btrim(coalesce(v_pos.work_location,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','position.work_location','label','Lugar de trabajo','source','position','sourceId',p_position_id,'section',v_section);
  END IF;
  IF v_pos.daily_hours IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','schedule.daily_hours','label','Horas diarias','source','position','sourceId',p_position_id,'section',v_section);
  END IF;
  IF v_pos.weekly_hours IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','schedule.weekly_hours','label','Horas semanales','source','position','sourceId',p_position_id,'section',v_section);
  END IF;
  IF v_pos.monthly_hours IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','schedule.monthly_hours','label','Horas mensuales','source','position','sourceId',p_position_id,'section',v_section);
  END IF;
  IF v_pos.break_minutes IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','schedule.break','label','Descanso','source','position','sourceId',p_position_id,'section',v_section);
  END IF;

  v_has_schedule := EXISTS (SELECT 1 FROM public.position_schedule_segments s WHERE s.position_id = p_position_id)
                    OR nullif(btrim(coalesce(v_pos.schedule_notes,'')),'') IS NOT NULL;
  IF NOT v_has_schedule THEN
    v_missing := v_missing || jsonb_build_object('code','schedule.text','label','Horario','source','position','sourceId',p_position_id,'section',v_section);
  END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END $function$;

REVOKE EXECUTE ON FUNCTION public.validate_position_contract_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_position_contract_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_job_contract_readiness(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_job public.organization_jobs%ROWTYPE;
  v_missing jsonb := '[]'::jsonb;
  v_section text := 'Cargo';
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_job FROM public.organization_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'missing', jsonb_build_array(
      jsonb_build_object('code','job','label','Cargo','source','job','sourceId',p_job_id,'section',v_section)));
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' AND NOT (
    public.can_access_entity(v_job.organization_entity_id,'staffing.view')
          OR public.can_access_entity(v_job.organization_entity_id,'staffing.manage')
          OR public.can_access_entity(v_job.organization_entity_id,'workers.view')
          OR public.can_access_entity(v_job.organization_entity_id,'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar este cargo';
  END IF;

  IF nullif(btrim(coalesce(v_job.name,'')),'') IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','job.name','label','Nombre del cargo','source','job','sourceId',p_job_id,'section',v_section);
  END IF;
  IF v_job.area_id IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','job.area','label','Área','source','job','sourceId',p_job_id,'section',v_section);
  END IF;
  IF v_job.occupational_category_id IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','job.occupational_category','label','Categoría ocupacional','source','job','sourceId',p_job_id,'section',v_section);
  END IF;
  IF v_job.salary_group_id IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','job.salary_group','label','Grupo salarial','source','job','sourceId',p_job_id,'section',v_section);
  END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
END $function$;

REVOKE EXECUTE ON FUNCTION public.validate_job_contract_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_job_contract_readiness(uuid) TO authenticated, service_role;

COMMIT;
