-- ============================================================================
-- QA Fixes #1, #3, #4, #5
--   #1: Aislamiento estricto por entidad en create_document_batches_for_event
--   #3: Certificados médicos — cálculo/validación de días y período laboral
--   #4: Prenómina — tope máximo de días trabajados en mes y período de alta
--   #5: Prenómina — integración automática de asignaciones históricas del mes,
--       días propuestos por alta/baja, certificados médicos y vacaciones
-- ============================================================================

-- ---------------------------------------------------------------------------
-- #1: create_document_batches_for_event(p_event_id uuid, p_entity_id uuid)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_document_batches_for_event(uuid);

CREATE OR REPLACE FUNCTION public.create_document_batches_for_event(
  p_event_id uuid,
  p_entity_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_event public.document_generation_events%rowtype;
  v_rec record;
  v_batch_id uuid;
  v_expected int;
  v_generated int;
  v_failed int;
  v_count int := 0;
  v_scope_entity_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_event from public.document_generation_events where id = p_event_id;
  if not found then
    raise exception 'Evento documental no encontrado';
  end if;

  v_scope_entity_id := coalesce(p_entity_id, v_event.organization_entity_id);

  if p_entity_id is not null
     and v_event.organization_entity_id is not null
     and v_event.organization_entity_id <> p_entity_id then
    raise exception 'El evento documental no pertenece a la entidad indicada';
  end if;

  if v_scope_entity_id is not null then
    if not public.can_access_entity(v_scope_entity_id, 'workers.manage') then
      raise exception 'No tiene permiso para generar lotes de esta entidad';
    end if;
  else
    if not exists (
      select 1
      from public.worker_payroll_movements m
      where m.event_id = p_event_id
        and public.can_access_entity(m.organization_entity_id, 'workers.manage')
    ) then
      raise exception 'No tiene permiso para generar lotes de este evento';
    end if;
  end if;

  -- Reconstrucción idempotente acotada a la entidad solicitada (si aplica).
  if v_scope_entity_id is not null then
    delete from public.document_batches
    where event_id = p_event_id
      and organization_entity_id = v_scope_entity_id;
  else
    delete from public.document_batches
    where event_id = p_event_id
      and public.can_access_entity(organization_entity_id, 'workers.manage');
  end if;

  -- 1) Lote de MOVIMIENTO DE NÓMINA (por entidad, sólo cuando supera 5 documentos).
  for v_rec in
    select m.organization_entity_id as entity_id, count(*)::int as c,
           count(m.worker_document_id)::int as gen
    from public.worker_payroll_movements m
    where m.event_id = p_event_id
      and (v_scope_entity_id is null or m.organization_entity_id = v_scope_entity_id)
      and public.can_access_entity(m.organization_entity_id, 'workers.manage')
    group by m.organization_entity_id
  loop
    if v_rec.c > 5 then
      v_expected := v_rec.c;
      v_generated := v_rec.gen;
      v_failed := v_rec.c - v_rec.gen;

      insert into public.document_batches (
        event_id, organization_entity_id, document_type_code, label,
        status, expected_count, generated_count, failed_count
      ) values (
        p_event_id, v_rec.entity_id, 'PAYROLL_MOVEMENT',
        coalesce(v_event.description, v_event.event_type),
        case when v_failed > 0 then 'ERRORS' else 'READY' end,
        v_expected, v_generated, v_failed
      ) returning id into v_batch_id;

      insert into public.document_batch_items (batch_id, worker_id, worker_document_id, worker_name, status, error)
      select v_batch_id, m.worker_id, m.worker_document_id, m.worker_name_snapshot,
             case when m.worker_document_id is null then 'ERROR' else 'GENERATED' end,
             case when m.worker_document_id is null then 'Documento no generado' else null end
      from public.worker_payroll_movements m
      where m.event_id = p_event_id
        and m.organization_entity_id = v_rec.entity_id;

      v_count := v_count + 1;
    end if;
  end loop;

  -- 2) Lote de ANEXO AL CONTRATO (mismo event_id y misma entidad, lote independiente).
  for v_rec in
    select m.organization_entity_id as entity_id, count(distinct a.id)::int as c,
           count(distinct a.worker_document_id)::int as gen
    from public.worker_payroll_movements m
    join public.contract_addendums a
      on a.worker_id = m.worker_id
     and a.organization_entity_id = m.organization_entity_id
    where m.event_id = p_event_id
      and (v_scope_entity_id is null or m.organization_entity_id = v_scope_entity_id)
      and public.can_access_entity(m.organization_entity_id, 'workers.manage')
      and a.created_at >= (v_event.created_at - interval '15 minutes')
    group by m.organization_entity_id
  loop
    if v_rec.c > 5 then
      v_expected := v_rec.c;
      v_generated := v_rec.gen;
      v_failed := v_rec.c - v_rec.gen;

      insert into public.document_batches (
        event_id, organization_entity_id, document_type_code, label,
        status, expected_count, generated_count, failed_count
      ) values (
        p_event_id, v_rec.entity_id, 'EMPLOYMENT_CONTRACT_ADDENDUM',
        coalesce(v_event.description, v_event.event_type),
        case when v_failed > 0 then 'ERRORS' else 'READY' end,
        v_expected, v_generated, v_failed
      ) returning id into v_batch_id;

      insert into public.document_batch_items (batch_id, worker_id, worker_document_id, worker_name, status, error)
      select v_batch_id, a.worker_id, a.worker_document_id,
             coalesce(a.worker_name_snapshot, w.first_name || ' ' || w.first_surname),
             case when a.worker_document_id is null then 'ERROR' else 'GENERATED' end,
             case when a.worker_document_id is null then 'Documento no generado' else null end
      from public.contract_addendums a
      join public.workers w on w.id = a.worker_id
      where a.organization_entity_id = v_rec.entity_id
        and a.worker_id in (
          select worker_id
          from public.worker_payroll_movements
          where event_id = p_event_id
            and organization_entity_id = v_rec.entity_id
        )
        and a.created_at >= (v_event.created_at - interval '15 minutes');

      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('event_id', p_event_id, 'batches', v_count);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.create_document_batches_for_event(uuid, uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- #3: Validación de certificados médicos en RPCs + trigger de integridad
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_worker_medical_certificate_dates(
  p_worker_id uuid,
  p_start_date date,
  p_return_date date,
  p_days integer
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_expected_days integer;
  v_has_periods boolean;
  v_covered boolean;
  v_hire_date date;
BEGIN
  IF p_start_date IS NULL OR p_return_date IS NULL OR p_days IS NULL THEN
    RAISE EXCEPTION 'La fecha de salida, la fecha de reincorporación y la cantidad de días son obligatorias';
  END IF;

  IF p_return_date <= p_start_date THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior a la fecha de salida';
  END IF;

  v_expected_days := (p_return_date - p_start_date);
  IF v_expected_days <= 0 THEN
    RAISE EXCEPTION 'La cantidad de días debe ser mayor que 0';
  END IF;

  IF p_days <> v_expected_days THEN
    RAISE EXCEPTION 'La cantidad de días (%) debe coincidir con los días entre la fecha de salida y la de reincorporación (%)',
      p_days, v_expected_days;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.worker_employment_periods ep
    WHERE ep.worker_id = p_worker_id
  ) INTO v_has_periods;

  IF v_has_periods THEN
    SELECT EXISTS (
      SELECT 1 FROM public.worker_employment_periods ep
      WHERE ep.worker_id = p_worker_id
        AND p_start_date >= ep.hire_date
        AND (ep.separation_date IS NULL OR p_start_date <= ep.separation_date)
    ) INTO v_covered;

    IF NOT v_covered THEN
      SELECT min(ep.hire_date) INTO v_hire_date
      FROM public.worker_employment_periods ep
      WHERE ep.worker_id = p_worker_id;

      RAISE EXCEPTION 'Las fechas del certificado médico caen fuera del período laboral del trabajador (alta: %)',
        to_char(v_hire_date, 'DD/MM/YYYY');
    END IF;
  ELSE
    SELECT w.hire_date INTO v_hire_date
    FROM public.workers w
    WHERE w.id = p_worker_id;

    IF v_hire_date IS NOT NULL AND p_start_date < v_hire_date THEN
      RAISE EXCEPTION 'La fecha de salida del certificado médico no puede ser anterior a la fecha de alta del trabajador (%)',
        to_char(v_hire_date, 'DD/MM/YYYY');
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_worker_medical_certificate(
  p_tenant_id uuid,
  p_organization_entity_id uuid,
  p_worker_id uuid,
  p_start_date date,
  p_return_date date,
  p_days integer,
  p_document_id uuid,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_id uuid;
  v_tenant_id uuid;
  v_days integer;
BEGIN
  IF p_start_date IS NULL OR p_return_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de salida y la fecha de reincorporación son obligatorias';
  END IF;

  IF p_return_date <= p_start_date THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior a la fecha de salida';
  END IF;

  v_days := coalesce(p_days, (p_return_date - p_start_date));

  IF NOT public.can_access_entity(p_organization_entity_id, 'medical_certificates.manage') THEN
    RAISE EXCEPTION 'Permission denied: medical_certificates.manage is required in this entity';
  END IF;

  SELECT w.company_client_id INTO v_tenant_id
  FROM public.workers w
  WHERE w.id = p_worker_id AND w.organization_entity_id = p_organization_entity_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Worker was not found or does not belong to this entity';
  END IF;

  IF p_tenant_id IS NOT NULL AND p_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'The workspace does not match the worker';
  END IF;

  PERFORM public.validate_worker_medical_certificate_dates(
    p_worker_id,
    p_start_date,
    p_return_date,
    v_days
  );

  IF p_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.worker_documents wd
      WHERE wd.id = p_document_id AND wd.worker_id = p_worker_id
    ) THEN
      RAISE EXCEPTION 'Document was not found or does not belong to this worker';
    END IF;
  END IF;

  INSERT INTO public.worker_medical_certificates (
    company_client_id,
    organization_entity_id,
    worker_id,
    start_date,
    return_date,
    days,
    document_id,
    created_by
  ) VALUES (
    v_tenant_id,
    p_organization_entity_id,
    p_worker_id,
    p_start_date,
    p_return_date,
    v_days,
    p_document_id,
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_worker_medical_certificate(
  p_certificate_id uuid,
  p_start_date date DEFAULT NULL::date,
  p_return_date date DEFAULT NULL::date,
  p_days integer DEFAULT NULL::integer,
  p_document_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_cert public.worker_medical_certificates%ROWTYPE;
  v_next_start date;
  v_next_return date;
  v_next_days integer;
BEGIN
  SELECT * INTO v_cert FROM public.worker_medical_certificates WHERE id = p_certificate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certificate was not found';
  END IF;

  IF NOT public.can_access_entity(v_cert.organization_entity_id, 'medical_certificates.manage') THEN
    RAISE EXCEPTION 'Permission denied: medical_certificates.manage is required in this entity';
  END IF;

  v_next_start := coalesce(p_start_date, v_cert.start_date);
  v_next_return := coalesce(p_return_date, v_cert.return_date);
  v_next_days := coalesce(p_days, (v_next_return - v_next_start));

  PERFORM public.validate_worker_medical_certificate_dates(
    v_cert.worker_id,
    v_next_start,
    v_next_return,
    v_next_days
  );

  IF p_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.worker_documents wd
      WHERE wd.id = p_document_id AND wd.worker_id = v_cert.worker_id
    ) THEN
      RAISE EXCEPTION 'Document was not found or does not belong to this worker';
    END IF;
  END IF;

  UPDATE public.worker_medical_certificates
  SET
    start_date = v_next_start,
    return_date = v_next_return,
    days = v_next_days,
    document_id = coalesce(p_document_id, document_id),
    updated_at = now()
  WHERE id = p_certificate_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_validate_worker_medical_certificate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  PERFORM public.validate_worker_medical_certificate_dates(
    NEW.worker_id,
    NEW.start_date,
    NEW.return_date,
    NEW.days
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_worker_medical_certificates_validate ON public.worker_medical_certificates;
CREATE TRIGGER trg_worker_medical_certificates_validate
BEFORE INSERT OR UPDATE OF worker_id, start_date, return_date, days
ON public.worker_medical_certificates
FOR EACH ROW
EXECUTE FUNCTION public.trg_validate_worker_medical_certificate();


-- ---------------------------------------------------------------------------
-- #4 y #5: Prenómina — columnas de período efectivo/ausencias, integración y topes
-- ---------------------------------------------------------------------------
ALTER TABLE public.prenomina_worker_entries
  ADD COLUMN IF NOT EXISTS period_active_start date,
  ADD COLUMN IF NOT EXISTS period_active_end date,
  ADD COLUMN IF NOT EXISTS max_worked_days numeric(10,2),
  ADD COLUMN IF NOT EXISTS absence_days_in_period numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proposed_worked_days numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worked_days_manual boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.prenomina_refresh_workers(p_period_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_period public.prenomina_periods%ROWTYPE;
    v_scale_id uuid;
    v_month_start date;
    v_ref date;
    v_added integer := 0;
BEGIN
    SELECT * INTO v_period FROM public.prenomina_periods WHERE id = p_period_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Período de prenómina no encontrado'; END IF;
    IF NOT public.can_access_entity(v_period.organization_entity_id, 'prenomina.manage') THEN
        RAISE EXCEPTION 'Sin permiso para gestionar la prenómina';
    END IF;
    IF v_period.status <> 'BORRADOR' THEN
        RAISE EXCEPTION 'La prenómina está cerrada y no puede actualizarse';
    END IF;

    v_month_start := make_date(v_period.period_year, v_period.period_month, 1);
    v_ref := (v_month_start + interval '1 month' - interval '1 day')::date;
    v_scale_id := public.resolve_salary_scale_for_entity(v_period.organization_entity_id);

    -- Enlazar filas heredadas sin assignment_id cuando hay una sola asignación que solapa el mes
    UPDATE public.prenomina_worker_entries e
    SET assignment_id = a.id, employment_contract_id = c.id, updated_at = now()
    FROM public.worker_position_assignments a
    LEFT JOIN LATERAL (
        SELECT c1.id
        FROM public.employment_contracts c1
        WHERE c1.assignment_id = a.id
        ORDER BY c1.is_current DESC, c1.created_at DESC
        LIMIT 1
    ) c ON true
    WHERE e.period_id = v_period.id
      AND e.assignment_id IS NULL
      AND a.worker_id = e.worker_id
      AND a.start_date <= v_ref
      AND (a.end_date IS NULL OR a.end_date >= v_month_start)
      AND (
        SELECT count(*)
        FROM public.worker_position_assignments a2
        WHERE a2.worker_id = e.worker_id
          AND a2.start_date <= v_ref
          AND (a2.end_date IS NULL OR a2.end_date >= v_month_start)
      ) = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.prenomina_worker_entries x
        WHERE x.period_id = e.period_id AND x.assignment_id = a.id AND x.id <> e.id
      );

    -- Actualizar snapshots y calcular ventana activa, ausencias y días propuestos en entradas existentes
    UPDATE public.prenomina_worker_entries e SET
        employment_contract_id = c.id,
        worker_name_snapshot = trim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)),
        identification_snapshot = w.identification,
        area_name_snapshot = ar.name,
        job_name_snapshot = j.name,
        position_name_snapshot = p.name,
        salary_group_id = sg.id,
        salary_group_sequence = sg.sequence_number,
        salary_scale_id = sg.salary_scale_id,
        salary_scale_amount = COALESCE(
            CASE WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                 THEN (SELECT r.amount FROM public.resolve_salary_group_value(sg.id, LEAST(v_ref, win.eff_end)) r)
                 ELSE NULL END,
            c.salary_amount
        ),
        salary_currency = COALESCE(
            CASE WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                 THEN (SELECT r.currency_code FROM public.resolve_salary_group_value(sg.id, LEAST(v_ref, win.eff_end)) r)
                 ELSE NULL END,
            c.salary_currency_code,
            'CUP'
        ),
        workday_hours = p.daily_hours,
        employment_start_date_snapshot = tn.start_date,
        tenure_reference_date = v_ref,
        tenure_years = tn.years,
        tenure_months = tn.months_rem,
        tenure_total_months = CASE WHEN tn.years IS NULL THEN NULL ELSE (tn.years * 12 + tn.months_rem)::numeric(10,2) END,
        tenure_band_id = band.id,
        tenure_band_label = CASE
            WHEN band.id IS NULL THEN NULL
            WHEN band.to_months IS NULL THEN 'Desde ' || trim(to_char(band.from_months, 'FM999999990')) || ' meses'
            ELSE trim(to_char(band.from_months, 'FM999999990')) || '–' || trim(to_char(band.to_months, 'FM999999990')) || ' meses'
        END,
        tenure_base_amount = band.amount,
        tenure_status = CASE WHEN tn.start_date IS NULL THEN 'NO_START_DATE' WHEN band.id IS NULL THEN 'NO_BAND' ELSE 'OK' END,
        has_masters_degree_snapshot = coalesce(w.has_masters_degree, false),
        has_doctorate_degree_snapshot = coalesce(w.has_doctorate_degree, false),
        academic_category = ac.res->>'category',
        academic_monthly_amount = CASE WHEN ac.res->>'amount' IS NULL THEN NULL ELSE (ac.res->>'amount')::numeric END,
        academic_status = CASE
            WHEN ac.res->>'category' IS NULL THEN 'OK'
            WHEN ac.res->>'amount' IS NULL THEN 'NOT_CONFIGURED'
            ELSE 'OK' END,
        cla_day_enabled = CASE WHEN coalesce(j.has_abnormal_conditions, false) THEN coalesce(j.cla_day_enabled, false) ELSE false END,
        cla_day_hourly_rate = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_day_enabled, false) THEN j.cla_day_hourly_rate ELSE NULL END,
        cla_night_enabled = CASE WHEN coalesce(j.has_abnormal_conditions, false) THEN coalesce(j.cla_night_enabled, false) ELSE false END,
        cla_night1_start = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
            THEN (SELECT s.start_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 1) ELSE NULL END,
        cla_night1_end = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
            THEN (SELECT s.end_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 1) ELSE NULL END,
        cla_night1_hourly_rate = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
            THEN (SELECT s.hourly_rate FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 1) ELSE NULL END,
        cla_night2_start = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
            THEN (SELECT s.start_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 2) ELSE NULL END,
        cla_night2_end = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
            THEN (SELECT s.end_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 2) ELSE NULL END,
        cla_night2_hourly_rate = CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
            THEN (SELECT s.hourly_rate FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 2) ELSE NULL END,
        period_active_start = win.eff_start,
        period_active_end = win.eff_end,
        max_worked_days = win.max_active_days,
        absence_days_in_period = calc.absence_days,
        proposed_worked_days = calc.proposed_days,
        worked_days = CASE
            WHEN NOT e.worked_days_manual THEN calc.proposed_days
            ELSE LEAST(e.worked_days, win.max_active_days)
        END,
        updated_at = now()
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    JOIN public.organization_positions p ON p.id = a.position_id AND p.organization_entity_id = w.organization_entity_id
    LEFT JOIN public.organization_jobs j ON j.id = p.job_id
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
            LEAST(v_ref, COALESCE(a.end_date, ep.separation_date, v_ref)) AS eff_end,
            GREATEST(
                0,
                (LEAST(v_ref, COALESCE(a.end_date, ep.separation_date, v_ref))
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
    WHERE e.period_id = v_period.id
      AND e.assignment_id = a.id
      AND a.start_date <= v_ref
      AND (a.end_date IS NULL OR a.end_date >= v_month_start);

    -- Eliminar filas que ya no solapan el período del mes o no pertenecen a la entidad
    DELETE FROM public.prenomina_worker_entries e
    WHERE e.period_id = v_period.id
      AND (
        (e.assignment_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            WHERE va.id = e.assignment_id
              AND vp.organization_entity_id = e.organization_entity_id
              AND va.start_date <= v_ref
              AND (va.end_date IS NULL OR va.end_date >= v_month_start)
        ))
        OR
        (e.assignment_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            WHERE va.worker_id = e.worker_id
              AND vp.organization_entity_id = e.organization_entity_id
              AND va.start_date <= v_ref
              AND (va.end_date IS NULL OR va.end_date >= v_month_start)
        ))
      );

    -- Insertar TODAS las asignaciones (vigentes o cerradas) que solapan el mes del período
    INSERT INTO public.prenomina_worker_entries (
        period_id, organization_entity_id, worker_id, assignment_id, employment_contract_id,
        worker_name_snapshot, identification_snapshot, area_name_snapshot, job_name_snapshot, position_name_snapshot,
        salary_group_id, salary_group_sequence, salary_scale_id, salary_scale_amount, salary_currency, workday_hours,
        worked_days, period_active_start, period_active_end, max_worked_days, absence_days_in_period, proposed_worked_days, worked_days_manual,
        employment_start_date_snapshot, tenure_reference_date, tenure_years, tenure_months, tenure_total_months,
        tenure_band_id, tenure_band_label, tenure_base_amount, tenure_status,
        has_masters_degree_snapshot, has_doctorate_degree_snapshot, academic_category,
        academic_status, academic_monthly_amount,
        cla_day_enabled, cla_day_hourly_rate, cla_night_enabled,
        cla_night1_start, cla_night1_end, cla_night1_hourly_rate,
        cla_night2_start, cla_night2_end, cla_night2_hourly_rate
    )
    SELECT v_period.id, v_period.organization_entity_id, w.id, a.id, c.id,
        trim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)), w.identification,
        ar.name, j.name, p.name, sg.id, sg.sequence_number, sg.salary_scale_id,
        COALESCE(
            CASE WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                 THEN (SELECT r.amount FROM public.resolve_salary_group_value(sg.id, LEAST(v_ref, win.eff_end)) r)
                 ELSE NULL END,
            c.salary_amount
        ),
        COALESCE(
            CASE WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                 THEN (SELECT r.currency_code FROM public.resolve_salary_group_value(sg.id, LEAST(v_ref, win.eff_end)) r)
                 ELSE NULL END,
            c.salary_currency_code,
            'CUP'
        ),
        p.daily_hours,
        calc.proposed_days, win.eff_start, win.eff_end, win.max_active_days, calc.absence_days, calc.proposed_days, false,
        tn.start_date, v_ref, tn.years, tn.months_rem,
        CASE WHEN tn.years IS NULL THEN NULL ELSE (tn.years * 12 + tn.months_rem)::numeric(10,2) END,
        band.id,
        CASE WHEN band.id IS NULL THEN NULL
             WHEN band.to_months IS NULL THEN 'Desde ' || trim(to_char(band.from_months, 'FM999999990')) || ' meses'
             ELSE trim(to_char(band.from_months, 'FM999999990')) || '–' || trim(to_char(band.to_months, 'FM999999990')) || ' meses' END,
        band.amount,
        CASE WHEN tn.start_date IS NULL THEN 'NO_START_DATE' WHEN band.id IS NULL THEN 'NO_BAND' ELSE 'OK' END,
        coalesce(w.has_masters_degree, false), coalesce(w.has_doctorate_degree, false),
        ac.res->>'category',
        CASE WHEN ac.res->>'category' IS NULL THEN 'OK'
             WHEN ac.res->>'amount' IS NULL THEN 'NOT_CONFIGURED'
             ELSE 'OK' END,
        CASE WHEN ac.res->>'amount' IS NULL THEN NULL ELSE (ac.res->>'amount')::numeric END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) THEN coalesce(j.cla_day_enabled, false) ELSE false END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_day_enabled, false) THEN j.cla_day_hourly_rate ELSE NULL END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) THEN coalesce(j.cla_night_enabled, false) ELSE false END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
             THEN (SELECT s.start_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 1) ELSE NULL END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
             THEN (SELECT s.end_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 1) ELSE NULL END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
             THEN (SELECT s.hourly_rate FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 1) ELSE NULL END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
             THEN (SELECT s.start_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 2) ELSE NULL END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
             THEN (SELECT s.end_time FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 2) ELSE NULL END,
        CASE WHEN coalesce(j.has_abnormal_conditions, false) AND coalesce(j.cla_night_enabled, false)
             THEN (SELECT s.hourly_rate FROM public.organization_job_cla_night_segments s WHERE s.organization_job_id = j.id AND s.segment_order = 2) ELSE NULL END
    FROM public.workers w
    JOIN public.worker_position_assignments a ON a.worker_id = w.id
    JOIN public.organization_positions p ON p.id = a.position_id AND p.organization_entity_id = w.organization_entity_id
    LEFT JOIN public.organization_jobs j ON j.id = p.job_id
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
            LEAST(v_ref, COALESCE(a.end_date, ep.separation_date, v_ref)) AS eff_end,
            GREATEST(
                0,
                (LEAST(v_ref, COALESCE(a.end_date, ep.separation_date, v_ref))
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
    PERFORM public.prenomina_recalc_entry(e.id) FROM public.prenomina_worker_entries e WHERE e.period_id = v_period.id;
    RETURN v_added;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prenomina_upsert_inputs(
  p_entry_id uuid,
  p_worked_days numeric,
  p_salary_scale_amount numeric,
  p_workday_hours numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_entry public.prenomina_worker_entries%rowtype;
  v_period public.prenomina_periods%rowtype;
  v_month_start date;
  v_month_end date;
  v_days_in_month numeric;
  v_max_active_days numeric;
  v_asgn_start date;
  v_asgn_end date;
  v_hire_date date;
  v_sep_date date;
  v_eff_start date;
  v_eff_end date;
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
  if coalesce(p_worked_days, 0) < 0 then
    raise exception 'Los días trabajados no pueden ser negativos';
  end if;

  v_month_start := make_date(v_period.period_year, v_period.period_month, 1);
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;
  v_days_in_month := extract(day from v_month_end)::numeric;

  if coalesce(p_worked_days, 0) > v_days_in_month then
    raise exception 'Los días trabajados (%) no pueden superar los días del mes (%)',
      p_worked_days, v_days_in_month;
  end if;

  select w.hire_date into v_hire_date from public.workers w where w.id = v_entry.worker_id;

  if v_entry.assignment_id is not null then
    select a.start_date, a.end_date
      into v_asgn_start, v_asgn_end
    from public.worker_position_assignments a
    where a.id = v_entry.assignment_id;
  end if;

  select ep.separation_date into v_sep_date
  from public.worker_employment_periods ep
  where ep.worker_id = v_entry.worker_id
    and ep.hire_date <= coalesce(v_asgn_end, v_month_end)
    and (ep.separation_date is null or ep.separation_date >= coalesce(v_asgn_start, v_month_start))
  order by ep.hire_date desc
  limit 1;

  v_eff_start := greatest(v_month_start, coalesce(v_asgn_start, v_hire_date, v_month_start));
  v_eff_end := least(v_month_end, coalesce(v_asgn_end, v_sep_date, v_month_end));
  v_max_active_days := case
    when v_eff_start > v_eff_end then 0
    else (v_eff_end - v_eff_start + 1)::numeric
  end;

  if coalesce(p_worked_days, 0) > v_max_active_days then
    raise exception 'Los días trabajados (%) no pueden superar los días de alta del trabajador en el período (%)',
      p_worked_days, v_max_active_days;
  end if;

  if p_salary_scale_amount is not null and p_salary_scale_amount < 0 then
    raise exception 'El salario escala no puede ser negativo';
  end if;
  if p_workday_hours is not null and p_workday_hours <= 0 then
    raise exception 'La jornada debe ser mayor que cero';
  end if;

  update public.prenomina_worker_entries set
    worked_days = coalesce(p_worked_days, 0),
    worked_days_manual = (coalesce(p_worked_days, 0) <> coalesce(proposed_worked_days, -1)),
    max_worked_days = v_max_active_days,
    period_active_start = v_eff_start,
    period_active_end = v_eff_end,
    salary_scale_amount = p_salary_scale_amount,
    workday_hours = p_workday_hours,
    updated_at = now()
  where id = p_entry_id;

  perform public.prenomina_recalc_entry(p_entry_id);
end;
$function$;
