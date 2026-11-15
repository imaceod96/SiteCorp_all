-- ============================================================================
-- QA Medios #15–#19 (y sincronización de prenomina_refresh_workers)
--   #16: Evitar notificaciones duplicadas de capacitación/SST y descartar
--        notificaciones pendientes obsoletas al dar de baja o cambiar de cargo.
--   #17: Impedir registrar capacitaciones (generales o SST) con fecha de
--        recepción anterior a la fecha de alta del trabajador.
--   #18: Incluir movimiento 'ALTA' en la Bitácora laboral
--        (worker_employment_movements) al crear/contratar trabajador y
--        poblar retroactivamente los trabajadores existentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Sincronización de prenomina_refresh_workers (incluye scheduled_separation_date)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prenomina_refresh_workers(p_period_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_period public.prenomina_periods%ROWTYPE;
    v_month_start date;
    v_ref date;
    v_added integer := 0;
BEGIN
    SELECT * INTO v_period FROM public.prenomina_periods WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Período de prenómina no encontrado'; END IF;
    IF NOT public.can_access_entity(v_period.organization_entity_id, 'prenomina.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar la prenómina de esta entidad';
    END IF;
    IF v_period.status <> 'OPEN' THEN
        RAISE EXCEPTION 'El período está cerrado y no admite cambios';
    END IF;

    v_month_start := make_date(v_period.year, v_period.month, 1);
    v_ref := (v_month_start + interval '1 month - 1 day')::date;

    INSERT INTO public.prenomina_worker_entries (
        period_id, worker_id, assignment_id, contract_id,
        worker_code_snapshot, worker_name_snapshot, identification_snapshot,
        position_name_snapshot, job_name_snapshot, area_name_snapshot,
        salary_group_sequence_snapshot,
        base_salary_snapshot, currency_code_snapshot,
        worked_days, absence_days,
        tenure_start_date_snapshot, tenure_years_snapshot, tenure_months_snapshot,
        tenure_Scale_band_id, tenure_band_label_snapshot,
        tenure_payment_type_snapshot, tenure_payment_value_snapshot,
        tenure_amount,
        has_masters_degree_snapshot, has_doctorate_degree_snapshot,
        academic_category_applied_snapshot, academic_payment_type_snapshot,
        academic_payment_value_snapshot, academic_amount
    )
    SELECT
        v_period.id, w.id, a.id, c.id,
        w.code,
        btrim(w.first_name || ' ' || w.first_surname || coalesce(' ' || nullif(btrim(w.second_surname), ''), '')),
        w.identification,
        pos.name, j.name, ar.name,
        sg.sequence_number,
        COALESCE(
            c.salary_amount,
            (SELECT r.amount FROM public.resolve_salary_group_value(sg.id, LEAST(v_ref, COALESCE(a.end_date, v_ref))) r LIMIT 1),
            0
        )::numeric(12,2),
        COALESCE(c.salary_currency_code, 'CUP'),
        calc.proposed_days,
        calc.absence_days,
        tn.start_date, tn.years, tn.months_rem,
        band.id, band.label, band.payment_type, band.payment_value,
        0,
        coalesce(w.has_masters_degree, false),
        coalesce(w.has_doctorate_degree, false),
        ac.res->>'applied_category',
        ac.res->>'payment_type',
        (ac.res->>'payment_value')::numeric,
        coalesce((ac.res->>'monthly_amount')::numeric, 0)
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    LEFT JOIN public.organization_positions pos ON pos.id = a.position_id
    LEFT JOIN public.organization_jobs j ON j.id = pos.job_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
    LEFT JOIN LATERAL (
        SELECT c1.id, c1.salary_amount, c1.salary_currency_code
        FROM public.employment_contracts c1
        WHERE c1.assignment_id = a.id
        ORDER BY c1.is_current DESC, c1.created_at DESC
        LIMIT 1
    ) c ON true
    LEFT JOIN LATERAL (
        SELECT ep.hire_date, ep.separation_date
        FROM public.worker_employment_periods ep
        WHERE ep.worker_id = w.id
          AND ep.hire_date <= LEAST(v_ref, COALESCE(a.end_date, v_ref))
          AND (ep.separation_date IS NULL OR ep.separation_date >= GREATEST(v_month_start, a.start_date))
        ORDER BY ep.hire_date DESC
        LIMIT 1
    ) ep ON true
    CROSS JOIN LATERAL (
        SELECT
            GREATEST(v_month_start, a.start_date, COALESCE(ep.hire_date, w.hire_date, a.start_date)) AS eff_start,
            LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, ep.separation_date, v_ref)) AS eff_end,
            GREATEST(
                0,
                (LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, ep.separation_date, v_ref))
                 - GREATEST(v_month_start, a.start_date, COALESCE(ep.hire_date, w.hire_date, a.start_date)) + 1)
            )::numeric(10,2) AS max_active_days
    ) win
    CROSS JOIN LATERAL (
        SELECT
            coalesce(ab.cnt, 0)::numeric(10,2) AS absence_days,
            GREATEST(0, win.max_active_days - coalesce(ab.cnt, 0))::numeric(10,2) AS proposed_days
        FROM (
            SELECT count(*) AS cnt
            FROM generate_series(win.eff_start, win.eff_end, interval '1 day') AS g(d)
            WHERE win.eff_start <= win.eff_end
              AND (
                EXISTS (
                    SELECT 1 FROM public.worker_medical_certificates mc
                    WHERE mc.worker_id = w.id
                      AND g.d::date >= mc.start_date
                      AND g.d::date < mc.return_date
                )
                OR EXISTS (
                    SELECT 1 FROM public.worker_vacations vv
                    WHERE vv.worker_id = w.id
                      AND vv.status <> 'CANCELLED'
                      AND g.d::date >= vv.start_date
                      AND g.d::date <= vv.end_date
                )
              )
        ) ab
    ) calc
    LEFT JOIN LATERAL (
        SELECT s.sd AS start_date,
               CASE WHEN s.sd IS NOT NULL AND s.sd <= v_ref THEN date_part('year', age(v_ref, s.sd))::int END AS years,
               CASE WHEN s.sd IS NOT NULL AND s.sd <= v_ref THEN date_part('month', age(v_ref, s.sd))::int END AS months_rem
        FROM (SELECT COALESCE(w.employment_start_date, w.hire_date) AS sd) s
    ) tn ON true
    LEFT JOIN LATERAL (
        SELECT t.* FROM public.tenure_payment_scales t
        WHERE tn.years IS NOT NULL AND t.organization_entity_id = v_period.organization_entity_id AND t.is_active = true
          AND (tn.years * 12 + tn.months_rem) >= t.from_months
          AND (t.to_months IS NULL OR (tn.years * 12 + tn.months_rem) < t.to_months)
        ORDER BY t.from_months DESC LIMIT 1
    ) band ON true
    LEFT JOIN LATERAL (
        SELECT public.resolve_academic_category_payment_for_flags(
            v_period.organization_entity_id,
            coalesce(w.has_masters_degree, false),
            coalesce(w.has_doctorate_degree, false)
        ) AS res
    ) ac ON true
    WHERE w.organization_entity_id = v_period.organization_entity_id
      AND a.start_date <= v_ref
      AND (a.end_date IS NULL OR a.end_date >= v_month_start)
      AND win.eff_start <= win.eff_end
      AND NOT EXISTS (
        SELECT 1 FROM public.prenomina_worker_entries x
        WHERE x.period_id = v_period.id AND x.assignment_id = a.id
      );

    GET DIAGNOSTICS v_added = ROW_COUNT;

    PERFORM public.prenomina_recalc_entry(e.id)
    FROM public.prenomina_worker_entries e
    WHERE e.period_id = v_period.id;

    RETURN v_added;
END;
$function$;

-- ----------------------------------------------------------------------------
-- #16: Estados de notificaciones de Capacitación y SST + Triggers sin duplicar
-- ----------------------------------------------------------------------------
ALTER TABLE public.sst_onboarding_notifications
  DROP CONSTRAINT IF EXISTS sst_onboarding_notifications_status_check;

ALTER TABLE public.sst_onboarding_notifications
  ADD CONSTRAINT sst_onboarding_notifications_status_check
  CHECK (status = ANY (ARRAY['PENDIENTE'::text, 'EN_PROCESO'::text, 'COMPLETADA'::text, 'DESCARTADA'::text]));

ALTER TABLE public.training_initial_notifications
  DROP CONSTRAINT IF EXISTS training_initial_notifications_status_check;

ALTER TABLE public.training_initial_notifications
  ADD CONSTRAINT training_initial_notifications_status_check
  CHECK (status = ANY (ARRAY['PENDIENTE'::text, 'COMPLETADA'::text, 'DESCARTADA'::text]));

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

  v_effective_date := COALESCE(NEW.start_date, v_worker.hire_date, CURRENT_DATE);
  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  -- Descartar notificaciones pendientes anteriores de otros cargos que no sean asignaciones vigentes actuales
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

  -- Si ya existe una notificación pendiente para este mismo trabajador y cargo, actualizarla sin duplicar
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

  v_hire_date := COALESCE(NEW.start_date, v_worker.hire_date, CURRENT_DATE);
  v_hire_key  := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_hire_date::text || ':hire';
  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  -- Si ya completó su capacitación inicial en esta entidad, no crear otro aviso inicial
  IF EXISTS (
    SELECT 1 FROM public.training_initial_notifications tin
    WHERE tin.organization_entity_id = v_worker.organization_entity_id
      AND tin.worker_id = v_worker.id
      AND tin.status = 'COMPLETADA'
  ) THEN
    RETURN NEW;
  END IF;

  -- Si existe un aviso PENDIENTE o DESCARTADA, sincronizar área, puesto y fecha vigente sin duplicar
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

-- Actualizar register_worker_separation y apply_due_scheduled_separations para descartar
-- notificaciones pendientes de capacitación/SST cuando el trabajador causa baja efectiva.
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

  -- Si la fecha efectiva es FUTURA, programar la baja sin inactivar ni liberar el puesto todavía
  if p_effective_date > CURRENT_DATE then
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

  -- Fecha efectiva <= CURRENT_DATE: aplicar baja inmediata
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
  v_row record;
  v_reason_name text;
  v_remaining integer;
  v_applied integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
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
      AND a.scheduled_separation_date <= CURRENT_DATE
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        public.can_access_entity(w.organization_entity_id, NULL)
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

-- Saneamiento de notificaciones duplicadas u obsoletas existentes en la base de datos:
-- 1) Descartar notificaciones pendientes de trabajadores inactivos
UPDATE public.sst_onboarding_notifications s
SET status = 'DESCARTADA'
FROM public.workers w
WHERE w.id = s.worker_id
  AND w.employment_status <> 'active'
  AND s.status IN ('PENDIENTE', 'EN_PROCESO');

UPDATE public.training_initial_notifications n
SET status = 'DESCARTADA'
FROM public.workers w
WHERE w.id = n.worker_id
  AND w.employment_status <> 'active'
  AND n.status = 'PENDIENTE';

-- 2) Descartar notificaciones SST pendientes cuyo cargo ya no corresponde al puesto actual del trabajador
UPDATE public.sst_onboarding_notifications s
SET status = 'DESCARTADA'
WHERE s.status IN ('PENDIENTE', 'EN_PROCESO')
  AND NOT EXISTS (
    SELECT 1
    FROM public.worker_position_assignments a
    JOIN public.organization_positions op ON op.id = a.position_id
    WHERE a.worker_id = s.worker_id
      AND a.is_current = true
      AND a.end_date IS NULL
      AND op.job_id IS NOT DISTINCT FROM s.job_id
  );

-- 3) Descartar duplicados de notificaciones SST pendientes para el mismo (organization_entity_id, worker_id, job_id)
WITH ranked_sst AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY organization_entity_id, worker_id, job_id
      ORDER BY
        CASE WHEN trigger_type = 'CAMBIO_CARGO' THEN 0 ELSE 1 END,
        created_at ASC
    ) AS rn
  FROM public.sst_onboarding_notifications
  WHERE status IN ('PENDIENTE', 'EN_PROCESO')
)
UPDATE public.sst_onboarding_notifications s
SET status = 'DESCARTADA'
FROM ranked_sst r
WHERE s.id = r.id
  AND r.rn > 1;

-- 4) Sincronizar el área y puesto actual en notificaciones de capacitación inicial pendientes
UPDATE public.training_initial_notifications n
SET area_id = oa.id,
    area_name = oa.name,
    position_name = op.name,
    hire_date = COALESCE(a.start_date, n.hire_date)
FROM public.worker_position_assignments a
JOIN public.organization_positions op ON op.id = a.position_id
LEFT JOIN public.organization_jobs oj ON oj.id = op.job_id
LEFT JOIN public.organization_areas oa ON oa.id = oj.area_id
WHERE n.worker_id = a.worker_id
  AND n.status = 'PENDIENTE'
  AND a.is_current = true
  AND a.end_date IS NULL;

-- ----------------------------------------------------------------------------
-- #17: Validación de fecha de recepción de capacitación (>= fecha de alta)
-- ----------------------------------------------------------------------------
-- Corregir registro de prueba con fecha anterior al alta antes de activar el trigger
UPDATE public.worker_training_records r
SET received_date = LEAST(
  COALESCE(w.hire_date, w.employment_start_date),
  COALESCE(w.employment_start_date, w.hire_date)
)
FROM public.workers w
WHERE w.id = r.worker_id
  AND r.received_date < LEAST(
    COALESCE(w.hire_date, w.employment_start_date),
    COALESCE(w.employment_start_date, w.hire_date)
  );

UPDATE public.sst_worker_training_records r
SET received_date = LEAST(
  COALESCE(w.hire_date, w.employment_start_date),
  COALESCE(w.employment_start_date, w.hire_date)
)
FROM public.workers w
WHERE w.id = r.worker_id
  AND r.received_date < LEAST(
    COALESCE(w.hire_date, w.employment_start_date),
    COALESCE(w.employment_start_date, w.hire_date)
  );

CREATE OR REPLACE FUNCTION public.validate_worker_training_received_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_min_date date;
BEGIN
  IF NEW.worker_id IS NULL OR NEW.received_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT LEAST(
    COALESCE(w.hire_date, w.employment_start_date),
    COALESCE(w.employment_start_date, w.hire_date)
  )
  INTO v_min_date
  FROM public.workers w
  WHERE w.id = NEW.worker_id;

  IF v_min_date IS NOT NULL AND NEW.received_date < v_min_date THEN
    RAISE EXCEPTION 'La fecha de la capacitación (%) no puede ser anterior a la fecha de alta del trabajador (%)',
      to_char(NEW.received_date, 'DD/MM/YYYY'),
      to_char(v_min_date, 'DD/MM/YYYY');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_worker_training_received_date ON public.worker_training_records;
CREATE TRIGGER trg_validate_worker_training_received_date
  BEFORE INSERT OR UPDATE OF received_date, worker_id ON public.worker_training_records
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_worker_training_received_date();

DROP TRIGGER IF EXISTS trg_validate_sst_worker_training_received_date ON public.sst_worker_training_records;
CREATE TRIGGER trg_validate_sst_worker_training_received_date
  BEFORE INSERT OR UPDATE OF received_date, worker_id ON public.sst_worker_training_records
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_worker_training_received_date();

-- ----------------------------------------------------------------------------
-- #18: Movimiento 'ALTA' en Bitácora laboral (worker_employment_movements)
-- ----------------------------------------------------------------------------
ALTER TABLE public.worker_employment_movements
  DROP CONSTRAINT IF EXISTS worker_employment_movements_movement_type_check;

ALTER TABLE public.worker_employment_movements
  ADD CONSTRAINT worker_employment_movements_movement_type_check
  CHECK (
    movement_type = ANY (
      ARRAY[
        'ALTA'::text,
        'CAMBIO_PUESTO'::text,
        'BAJA'::text,
        'REINCORPORACION'::text,
        'CAMBIO_CONTRATO'::text,
        'PLURIEMPLEO'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.create_worker_with_position(
  p_entity_id uuid,
  p_worker jsonb,
  p_position_id uuid,
  p_hire_date date,
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

  -- Datos personales indispensables para la relación contractual (§25)
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

  IF p_hire_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de incorporación es obligatoria';
  END IF;

  SELECT * INTO v_position FROM public.organization_positions
  WHERE id = p_position_id AND organization_entity_id = p_entity_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El puesto seleccionado no es válido o no está activo en esta entidad';
  END IF;

  -- Integridad estructural del puesto/cargo y datos personales del trabajador
  v_poscard := public.validate_position_contract_readiness(p_position_id);
  v_all_missing := COALESCE(v_poscard->'missing', '[]'::jsonb) || v_person_missing;
  IF jsonb_array_length(v_all_missing) > 0 THEN
    RAISE EXCEPTION '%', public.format_contract_readiness_message(
      v_all_missing, 'No se puede crear el trabajador: faltan datos contractuales obligatorios.');
  END IF;

  -- Control de capacidad: no superar la cantidad autorizada
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

  -- Validar tipo de contrato (catálogo global de SiteCorp)
  IF p_contract_type_id IS NOT NULL THEN
    SELECT * INTO v_contract_type FROM public.employment_contract_types
    WHERE id = p_contract_type_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
    END IF;
    v_contract_start := coalesce(p_contract_start_date, p_hire_date);
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
        p_hire_date, 'active'
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
    VALUES (v_worker_id, p_position_id, p_hire_date, NULL, true)
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
      v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, v_contract_start)
    );
    v_conditions := public.apply_contract_conditions(
      v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
      p_compensation_components, p_representative_assignment_id,
      nullif(btrim(coalesce(p_payment_schedule_text, '')), '')
    );
  END IF;

  -- Registrar el movimiento de ALTA inicial en la Bitácora laboral
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
    p_hire_date,
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

-- Backfill idempotente del movimiento 'ALTA' en worker_employment_movements para trabajadores existentes
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
  created_by,
  created_at
)
SELECT
  w.id,
  'ALTA',
  NULL,
  first_a.id,
  NULL,
  first_c.id,
  COALESCE(w.employment_start_date, w.hire_date, first_a.start_date, CURRENT_DATE),
  COALESCE(first_c.contract_type_name, first_a.position_name, 'Incorporación inicial'),
  NULL,
  first_m.created_by,
  LEAST(w.created_at, COALESCE(first_m.created_at - interval '1 second', w.created_at))
FROM public.workers w
LEFT JOIN LATERAL (
  SELECT a.id, a.start_date, op.name AS position_name
  FROM public.worker_position_assignments a
  LEFT JOIN public.organization_positions op ON op.id = a.position_id
  WHERE a.worker_id = w.id
  ORDER BY a.start_date ASC NULLS LAST, a.created_at ASC
  LIMIT 1
) first_a ON true
LEFT JOIN LATERAL (
  SELECT c.id, ct.name AS contract_type_name
  FROM public.employment_contracts c
  LEFT JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
  WHERE c.worker_id = w.id
    AND (first_a.id IS NULL OR c.assignment_id = first_a.id)
  ORDER BY c.start_date ASC NULLS LAST, c.created_at ASC
  LIMIT 1
) first_c ON true
LEFT JOIN LATERAL (
  SELECT m.created_by, m.created_at
  FROM public.worker_employment_movements m
  WHERE m.worker_id = w.id
  ORDER BY m.created_at ASC
  LIMIT 1
) first_m ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.worker_employment_movements m0
  WHERE m0.worker_id = w.id
    AND m0.movement_type = 'ALTA'
);
