-- =============================================================================
-- Migración: 20261115000006_qa_round3_pendientes.sql
-- Descripción: Resolución de pendientes de QA Round 2 / Round 3 (P2, P3, P4 y datos Prenómina)
-- Reglas:
--   - Zona horaria de negocio: America/Havana (public.cuba_current_date()).
--   - Estado documental en contratos (PENDIENTE | GENERADO | ERROR).
--   - Job diario para bajas programadas vencidas (apply_due_scheduled_separations).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. P2 — Helper SQL canónico public.cuba_current_date() (America/Havana)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cuba_current_date()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE 'America/Havana')::date;
$function$;

GRANT EXECUTE ON FUNCTION public.cuba_current_date() TO anon, authenticated, service_role;

-- Actualizar DEFAULT de columnas de negocio en Capacitación y SST para usar public.cuba_current_date()
ALTER TABLE IF EXISTS public.training_initial_notifications
  ALTER COLUMN hire_date SET DEFAULT public.cuba_current_date();

ALTER TABLE IF EXISTS public.sst_onboarding_notifications
  ALTER COLUMN effective_date SET DEFAULT public.cuba_current_date();

ALTER TABLE IF EXISTS public.sst_risk_matrices
  ALTER COLUMN evaluated_at SET DEFAULT public.cuba_current_date();

ALTER TABLE IF EXISTS public.sst_worker_epp_deliveries
  ALTER COLUMN delivery_date SET DEFAULT public.cuba_current_date();

ALTER TABLE IF EXISTS public.sst_worker_health_surveillance
  ALTER COLUMN evaluation_date SET DEFAULT public.cuba_current_date();

ALTER TABLE IF EXISTS public.sst_work_accidents
  ALTER COLUMN occurred_at SET DEFAULT public.cuba_current_date();

ALTER TABLE IF EXISTS public.sst_committee_records
  ALTER COLUMN record_date SET DEFAULT public.cuba_current_date();

-- =============================================================================
-- 2. P2 — Funciones de negocio actualizadas para usar public.cuba_current_date()
-- =============================================================================

-- 2.1 public.register_worker_separation
CREATE OR REPLACE FUNCTION public.register_worker_separation(
  p_worker_id uuid,
  p_effective_date date,
  p_separation_reason_id uuid,
  p_notes text DEFAULT NULL::text,
  p_target_assignment_id uuid DEFAULT NULL::uuid
)
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
    and a.is_current = true
    and a.end_date is null
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
$function$;

-- 2.2 public.salary_change_impact y public.apply_salary_group_value_change
CREATE OR REPLACE FUNCTION public.salary_change_impact(
  p_salary_group_id uuid,
  p_new_amount numeric,
  p_effective_date date DEFAULT public.cuba_current_date()
)
RETURNS TABLE(
  worker_id uuid,
  worker_code text,
  worker_name text,
  identification text,
  area_name text,
  job_name text,
  position_name text,
  group_sequence_number integer,
  previous_amount numeric,
  currency_code text,
  contract_id uuid,
  contract_start_date date,
  contract_type_name text,
  assignment_id uuid,
  position_id uuid,
  job_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
      ON a.worker_id = w.id AND a.is_current = true AND a.end_date IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.apply_salary_group_value_change(
  p_salary_group_id uuid,
  p_new_amount numeric,
  p_currency_code text DEFAULT NULL::text,
  p_effective_from date DEFAULT public.cuba_current_date(),
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_group public.salary_groups%ROWTYPE;
  v_scale public.salary_scales%ROWTYPE;
  v_existing public.salary_group_values%ROWTYPE;
  v_currency text;
  v_effective date;
  v_prev_amount numeric;
  v_prev_from date;
  v_value_id uuid;
  v_worker record;
  v_future_contract record;
  v_components_total numeric;
  v_entity_id uuid;
  v_has_contract_access boolean := false;
  v_history_id uuid;
  v_addendum_id uuid;
  v_number integer;
  v_totals jsonb;
  v_total_before numeric;
  v_total_after numeric;
  v_history_count integer := 0;
  v_addendum_count integer := 0;
  v_affected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RAISE EXCEPTION 'El nuevo importe debe ser mayor que cero';
  END IF;

  v_effective := COALESCE(p_effective_from, public.cuba_current_date());

  SELECT * INTO v_group FROM public.salary_groups WHERE id = p_salary_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El grupo salarial no existe';
  END IF;
  IF COALESCE(v_group.is_active, false) = false THEN
    RAISE EXCEPTION 'El grupo salarial no está activo';
  END IF;

  SELECT * INTO v_scale FROM public.salary_scales WHERE id = v_group.salary_scale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La escala salarial no existe';
  END IF;
  PERFORM 1 FROM public.salary_groups WHERE id = p_salary_group_id FOR UPDATE;

  IF NOT public.can_manage_salary_scale(v_scale.id) THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar la escala salarial';
  END IF;
  IF COALESCE(v_scale.is_active, false) = false THEN
    RAISE EXCEPTION 'La escala salarial no está activa';
  END IF;

  v_currency := COALESCE(nullif(btrim(coalesce(p_currency_code, '')), ''), v_scale.currency_code, 'CUP');

  SELECT * INTO v_existing FROM public.salary_group_values
  WHERE salary_group_id = p_salary_group_id AND effective_from = v_effective;
  IF FOUND THEN
    IF v_existing.amount = p_new_amount AND v_existing.currency_code = v_currency THEN
      RETURN jsonb_build_object(
        'status', 'UNCHANGED',
        'salary_group_value_id', v_existing.id,
        'salary_group_id', p_salary_group_id,
        'previous_amount', v_existing.amount,
        'new_amount', v_existing.amount,
        'currency_code', v_existing.currency_code,
        'effective_date', v_effective,
        'workers_affected', 0,
        'salary_history_created', 0,
        'addendums_created', 0
      );
    END IF;
    RAISE EXCEPTION 'Ya existe un valor salarial para este grupo con esa fecha de vigencia';
  END IF;

  SELECT r.amount, r.effective_from INTO v_prev_amount, v_prev_from
  FROM public.resolve_salary_group_value(p_salary_group_id, v_effective - 1) r;

  INSERT INTO public.salary_group_values (
    salary_group_id, amount, currency_code, effective_from, effective_to, is_active, created_by
  ) VALUES (
    p_salary_group_id, p_new_amount, v_currency, v_effective, NULL, false, auth.uid()
  ) RETURNING id INTO v_value_id;

  PERFORM public.recompute_salary_group_value_chain(p_salary_group_id);

  FOR v_future_contract IN
    SELECT c.id AS contract_id, c.worker_id, c.start_date
    FROM public.employment_contracts c
    JOIN public.worker_position_assignments a ON a.id = c.assignment_id
    JOIN public.organization_positions p ON p.id = a.position_id
    JOIN public.organization_jobs j ON j.id = p.job_id
    JOIN public.workers w ON w.id = c.worker_id
    CROSS JOIN LATERAL public.resolve_salary_group_value(j.salary_group_id, c.start_date) r
    WHERE c.is_current = true
      AND c.actual_end_date IS NULL
      AND c.start_date > v_effective
      AND w.employment_status = 'active'
      AND j.salary_group_id = p_salary_group_id
      AND public.resolve_salary_scale_for_entity(w.organization_entity_id) = v_scale.id
      AND r.salary_group_value_id = v_value_id
  LOOP
    SELECT COALESCE(SUM(comp.amount), 0) INTO v_components_total
    FROM public.employment_contract_compensation_components comp
    WHERE comp.employment_contract_id = v_future_contract.contract_id
      AND comp.addendum_id IS NULL;

    UPDATE public.employment_contracts
    SET salary_group_value_id = v_value_id,
        salary_amount = p_new_amount,
        salary_currency_code = v_currency,
        total_compensation_snapshot = p_new_amount + COALESCE(v_components_total, 0),
        updated_at = now()
    WHERE id = v_future_contract.contract_id;

    UPDATE public.worker_salary_history
    SET salary_group_value_id = v_value_id,
        new_amount = p_new_amount,
        currency_code = v_currency
    WHERE employment_contract_id = v_future_contract.contract_id
      AND change_type IN ('INITIAL_CONTRACT', 'REINCORPORATION', 'CONTRACT_CHANGE')
      AND effective_date = v_future_contract.start_date;
  END LOOP;

  IF v_prev_amount IS NOT NULL AND v_prev_amount <> p_new_amount THEN
    FOR v_worker IN
      SELECT * FROM public.salary_change_impact(p_salary_group_id, p_new_amount, v_effective)
    LOOP
      v_affected := v_affected + 1;

      v_history_id := public.record_worker_salary_event(
        v_worker.worker_id,
        v_worker.contract_id,
        v_worker.assignment_id,
        p_salary_group_id,
        v_scale.id,
        v_value_id,
        v_worker.previous_amount,
        p_new_amount,
        v_currency,
        v_effective,
        'SALARY_SCALE_CHANGE',
        p_notes
      );

      IF v_history_id IS NOT NULL THEN
        v_history_count := v_history_count + 1;
        v_addendum_id := NULL;

        IF v_worker.contract_id IS NOT NULL THEN
          INSERT INTO public.contract_addendums (
            company_client_id, organization_entity_id, worker_id, employment_contract_id,
            salary_history_id, addendum_type, document_type_id, status, effective_date,
            reason_code, reason, salary_group_id, salary_scale_id,
            previous_amount, new_amount, currency_code,
            position_id, job_id, source_type, source_id, notes, created_by
          )
          SELECT
            w.company_client_id, w.organization_entity_id, v_worker.worker_id, v_worker.contract_id,
            v_history_id, 'SALARY_CHANGE_ADDENDUM', 'CONTRACT_ADDENDUM', 'PENDING_TEMPLATE', v_effective,
            'SALARY_CHANGE', 'Cambio salarial por modificación de la escala',
            p_salary_group_id, v_scale.id,
            v_worker.previous_amount, p_new_amount, v_currency,
            v_worker.position_id, v_worker.job_id,
            'SALARY_SCALE_CHANGE', v_value_id,
            nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
          FROM public.workers w
          WHERE w.id = v_worker.worker_id
          ON CONFLICT DO NOTHING
          RETURNING id INTO v_addendum_id;
        END IF;

        IF v_addendum_id IS NOT NULL THEN
          v_addendum_count := v_addendum_count + 1;
          v_number := public.assign_addendum_number(v_addendum_id);

          SELECT w.organization_entity_id INTO v_entity_id
          FROM public.workers w WHERE w.id = v_worker.worker_id;

          v_has_contract_access :=
            public.can_access_entity(v_entity_id, 'workers.view')
            OR public.can_access_entity(v_entity_id, 'workers.manage');

          IF v_has_contract_access THEN
            v_totals := public.contract_formalized_totals(v_worker.contract_id);
            v_total_before := COALESCE(
              nullif(v_totals->>'total_compensation', '')::numeric,
              COALESCE(v_worker.previous_amount, 0)
            );
            v_total_after := p_new_amount + COALESCE(nullif(v_totals->>'components_total', '')::numeric, 0);
          ELSE
            SELECT COALESCE(ec.total_compensation_snapshot, COALESCE(v_worker.previous_amount, 0))
            INTO v_total_before
            FROM public.employment_contracts ec
            WHERE ec.id = v_worker.contract_id;
            v_total_after := COALESCE(v_total_before, 0) - COALESCE(v_worker.previous_amount, 0) + p_new_amount;
          END IF;

          UPDATE public.contract_addendums
          SET total_before = v_total_before,
              total_after = v_total_after,
              updated_at = now()
          WHERE id = v_addendum_id;

          INSERT INTO public.employment_contract_addendum_changes (
            company_client_id, organization_entity_id, addendum_id, field_code,
            old_value, new_value, old_display_value, new_display_value, display_order
          )
          SELECT
            w.company_client_id, w.organization_entity_id, v_addendum_id, 'SALARY',
            v_worker.previous_amount::text, p_new_amount::text,
            public.format_amount_text(v_worker.previous_amount) || ' ' || v_currency,
            public.format_amount_text(p_new_amount) || ' ' || v_currency,
            6
          FROM public.workers w
          WHERE w.id = v_worker.worker_id;

          INSERT INTO public.employment_contract_addendum_changes (
            company_client_id, organization_entity_id, addendum_id, field_code,
            old_value, new_value, old_display_value, new_display_value, display_order
          )
          SELECT
            w.company_client_id, w.organization_entity_id, v_addendum_id, 'TOTAL_COMPENSATION',
            v_total_before::text, v_total_after::text,
            public.format_amount_text(v_total_before) || ' ' || v_currency,
            public.format_amount_text(v_total_after) || ' ' || v_currency,
            16
          FROM public.workers w
          WHERE w.id = v_worker.worker_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'status', 'APPLIED',
    'salary_group_value_id', v_value_id,
    'salary_group_id', p_salary_group_id,
    'salary_scale_id', v_scale.id,
    'previous_amount', v_prev_amount,
    'previous_effective_from', v_prev_from,
    'new_amount', p_new_amount,
    'currency_code', v_currency,
    'effective_date', v_effective,
    'workers_affected', v_affected,
    'salary_history_created', v_history_count,
    'addendums_created', v_addendum_count
  );
END;
$function$;

-- 2.3 public.handle_worker_sst_assignment_notification y public.handle_worker_hiring_training_notification
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
        AND a2.is_current = true
        AND a2.end_date IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_worker_hiring_training_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_worker record;
  v_pos_name text;
  v_area_id uuid;
  v_area_name text;
  v_hire_date date;
  v_hire_key text;
  v_full_name text;
  v_existing record;
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
    oa.id,
    oa.name
  INTO v_pos_name, v_area_id, v_area_name
  FROM public.organization_positions op
  LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
  LEFT JOIN public.organization_areas oa ON oa.id = oj.area_id
  WHERE op.id = NEW.position_id;

  v_hire_date := COALESCE(NEW.start_date, v_worker.hire_date, public.cuba_current_date());
  v_hire_key  := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_hire_date::text || ':hire';
  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  IF EXISTS (
    SELECT 1 FROM public.training_initial_notifications tin
    WHERE tin.organization_entity_id = v_worker.organization_entity_id
      AND tin.worker_id = v_worker.id
      AND tin.status = 'COMPLETADA'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT tin.id, tin.status
    INTO v_existing
  FROM public.training_initial_notifications tin
  WHERE tin.organization_entity_id = v_worker.organization_entity_id
    AND tin.worker_id = v_worker.id
  ORDER BY tin.created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.training_initial_notifications
    SET area_id = v_area_id,
        area_name = v_area_name,
        position_name = v_pos_name,
        hire_date = v_hire_date,
        worker_name = COALESCE(NULLIF(v_full_name, ''), 'Nuevo trabajador'),
        worker_code = v_worker.code,
        worker_identification = v_worker.identification,
        status = 'PENDIENTE'
    WHERE id = v_existing.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.training_initial_notifications (
    organization_entity_id,
    worker_id,
    hire_key,
    worker_name,
    worker_code,
    worker_identification,
    area_id,
    area_name,
    position_name,
    hire_date,
    status
  )
  VALUES (
    v_worker.organization_entity_id,
    v_worker.id,
    v_hire_key,
    COALESCE(NULLIF(v_full_name, ''), 'Nuevo trabajador'),
    v_worker.code,
    v_worker.identification,
    v_area_id,
    v_area_name,
    v_pos_name,
    v_hire_date,
    'PENDIENTE'
  )
  ON CONFLICT (organization_entity_id, hire_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 2.4 public.create_worker_with_position
CREATE OR REPLACE FUNCTION public.create_worker_with_position(
  p_entity_id uuid,
  p_worker jsonb,
  p_position_id uuid,
  p_hire_date date DEFAULT public.cuba_current_date(),
  p_contract_type_id uuid DEFAULT NULL::uuid,
  p_contract_start_date date DEFAULT NULL::date,
  p_contract_end_date date DEFAULT NULL::date,
  p_representative_assignment_id uuid DEFAULT NULL::uuid,
  p_driving_license_category_ids text[] DEFAULT NULL::text[],
  p_signature_date date DEFAULT NULL::date,
  p_signature_place text DEFAULT NULL::text,
  p_payment_method_id uuid DEFAULT NULL::uuid,
  p_compensation_components jsonb DEFAULT NULL::jsonb,
  p_payment_schedule_text text DEFAULT NULL::text
)
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
    AND a.is_current = true
    AND a.end_date IS NULL
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
$function$;

-- 2.5 public.resolve_entity_representatives
CREATE OR REPLACE FUNCTION public.resolve_entity_representatives(
  p_entity_id uuid,
  p_on_date date DEFAULT public.cuba_current_date()
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
      AND asg.effective_from <= COALESCE(p_on_date, public.cuba_current_date())
      AND (asg.effective_to IS NULL OR asg.effective_to >= COALESCE(p_on_date, public.cuba_current_date()))
    ORDER BY asg.effective_from DESC
    LIMIT 1
  ) a ON true
  WHERE p.organization_entity_id = p_entity_id
    AND p.is_active = true
  ORDER BY p.display_order, p.title
$function$;

-- 2.6 public.resolve_tenure_payment_for_worker
CREATE OR REPLACE FUNCTION public.resolve_tenure_payment_for_worker(
    p_entity_id       uuid,
    p_worker_id       uuid,
    p_reference_date  date DEFAULT public.cuba_current_date()
)
RETURNS TABLE (
    amount             numeric(12,2),
    from_months        numeric(10,2),
    to_months          numeric(10,2),
    years              integer,
    months             integer,
    human_description  text,
    start_date         date,
    total_months       numeric(10,2),
    band_id            uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_start_date date;
    v_ref        date := COALESCE(p_reference_date, public.cuba_current_date());
    v_months     numeric(10,2);
    v_years      integer;
    v_months_int integer;
    v_desc       text;
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.view')
       AND NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para consultar la antigüedad de este trabajador';
    END IF;

    SELECT COALESCE(w.employment_start_date, w.hire_date) INTO v_start_date
    FROM public.workers w
    WHERE w.id = p_worker_id
      AND w.organization_entity_id = p_entity_id;

    IF v_start_date IS NULL OR v_start_date > v_ref THEN
        RETURN QUERY SELECT NULL::numeric(12,2), NULL::numeric(10,2), NULL::numeric(10,2),
                             NULL::integer, NULL::integer, NULL::text, v_start_date,
                             NULL::numeric(10,2), NULL::uuid;
        RETURN;
    END IF;

    v_years      := date_part('year', age(v_ref, v_start_date));
    v_months_int := date_part('month', age(v_ref, v_start_date));
    v_months     := (v_years * 12 + v_months_int)::numeric(10,2);

    IF v_years = 0 AND v_months_int = 0 THEN
        v_desc := 'Menos de 1 mes';
    ELSIF v_years = 0 THEN
        v_desc := format('%s mes(es)', v_months_int);
    ELSIF v_months_int = 0 THEN
        v_desc := format('%s año(s)', v_years);
    ELSE
        v_desc := format('%s año(s) y %s mes(es)', v_years, v_months_int);
    END IF;

    RETURN QUERY
    SELECT
        t.amount,
        t.from_months,
        t.to_months,
        v_years,
        v_months_int,
        v_desc,
        v_start_date,
        v_months,
        t.id
    FROM public.tenure_payment_scales t
    WHERE t.organization_entity_id = p_entity_id
      AND t.is_active = true
      AND v_months >= t.from_months
      AND (t.to_months IS NULL OR v_months < t.to_months)
    ORDER BY t.from_months DESC
    LIMIT 1;
END;
$function$;

-- 2.7 public.migration_validate_rows
CREATE OR REPLACE FUNCTION public.migration_validate_rows(
    p_entity_id uuid,
    p_rows jsonb
)
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
              AND a.is_current = true
              AND a.end_date IS NULL
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
$function$;

GRANT EXECUTE ON FUNCTION public.migration_validate_rows(uuid, jsonb) TO authenticated;

-- 2.8 public.migration_create_worker
CREATE OR REPLACE FUNCTION public.migration_create_worker(
  p_entity_id uuid,
  p_row jsonb,
  p_batch_id text DEFAULT NULL::text
)
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
          AND a.is_current = true
          AND a.end_date IS NULL
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
$function$;

-- 2.9 public.create_contract_addendum
CREATE OR REPLACE FUNCTION public.create_contract_addendum(
  p_worker_id uuid,
  p_changes jsonb,
  p_reason_code text default null,
  p_reason text default null,
  p_effective_date date default null,
  p_notes text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_salary_history_id uuid default null,
  p_addendum_type text default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_representative_assignment_id uuid default null,
  p_require_formalized boolean default false,
  p_components jsonb default null,
  p_total_before numeric default null,
  p_total_after numeric default null,
  p_target_contract_id uuid default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_contract public.employment_contracts%ROWTYPE;
  v_conditions jsonb;
  v_existing public.contract_addendums%ROWTYPE;
  v_addendum_id uuid;
  v_item jsonb;
  v_field text;
  v_code text;
  v_before numeric;
  v_after numeric;
  v_salary numeric;
  v_prev_additional numeric := 0;
  v_prev_abnormal numeric := 0;
  v_prev_other numeric := 0;
  v_new_additional numeric := 0;
  v_new_abnormal numeric := 0;
  v_new_other numeric := 0;
  v_components_count integer := 0;
  v_checklist jsonb;
  v_blocking text[];
  v_status text;
  v_type text;
  v_number integer;
  v_prev_payment uuid;
  v_currency text;
  v_today date := public.cuba_current_date();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'El trabajador es obligatorio';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar anexos de esta entidad';
  END IF;

  IF p_target_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.employment_contracts
    WHERE id = public.resolve_worker_target_contract(p_worker_id, p_target_contract_id)
    FOR UPDATE;
  ELSE
    SELECT * INTO v_contract FROM public.employment_contracts
    WHERE worker_id = p_worker_id AND is_current = true
    ORDER BY start_date DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El trabajador no tiene un contrato vigente sobre el que formalizar el anexo';
  END IF;

  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.contract_addendums
    WHERE employment_contract_id = v_contract.id
      AND source_type = p_source_type
      AND source_id = p_source_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'status', 'ALREADY_EXISTS',
        'addendum_id', v_existing.id,
        'addendum_number', v_existing.addendum_number,
        'addendum_status', v_existing.status,
        'total_after', v_existing.total_after
      );
    END IF;
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'Un anexo debe contener al menos un cambio de condiciones';
  END IF;

  v_code := nullif(btrim(coalesce(p_reason_code, '')), '');

  IF p_source_type IN ('MANUAL', 'MANUAL_COMPENSATION_CHANGE') THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes)
    LOOP
      v_field := upper(btrim(coalesce(v_item->>'field_code', '')));
      IF v_field IN ('AREA', 'JOB', 'POSITION', 'SALARY_GROUP', 'SALARY', 'OCCUPATIONAL_CATEGORY') THEN
        RAISE EXCEPTION 'El campo % no puede modificarse desde un anexo manual: use Cambiar de puesto o la escala salarial', v_field;
      END IF;
    END LOOP;
  END IF;

  v_type := CASE
    WHEN p_addendum_type IS NOT NULL THEN p_addendum_type
    WHEN v_code = 'SALARY_CHANGE' THEN 'SALARY_CHANGE_ADDENDUM'
    ELSE 'CONTRACT_VARIATION_ADDENDUM'
  END;

  IF v_type NOT IN ('SALARY_CHANGE_ADDENDUM', 'CONTRACT_VARIATION_ADDENDUM') THEN
    RAISE EXCEPTION 'El tipo de anexo no es válido';
  END IF;

  v_conditions := public.contract_formalized_conditions(v_contract.id);
  v_salary := nullif(v_conditions->>'salary_amount', '')::numeric;
  v_prev_additional := COALESCE(nullif(v_conditions->>'additional_payment', '')::numeric, 0);
  v_prev_abnormal := COALESCE(nullif(v_conditions->>'abnormal_conditions', '')::numeric, 0);
  v_prev_other := COALESCE(nullif(v_conditions->>'other_payment', '')::numeric, 0);
  v_prev_payment := nullif(v_conditions->>'payment_method_id', '')::uuid;
  v_currency := COALESCE(nullif(v_conditions->>'currency_code', ''), 'CUP');

  IF p_components IS NOT NULL AND jsonb_typeof(p_components) = 'array' THEN
    SELECT COALESCE(SUM(CASE WHEN value->>'component_type' = 'ADDITIONAL_PAYMENT' THEN (value->>'amount')::numeric ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN value->>'component_type' = 'ABNORMAL_CONDITIONS' THEN (value->>'amount')::numeric ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN value->>'component_type' = 'OTHER' THEN (value->>'amount')::numeric ELSE 0 END), 0)
    INTO v_new_additional, v_new_abnormal, v_new_other
    FROM jsonb_array_elements(p_components);

    v_before := COALESCE(nullif(v_conditions->>'total_compensation', '')::numeric,
                         COALESCE(v_salary, 0) + v_prev_additional + v_prev_abnormal + v_prev_other);
    v_after := COALESCE(v_salary, 0) + v_new_additional + v_new_abnormal + v_new_other;
  ELSE
    v_before := p_total_before;
    v_after := p_total_after;
  END IF;

  INSERT INTO public.contract_addendums (
    company_client_id, organization_entity_id, worker_id, employment_contract_id,
    addendum_type, document_type_id, status, effective_date,
    reason_code, reason, notes, source_type, source_id, salary_history_id,
    total_before, total_after, currency_code, created_by
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_contract.id,
    v_type, 'CONTRACT_ADDENDUM', 'PENDING_TEMPLATE',
    COALESCE(p_effective_date, v_today),
    v_code,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_source_type, '')), ''),
    p_source_id,
    p_salary_history_id,
    v_before,
    v_after,
    v_currency,
    auth.uid()
  ) RETURNING id INTO v_addendum_id;

  v_number := public.assign_addendum_number(v_addendum_id);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    v_field := upper(btrim(coalesce(v_item->>'field_code', '')));
    IF v_field = '' THEN
      RAISE EXCEPTION 'Cada cambio del anexo necesita un código de campo';
    END IF;

    INSERT INTO public.employment_contract_addendum_changes (
      company_client_id, organization_entity_id, addendum_id, field_code,
      old_value, new_value, old_display_value, new_display_value,
      old_reference_id, new_reference_id, display_order
    ) VALUES (
      v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, v_field,
      v_item->>'old_value',
      v_item->>'new_value',
      COALESCE(nullif(btrim(coalesce(v_item->>'old_display_value','')), ''), v_item->>'old_value'),
      COALESCE(nullif(btrim(coalesce(v_item->>'new_display_value','')), ''), v_item->>'new_value'),
      nullif(v_item->>'old_reference_id','')::uuid,
      nullif(v_item->>'new_reference_id','')::uuid,
      COALESCE((v_item->>'display_order')::integer, 0) + 1
    );
  END LOOP;

  IF p_components IS NOT NULL AND jsonb_typeof(p_components) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_components)
    LOOP
      v_field := upper(btrim(coalesce(v_item->>'component_type', '')));
      IF v_field NOT IN ('ADDITIONAL_PAYMENT', 'ABNORMAL_CONDITIONS', 'OTHER') THEN
        RAISE EXCEPTION 'El tipo del concepto retributivo no es válido';
      END IF;
      IF btrim(coalesce(v_item->>'description', '')) = '' THEN
        RAISE EXCEPTION 'Cada concepto retributivo necesita una descripción';
      END IF;
      IF (v_item->>'amount') IS NULL
         OR NOT (v_item->>'amount') ~ '^-?[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION 'El importe del concepto retributivo no es válido';
      END IF;
      IF (v_item->>'amount')::numeric < 0 THEN
        RAISE EXCEPTION 'El importe del concepto retributivo no puede ser negativo';
      END IF;

      v_components_count := v_components_count + 1;

      INSERT INTO public.employment_contract_compensation_components (
        employment_contract_id, addendum_id, component_type, description, amount, display_order
      ) VALUES (
        v_contract.id, v_addendum_id, v_field,
        btrim(v_item->>'description'),
        round((v_item->>'amount')::numeric, 2),
        COALESCE((v_item->>'display_order')::integer, v_components_count)
      );
    END LOOP;

    DELETE FROM public.employment_contract_addendum_changes
    WHERE addendum_id = v_addendum_id
      AND field_code IN ('ADDITIONAL_PAYMENT', 'ABNORMAL_CONDITIONS', 'OTHER_PAYMENT', 'TOTAL_COMPENSATION');

    IF v_prev_additional IS DISTINCT FROM v_new_additional THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'ADDITIONAL_PAYMENT',
        v_prev_additional::text, v_new_additional::text,
        public.format_amount_text(v_prev_additional) || ' ' || v_currency,
        public.format_amount_text(v_new_additional) || ' ' || v_currency,
        13
      );
    END IF;

    IF v_prev_abnormal IS DISTINCT FROM v_new_abnormal THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'ABNORMAL_CONDITIONS',
        v_prev_abnormal::text, v_new_abnormal::text,
        public.format_amount_text(v_prev_abnormal) || ' ' || v_currency,
        public.format_amount_text(v_new_abnormal) || ' ' || v_currency,
        14
      );
    END IF;

    IF v_prev_other IS DISTINCT FROM v_new_other THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'OTHER_PAYMENT',
        v_prev_other::text, v_new_other::text,
        public.format_amount_text(v_prev_other) || ' ' || v_currency,
        public.format_amount_text(v_new_other) || ' ' || v_currency,
        15
      );
    END IF;

    IF v_before IS DISTINCT FROM v_after THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'TOTAL_COMPENSATION',
        v_before::text, v_after::text,
        public.format_amount_text(v_before) || ' ' || v_currency,
        public.format_amount_text(v_after) || ' ' || v_currency,
        16
      );
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employment_contract_addendum_changes WHERE addendum_id = v_addendum_id) THEN
    RAISE EXCEPTION 'El anexo no contiene cambios reales de condiciones';
  END IF;

  UPDATE public.contract_addendums SET
    signature_date = p_signature_date,
    signature_place = nullif(btrim(coalesce(p_signature_place, '')), ''),
    updated_at = now()
  WHERE id = v_addendum_id;

  PERFORM public.capture_addendum_party_snapshot(
    v_addendum_id,
    p_representative_assignment_id,
    COALESCE(p_signature_date, COALESCE(p_effective_date, v_today))
  );

  UPDATE public.contract_addendums SET
    payment_method_id = (
      SELECT c.new_reference_id FROM public.employment_contract_addendum_changes c
      WHERE c.addendum_id = v_addendum_id AND c.field_code = 'PAYMENT_METHOD'
    ),
    previous_payment_method_id = CASE
      WHEN EXISTS (SELECT 1 FROM public.employment_contract_addendum_changes c
                   WHERE c.addendum_id = v_addendum_id AND c.field_code = 'PAYMENT_METHOD')
      THEN v_prev_payment
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = v_addendum_id;

  v_checklist := public.pending_addendum_checklist(v_addendum_id);
  v_blocking := ARRAY(SELECT jsonb_array_elements_text(v_checklist->'blocking'));
  v_blocking := array_remove(v_blocking, NULL);

  IF array_length(v_blocking, 1) IS NULL THEN
    UPDATE public.contract_addendums
    SET status = 'FORMALIZED', formalized_by = auth.uid(), formalized_at = now(), updated_at = now()
    WHERE id = v_addendum_id;
    v_status := 'FORMALIZED';
  ELSE
    IF p_require_formalized THEN
      RAISE EXCEPTION 'No se puede formalizar el anexo. Datos pendientes: %',
        array_to_string(v_blocking, ' · ');
    END IF;
    v_status := 'PENDING_TEMPLATE';
  END IF;

  RETURN jsonb_build_object(
    'status', 'CREATED',
    'addendum_id', v_addendum_id,
    'addendum_number', v_number,
    'addendum_status', v_status,
    'employment_contract_id', v_contract.id,
    'changes', (SELECT count(*) FROM public.employment_contract_addendum_changes WHERE addendum_id = v_addendum_id),
    'components', v_components_count,
    'total_before', v_before,
    'total_after', v_after,
    'pending', to_jsonb(v_blocking)
  );
END;
$function$;

-- 2.10 Barrido idempotente sobre cualesquiera funciones restantes en esquema public
--      que aún contengan CURRENT_DATE (incluyendo variantes __pcgate_ y helpers)
DO $$
DECLARE
  rec record;
  v_def text;
  v_new_def text;
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname <> 'cuba_current_date'
      AND pg_get_functiondef(p.oid) ~* '\mCURRENT_DATE\M'
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    v_new_def := regexp_replace(v_def, '\mCURRENT_DATE\M', 'public.cuba_current_date()', 'gi');
    IF v_new_def <> v_def THEN
      EXECUTE v_new_def;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- 3. P3 — Estado documental en public.employment_contracts (PENDIENTE | GENERADO | ERROR)
-- =============================================================================

ALTER TABLE public.employment_contracts
  ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS document_error text,
  ADD COLUMN IF NOT EXISTS document_status_updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employment_contracts_document_status_check'
  ) THEN
    ALTER TABLE public.employment_contracts
      ADD CONSTRAINT employment_contracts_document_status_check
      CHECK (document_status IN ('PENDIENTE', 'GENERADO', 'ERROR'));
  END IF;
END $$;

-- Marcar como GENERADO todos los contratos que ya tienen un documento generado o corresponden a cargo CUADRO
UPDATE public.employment_contracts ec
SET document_status = 'GENERADO',
    document_error = NULL,
    document_status_updated_at = now()
WHERE ec.document_status = 'PENDIENTE'
  AND (
    EXISTS (
      SELECT 1
      FROM public.worker_documents wd
      WHERE wd.employment_contract_id = ec.id
        AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
    )
    OR EXISTS (
      SELECT 1
      FROM public.worker_position_assignments wpa
      JOIN public.organization_positions op ON op.id = wpa.position_id
      JOIN public.organization_jobs oj ON oj.id = op.job_id
      WHERE wpa.id = ec.assignment_id
        AND upper(btrim(COALESCE(oj.occupational_category, ''))) = 'CUADRO'
    )
  );

CREATE OR REPLACE FUNCTION public.set_contract_document_status(
  p_contract_id uuid,
  p_status text,
  p_error text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_contract public.employment_contracts%ROWTYPE;
  v_clean_status text := upper(btrim(COALESCE(p_status, '')));
BEGIN
  IF auth.uid() IS NULL THEN
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

  IF NOT (
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

GRANT EXECUTE ON FUNCTION public.set_contract_document_status(uuid, text, text) TO authenticated;

-- Sincronizar automáticamente employment_contracts.document_status cuando worker_documents cambia
CREATE OR REPLACE FUNCTION public.trg_fn_sync_contract_document_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.employment_contract_id IS NOT NULL THEN
    IF COALESCE(NEW.generation_status, 'COMPLETED') = 'COMPLETED' AND NEW.storage_path IS NOT NULL THEN
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
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_contract_document_status ON public.worker_documents;
CREATE TRIGGER trg_sync_contract_document_status
AFTER INSERT OR UPDATE ON public.worker_documents
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_sync_contract_document_status();

-- =============================================================================
-- 4. P4 — Bajas programadas (apply_due_scheduled_separations) mediante job diario
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_due_scheduled_separations(
  p_entity_id uuid DEFAULT NULL::uuid,
  p_worker_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  v_is_system_call boolean := (
    auth.uid() IS NULL
    AND current_user IN ('postgres', 'supabase_admin', 'service_role')
  );
  v_row record;
  v_reason_name text;
  v_remaining integer;
  v_applied integer := 0;
BEGIN
  IF auth.uid() IS NULL AND NOT v_is_system_call THEN
    RETURN 0;
  END IF;

  -- Salida rápida de solo lectura cuando no existen bajas diferidas vencidas
  IF NOT EXISTS (
    SELECT 1
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.is_current = true
      AND a.end_date IS NULL
      AND a.scheduled_separation_date IS NOT NULL
      AND a.scheduled_separation_date <= v_today
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
  ) THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT a.id AS assignment_id,
           a.worker_id,
           a.position_id,
           a.scheduled_separation_date AS eff_date,
           a.scheduled_separation_reason_id AS reason_id,
           a.scheduled_separation_notes AS notes,
           w.organization_entity_id
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.is_current = true
      AND a.end_date IS NULL
      AND a.scheduled_separation_date IS NOT NULL
      AND a.scheduled_separation_date <= v_today
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY a.scheduled_separation_date ASC
    FOR UPDATE OF a
  LOOP
    SELECT name INTO v_reason_name
    FROM public.worker_separation_reasons
    WHERE id = v_row.reason_id;

    UPDATE public.worker_position_assignments
    SET end_date = v_row.eff_date,
        is_current = false,
        scheduled_separation_date = NULL,
        scheduled_separation_reason_id = NULL,
        scheduled_separation_notes = NULL,
        updated_at = now()
    WHERE id = v_row.assignment_id;

    UPDATE public.employment_contracts
    SET is_current = false,
        actual_end_date = v_row.eff_date,
        updated_at = now()
    WHERE assignment_id = v_row.assignment_id AND is_current = true;

    SELECT count(*) INTO v_remaining
    FROM public.worker_position_assignments a2
    WHERE a2.worker_id = v_row.worker_id
      AND a2.is_current = true
      AND a2.end_date IS NULL
      AND a2.id <> v_row.assignment_id;

    IF v_remaining = 0 THEN
      UPDATE public.workers
      SET employment_status = 'inactive', updated_at = now()
      WHERE id = v_row.worker_id;

      UPDATE public.sst_onboarding_notifications
      SET status = 'DESCARTADA'
      WHERE worker_id = v_row.worker_id
        AND status IN ('PENDIENTE', 'EN_PROCESO');

      UPDATE public.training_initial_notifications
      SET status = 'DESCARTADA'
      WHERE worker_id = v_row.worker_id
        AND status = 'PENDIENTE';
    END IF;

    INSERT INTO public.worker_employment_movements (
      worker_id, movement_type, previous_assignment_id, new_assignment_id,
      effective_date, reason, notes, separation_reason_id, created_by
    ) VALUES (
      v_row.worker_id, 'BAJA', v_row.assignment_id, NULL,
      v_row.eff_date, v_reason_name, v_row.notes, v_row.reason_id, auth.uid()
    );

    PERFORM public.create_payroll_movement(
      v_row.worker_id, 'BAJA', v_row.eff_date,
      v_row.position_id, NULL, v_row.assignment_id, v_row.assignment_id
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN v_applied;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_due_scheduled_separations(uuid, uuid) TO authenticated, service_role;

-- Programar job diario en pg_cron a las 00:05 hora de Cuba (05:05 UTC)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-due-scheduled-separations-daily') THEN
      PERFORM cron.unschedule('apply-due-scheduled-separations-daily');
    END IF;
    PERFORM cron.schedule(
      'apply-due-scheduled-separations-daily',
      '5 5 * * *',
      $cron$SELECT public.apply_due_scheduled_separations();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Si pg_cron no está habilitado en este entorno local, la Edge Function programada actúa como respaldo
  NULL;
END $$;

-- =============================================================================
-- 5. Verificación de datos — Prenómina Noviembre 2026 (Laura Tester)
--    En 20261115000005_qa_round2_fixes.sql (líneas 519-528) se dejó worked_days_manual = true
--    y worked_days = 10 sobre la fila de Laura Tester, lo que impedía que
--    prenomina_refresh_workers aplicara proposed_worked_days = 12 (15 máx - 3 cert. médico).
-- =============================================================================

DO $$
DECLARE
  v_period_id uuid := '37f45468-69a6-4b5f-b2eb-8e6be5112861';
  v_admin_id uuid := 'e7062a40-bc05-4ffb-a5a5-ba73d1ab116f';
  v_laura_entry_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.prenomina_periods WHERE id = v_period_id) THEN
    UPDATE public.prenomina_worker_entries
    SET worked_days_manual = false,
        worked_days = COALESCE(proposed_worked_days, 12)
    WHERE period_id = v_period_id
      AND worker_id = 'ed88cf62-7dae-46e4-929d-693da4cb10b4';

    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
    PERFORM public.prenomina_refresh_workers(v_period_id);

    SELECT id INTO v_laura_entry_id
    FROM public.prenomina_worker_entries
    WHERE period_id = v_period_id
      AND worker_id = 'ed88cf62-7dae-46e4-929d-693da4cb10b4'
    LIMIT 1;

    IF v_laura_entry_id IS NOT NULL THEN
      PERFORM public.prenomina_recalc_entry(v_laura_entry_id);
    END IF;
  END IF;
END $$;

COMMIT;
