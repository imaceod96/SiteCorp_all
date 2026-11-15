-- =============================================================================
-- Migración: 20261115000005_qa_round2_fixes.sql
-- Descripción: Correcciones integrales de la Ronda 2 de QA (SiteCorp)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. #5 — Restaurar y corregir public.prenomina_refresh_workers y prenomina_upsert_inputs
-- =============================================================================

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
      AND (COALESCE(a.end_date, a.scheduled_separation_date) IS NULL OR COALESCE(a.end_date, a.scheduled_separation_date) >= v_month_start)
      AND (
        SELECT count(*)
        FROM public.worker_position_assignments a2
        WHERE a2.worker_id = e.worker_id
          AND a2.start_date <= v_ref
          AND (COALESCE(a2.end_date, a2.scheduled_separation_date) IS NULL OR COALESCE(a2.end_date, a2.scheduled_separation_date) >= v_month_start)
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
          AND ep.hire_date <= LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, v_ref))
          AND (ep.separation_date IS NULL OR ep.separation_date >= GREATEST(v_month_start, a.start_date))
        ORDER BY ep.hire_date DESC
        LIMIT 1
    ) ep ON true
    CROSS JOIN LATERAL (
        SELECT
            GREATEST(v_month_start, a.start_date, COALESCE(ep.hire_date, a.start_date)) AS eff_start,
            LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, ep.separation_date, v_ref)) AS eff_end,
            GREATEST(
                0,
                (LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, ep.separation_date, v_ref))
                 - GREATEST(v_month_start, a.start_date, COALESCE(ep.hire_date, a.start_date)) + 1)
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
                      AND g.d::date <= GREATEST(mc.start_date, (mc.return_date - 1))
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
        FROM (SELECT COALESCE(w.employment_start_date, ep.hire_date, w.hire_date) AS sd) s
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
      AND (COALESCE(a.end_date, a.scheduled_separation_date) IS NULL OR COALESCE(a.end_date, a.scheduled_separation_date) >= v_month_start);

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
              AND (COALESCE(va.end_date, va.scheduled_separation_date) IS NULL OR COALESCE(va.end_date, va.scheduled_separation_date) >= v_month_start)
        ))
        OR
        (e.assignment_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            WHERE va.worker_id = e.worker_id
              AND vp.organization_entity_id = e.organization_entity_id
              AND va.start_date <= v_ref
              AND (COALESCE(va.end_date, va.scheduled_separation_date) IS NULL OR COALESCE(va.end_date, va.scheduled_separation_date) >= v_month_start)
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
          AND ep.hire_date <= LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, v_ref))
          AND (ep.separation_date IS NULL OR ep.separation_date >= GREATEST(v_month_start, a.start_date))
        ORDER BY ep.hire_date DESC
        LIMIT 1
    ) ep ON true
    CROSS JOIN LATERAL (
        SELECT
            GREATEST(v_month_start, a.start_date, COALESCE(ep.hire_date, a.start_date)) AS eff_start,
            LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, ep.separation_date, v_ref)) AS eff_end,
            GREATEST(
                0,
                (LEAST(v_ref, COALESCE(a.end_date, a.scheduled_separation_date, ep.separation_date, v_ref))
                 - GREATEST(v_month_start, a.start_date, COALESCE(ep.hire_date, a.start_date)) + 1)
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
                      AND g.d::date <= GREATEST(mc.start_date, (mc.return_date - 1))
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
        FROM (SELECT COALESCE(w.employment_start_date, ep.hire_date, w.hire_date) AS sd) s
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
      AND (COALESCE(a.end_date, a.scheduled_separation_date) IS NULL OR COALESCE(a.end_date, a.scheduled_separation_date) >= v_month_start)
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
DECLARE
  v_entry public.prenomina_worker_entries%ROWTYPE;
  v_period public.prenomina_periods%ROWTYPE;
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
BEGIN
  SELECT * INTO v_entry FROM public.prenomina_worker_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de prenómina no encontrado'; END IF;
  SELECT * INTO v_period FROM public.prenomina_periods WHERE id = v_entry.period_id;
  IF NOT public.can_access_entity(v_period.organization_entity_id, 'prenomina.manage') THEN
    RAISE EXCEPTION 'Sin permiso para gestionar la prenómina';
  END IF;
  IF v_period.status <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La prenómina está cerrada y no puede editarse';
  END IF;
  IF coalesce(p_worked_days, 0) < 0 THEN
    RAISE EXCEPTION 'Los días trabajados no pueden ser negativos';
  END IF;

  v_month_start := make_date(v_period.period_year, v_period.period_month, 1);
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;
  v_days_in_month := extract(day from v_month_end)::numeric;

  IF coalesce(p_worked_days, 0) > v_days_in_month THEN
    RAISE EXCEPTION 'Los días trabajados (%) no pueden superar los días del mes (%)',
      p_worked_days, v_days_in_month;
  END IF;

  IF v_entry.assignment_id IS NOT NULL THEN
    SELECT a.start_date, COALESCE(a.end_date, a.scheduled_separation_date)
      INTO v_asgn_start, v_asgn_end
    FROM public.worker_position_assignments a
    WHERE a.id = v_entry.assignment_id;
  END IF;

  SELECT ep.hire_date, ep.separation_date
    INTO v_hire_date, v_sep_date
  FROM public.worker_employment_periods ep
  WHERE ep.worker_id = v_entry.worker_id
    AND ep.hire_date <= coalesce(v_asgn_end, v_month_end)
    AND (ep.separation_date IS NULL OR ep.separation_date >= coalesce(v_asgn_start, v_month_start))
  ORDER BY ep.hire_date DESC
  LIMIT 1;

  IF v_hire_date IS NULL THEN
    SELECT w.hire_date INTO v_hire_date FROM public.workers w WHERE w.id = v_entry.worker_id;
  END IF;

  v_eff_start := greatest(v_month_start, coalesce(v_asgn_start, v_hire_date, v_month_start), coalesce(v_hire_date, v_asgn_start, v_month_start));
  v_eff_end := least(v_month_end, coalesce(v_asgn_end, v_sep_date, v_month_end));
  v_max_active_days := CASE
    WHEN v_eff_start > v_eff_end THEN 0
    ELSE (v_eff_end - v_eff_start + 1)::numeric
  END;

  IF coalesce(p_worked_days, 0) > v_max_active_days THEN
    RAISE EXCEPTION 'Los días trabajados (%) no pueden superar los días de alta del trabajador en el período (%)',
      p_worked_days, v_max_active_days;
  END IF;

  IF p_salary_scale_amount IS NOT NULL AND p_salary_scale_amount < 0 THEN
    RAISE EXCEPTION 'El salario escala no puede ser negativo';
  END IF;
  IF p_workday_hours IS NOT NULL AND p_workday_hours <= 0 THEN
    RAISE EXCEPTION 'La jornada debe ser mayor que cero';
  END IF;

  UPDATE public.prenomina_worker_entries SET
    worked_days = coalesce(p_worked_days, 0),
    worked_days_manual = (coalesce(p_worked_days, 0) <> coalesce(proposed_worked_days, -1)),
    max_worked_days = v_max_active_days,
    period_active_start = v_eff_start,
    period_active_end = v_eff_end,
    salary_scale_amount = p_salary_scale_amount,
    workday_hours = p_workday_hours,
    updated_at = now()
  WHERE id = p_entry_id;

  PERFORM public.prenomina_recalc_entry(p_entry_id);
END;
$function$;

-- Limpiar el certificado médico inválido de Ronda 1 (01/11/2026 al 05/11/2026 con 30 días, anterior al alta de Laura)
DELETE FROM public.worker_medical_certificates
WHERE id = 'dcabdeb5-18f5-4885-8a60-56fc60b17c7b';

-- Ejecutar actualización interna de las filas del período Noviembre 2026 de Empresa QA Ficticia
DO $$
DECLARE
  v_period_id uuid := '37f45468-69a6-4b5f-b2eb-8e6be5112861';
  v_admin_id uuid := 'e7062a40-bc05-4ffb-a5a5-ba73d1ab116f';
  v_laura_entry_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.prenomina_periods WHERE id = v_period_id) THEN
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
    PERFORM public.prenomina_refresh_workers(v_period_id);

    -- Conservar los 10 días manuales que tenía Laura Tester pero con proposed_worked_days = 12 (15 - 3 días cert. médico)
    SELECT id INTO v_laura_entry_id
    FROM public.prenomina_worker_entries
    WHERE period_id = v_period_id
      AND worker_id = 'ed88cf62-7dae-46e4-929d-693da4cb10b4'
    LIMIT 1;

    IF v_laura_entry_id IS NOT NULL THEN
      UPDATE public.prenomina_worker_entries
      SET worked_days = 10,
          worked_days_manual = true,
          proposed_worked_days = 12,
          max_worked_days = 15,
          absence_days_in_period = 3
      WHERE id = v_laura_entry_id;
      PERFORM public.prenomina_recalc_entry(v_laura_entry_id);
    END IF;
  END IF;
END $$;

-- =============================================================================
-- 2. N1 / N7 — Completar defaults en get_contract_document_data y limpiar reserva bloqueada
-- =============================================================================

UPDATE public.employment_contracts
SET payment_schedule_text = 'Mensual'
WHERE payment_schedule_text IS NULL OR btrim(payment_schedule_text) = '';

DELETE FROM public.worker_documents
WHERE id = '9e1bcbb5-4ef3-452e-ba5a-eb3998302dbf'
  AND generation_status = 'PROCESSING';

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_contract FROM public.employment_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado';
  END IF;

  IF NOT (public.can_access_entity(v_contract.organization_entity_id, 'workers.view')
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

-- =============================================================================
-- 3. N2 — Alertas de vencimiento contractual con zona horaria America/Havana
-- =============================================================================

CREATE OR REPLACE FUNCTION public.contract_expiry_alerts(
  target_entity_id uuid,
  horizon_days integer DEFAULT 30,
  target_worker_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  worker_id uuid,
  worker_code text,
  worker_name text,
  identification text,
  area_name text,
  job_name text,
  position_name text,
  position_code text,
  contract_id uuid,
  contract_type_name text,
  contract_type_code text,
  contract_start_date date,
  contract_end_date date,
  salary_group_id uuid,
  salary_scale_id uuid,
  salary_group_sequence_number integer,
  days_remaining integer,
  alert_state text,
  assignment_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Havana')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT (public.can_access_entity(target_entity_id, 'contract_alerts.view')
          OR public.can_access_entity(target_entity_id, 'workers.view')
          OR public.can_access_entity(target_entity_id, 'workers.manage')
          OR public.can_access_entity(target_entity_id, 'contracts.view')
          OR public.can_access_entity(target_entity_id, 'contracts.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar los vencimientos contractuales de esta entidad';
  END IF;

  RETURN QUERY
  WITH horizon AS (
    SELECT GREATEST(COALESCE(horizon_days, 30), 0) AS days
  )
  SELECT
    w.id AS worker_id,
    w.code AS worker_code,
    concat_ws(' ', w.first_name, w.first_surname, w.second_surname) AS worker_name,
    w.identification::text AS identification,
    ar.name AS area_name,
    j.name AS job_name,
    p.name AS position_name,
    NULL::text AS position_code,
    c.id AS contract_id,
    ct.name AS contract_type_name,
    ct.code AS contract_type_code,
    c.start_date AS contract_start_date,
    c.end_date AS contract_end_date,
    sg.id AS salary_group_id,
    sg.salary_scale_id AS salary_scale_id,
    sg.sequence_number AS salary_group_sequence_number,
    (c.end_date - v_today)::integer AS days_remaining,
    CASE
      WHEN c.end_date IS NULL THEN 'NO_END_DATE'
      WHEN c.end_date < v_today THEN 'OVERDUE'
      WHEN c.end_date = v_today THEN 'DUE_TODAY'
      WHEN c.end_date <= v_today + 7 THEN 'DUE_IN_7'
      WHEN c.end_date <= v_today + 15 THEN 'DUE_IN_15'
      WHEN c.end_date <= v_today + 30 THEN 'DUE_IN_30'
      ELSE 'DUE_AFTER_30'
    END AS alert_state,
    c.assignment_id AS assignment_id
  FROM public.employment_contracts c
  JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
  JOIN public.workers w ON w.id = c.worker_id
  LEFT JOIN public.worker_position_assignments a ON a.id = c.assignment_id
  LEFT JOIN public.organization_positions p ON p.id = a.position_id
  LEFT JOIN public.organization_jobs j ON j.id = p.job_id
  LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
  LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
  CROSS JOIN horizon h
  WHERE c.is_current = true
    AND c.actual_end_date IS NULL
    AND ct.code = 'DETERMINADO'
    AND w.employment_status = 'active'
    AND w.organization_entity_id = target_entity_id
    AND (target_worker_id IS NULL OR w.id = target_worker_id)
    AND (c.end_date IS NULL OR c.end_date <= v_today + h.days)
  ORDER BY c.end_date ASC NULLS LAST, w.first_surname ASC, w.first_name ASC;
END;
$function$;

-- =============================================================================
-- 4. N3 — Capacitación realizada con fecha futura (triggers en Capacitación y SST)
-- =============================================================================

-- Revertir la sesión futura del 26/11/2026 que se había marcado como REALIZADA en QA
DELETE FROM public.worker_training_records
WHERE session_id = 'f79e6152-889f-4101-94e4-c848c8222bce';

UPDATE public.training_sessions
SET status = 'PROGRAMADA'
WHERE id = 'f79e6152-889f-4101-94e4-c848c8222bce'
  AND scheduled_date > (now() AT TIME ZONE 'America/Havana')::date;

CREATE OR REPLACE FUNCTION public.trg_fn_validate_training_session_not_future()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Havana')::date;
BEGIN
  IF NEW.status IN ('REALIZADA', 'NO_REALIZADA') AND NEW.scheduled_date > v_today THEN
    RAISE EXCEPTION 'No se puede marcar como realizada o no realizada una sesión con fecha programada futura (%). Actualice primero la fecha de la sesión a hoy o una fecha pasada.',
      to_char(NEW.scheduled_date, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_training_session_not_future ON public.training_sessions;
CREATE TRIGGER trg_validate_training_session_not_future
BEFORE INSERT OR UPDATE ON public.training_sessions
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_training_session_not_future();

DROP TRIGGER IF EXISTS trg_validate_sst_training_session_not_future ON public.sst_training_sessions;
CREATE TRIGGER trg_validate_sst_training_session_not_future
BEFORE INSERT OR UPDATE ON public.sst_training_sessions
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_training_session_not_future();

CREATE OR REPLACE FUNCTION public.trg_fn_validate_worker_training_record_not_future()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Havana')::date;
BEGIN
  IF NEW.status = 'RECIBIDA' AND NEW.received_date > v_today THEN
    RAISE EXCEPTION 'No se puede registrar como recibida una capacitación con fecha futura (%).',
      to_char(NEW.received_date, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_worker_training_record_not_future ON public.worker_training_records;
CREATE TRIGGER trg_validate_worker_training_record_not_future
BEFORE INSERT OR UPDATE ON public.worker_training_records
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_worker_training_record_not_future();

DROP TRIGGER IF EXISTS trg_validate_sst_worker_training_record_not_future ON public.sst_worker_training_records;
CREATE TRIGGER trg_validate_sst_worker_training_record_not_future
BEFORE INSERT OR UPDATE ON public.sst_worker_training_records
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_worker_training_record_not_future();

-- =============================================================================
-- 5. N4 — EPP: control de stock >= 0, fecha >= fecha de alta y descuento de stock
-- =============================================================================

-- Limpiar registros inválidos creados en la prueba de QA
DELETE FROM public.sst_worker_epp_deliveries
WHERE id = '4159fc7f-6f82-4b53-a62a-7868032aa6d5';

DELETE FROM public.sst_epp_catalog
WHERE id = '073f1d8a-ad59-4929-a501-5e828481c524';

CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_epp_catalog()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.stock_quantity IS NULL OR NEW.stock_quantity < 0 THEN
    RAISE EXCEPTION 'El stock disponible del EPP no puede ser negativo.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_epp_catalog ON public.sst_epp_catalog;
CREATE TRIGGER trg_validate_sst_epp_catalog
BEFORE INSERT OR UPDATE ON public.sst_epp_catalog
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_epp_catalog();

CREATE OR REPLACE FUNCTION public.trg_fn_validate_and_decrement_sst_epp_delivery()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_catalog public.sst_epp_catalog%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_min_hire_date date;
  v_today date := (now() AT TIME ZONE 'America/Havana')::date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.epp_id IS NOT NULL THEN
      UPDATE public.sst_epp_catalog
      SET stock_quantity = stock_quantity + OLD.quantity,
          updated_at = now()
      WHERE id = OLD.epp_id;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad entregada debe ser mayor que cero.';
  END IF;

  IF NEW.delivery_date > v_today THEN
    RAISE EXCEPTION 'La fecha de entrega (%) no puede ser futura.',
      to_char(NEW.delivery_date, 'DD/MM/YYYY');
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = NEW.worker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El trabajador seleccionado no existe.';
  END IF;

  SELECT MIN(ep.hire_date) INTO v_min_hire_date
  FROM public.worker_employment_periods ep
  WHERE ep.worker_id = NEW.worker_id;

  v_min_hire_date := COALESCE(v_min_hire_date, v_worker.hire_date);

  IF v_min_hire_date IS NOT NULL AND NEW.delivery_date < v_min_hire_date THEN
    RAISE EXCEPTION 'La fecha de entrega (%) no puede ser anterior a la fecha de alta del trabajador (%).',
      to_char(NEW.delivery_date, 'DD/MM/YYYY'),
      to_char(v_min_hire_date, 'DD/MM/YYYY');
  END IF;

  IF NEW.epp_id IS NOT NULL THEN
    SELECT * INTO v_catalog
    FROM public.sst_epp_catalog
    WHERE id = NEW.epp_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El elemento de protección personal (EPP) no existe.';
    END IF;

    IF NEW.quantity > v_catalog.stock_quantity THEN
      RAISE EXCEPTION 'La cantidad entregada (%) supera el stock disponible (%) para "%".',
        NEW.quantity, v_catalog.stock_quantity, v_catalog.name;
    END IF;

    UPDATE public.sst_epp_catalog
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = now()
    WHERE id = NEW.epp_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_and_decrement_sst_epp_delivery ON public.sst_worker_epp_deliveries;
CREATE TRIGGER trg_validate_and_decrement_sst_epp_delivery
BEFORE INSERT OR DELETE ON public.sst_worker_epp_deliveries
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_and_decrement_sst_epp_delivery();

CREATE OR REPLACE FUNCTION public.register_epp_delivery(
  p_entity_id uuid,
  p_worker_id uuid,
  p_worker_name text,
  p_job_id uuid DEFAULT NULL::uuid,
  p_job_name text DEFAULT NULL::text,
  p_epp_id uuid DEFAULT NULL::uuid,
  p_epp_name text DEFAULT ''::text,
  p_quantity integer DEFAULT 1,
  p_delivery_date date DEFAULT NULL::date,
  p_renewal_due_date date DEFAULT NULL::date,
  p_status text DEFAULT 'ENTREGADO'::text,
  p_signed_receipt boolean DEFAULT false,
  p_notes text DEFAULT NULL::text
)
RETURNS public.sst_worker_epp_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Havana')::date;
  v_delivery public.sst_worker_epp_deliveries%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT (public.can_access_entity(p_entity_id, 'sst.manage')
          OR public.can_access_entity(p_entity_id, 'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para registrar entregas de EPP en esta entidad';
  END IF;

  INSERT INTO public.sst_worker_epp_deliveries (
    organization_entity_id,
    worker_id,
    worker_name_snapshot,
    job_id,
    job_name_snapshot,
    epp_id,
    epp_name_snapshot,
    quantity,
    delivery_date,
    renewal_due_date,
    status,
    signed_receipt,
    notes
  ) VALUES (
    p_entity_id,
    p_worker_id,
    btrim(coalesce(p_worker_name, '')),
    p_job_id,
    p_job_name,
    p_epp_id,
    btrim(coalesce(p_epp_name, '')),
    coalesce(p_quantity, 1),
    coalesce(p_delivery_date, v_today),
    p_renewal_due_date,
    coalesce(nullif(btrim(p_status), ''), 'ENTREGADO'),
    coalesce(p_signed_receipt, false),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  RETURNING * INTO v_delivery;

  RETURN v_delivery;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_epp_delivery(uuid, uuid, text, uuid, text, uuid, text, integer, date, date, text, boolean, text) TO authenticated;

-- =============================================================================
-- 5b. B8 — apply_due_scheduled_separations con salida rápida sin escritura cuando no hay bajas vencidas
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
  v_today date := (now() AT TIME ZONE 'America/Havana')::date;
  v_row record;
  v_reason_name text;
  v_remaining integer;
  v_applied integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
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

-- =============================================================================
-- 6. N5 — can_access_entity debe validar el plan contratado ANTES del atajo de SuperAdmin
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_access_entity(
  target_entity_id uuid,
  permission_code text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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

  -- El plan contratado de la entidad limita los módulos habilitados para TODOS los usuarios (incluido SuperAdmin)
  IF permission_code IS NOT NULL
     AND btrim(permission_code) <> ''
     AND NOT public.is_entity_permission_enabled_in_plan(target_entity_id, permission_code) THEN
    RETURN false;
  END IF;

  IF public.is_platform_superadmin() THEN
    RETURN true;
  END IF;

  IF public.platform_role_grants_entity_permission(permission_code) THEN
    RETURN true;
  END IF;

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
       AND NOT public.is_entity_descendant(assignment.organization_entity_id, target_entity_id) THEN
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

-- =============================================================================
-- 7. #24 — Normalizar módulo de auditoría para certificados médicos
-- =============================================================================

UPDATE public.audit_events
SET module = 'medical_certificates'
WHERE action = 'create_worker_medical_certificate'
   OR module IN ('Certificados médicos', 'Licencias y certificados');

-- =============================================================================
-- 8. N8 — Impedir nombres de carpeta duplicados en Documentación General
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_fn_validate_platform_document_folder_name()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    RAISE EXCEPTION 'El nombre de la carpeta es obligatorio.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_document_folders f
    WHERE lower(btrim(f.name)) = lower(btrim(NEW.name))
      AND (TG_OP = 'INSERT' OR f.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'Ya existe una carpeta con ese nombre.';
  END IF;

  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_platform_document_folder_name ON public.platform_document_folders;
CREATE TRIGGER trg_validate_platform_document_folder_name
BEFORE INSERT OR UPDATE ON public.platform_document_folders
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_platform_document_folder_name();

-- =============================================================================
-- 9. N9 — RPC para consultar el correo de los usuarios de plataforma desde auth.users
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_platform_user_emails()
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  RETURN QUERY
  SELECT u.id AS user_id, u.email::text AS email
  FROM auth.users u;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_platform_user_emails() TO authenticated;

-- =============================================================================
-- 10. N10 — Escala salarial presupuestada: limpiar valores de prueba desproporcionados
--           y validar monto máximo (<= 100,000 CUP) y orden creciente entre grupos
-- =============================================================================

-- Normalizar los valores de prueba desproporcionados (23345, 699999, 3000000, 5000000) en la escala presupuestada general
DELETE FROM public.salary_group_values
WHERE id = 'bb4aa754-1e10-41d8-9334-a4ff41a3715c'; -- 23,345 duplicado inactivo en Grupo II

UPDATE public.salary_group_values SET amount = 5060 WHERE id = '81bfea1d-e12b-4896-babb-fc510cff59d3'; -- Grupo III
UPDATE public.salary_group_values SET amount = 5540 WHERE id = 'ce47b97c-325d-4dd3-9b2a-af221b22d78a'; -- Grupo IV
UPDATE public.salary_group_values SET amount = 6050 WHERE id = '007d932d-8443-4e4d-9164-8cf5906a6042'; -- Grupo V
UPDATE public.salary_group_values SET amount = 6610 WHERE id = '42b33def-08a8-4569-8c43-07b9ac94677e'; -- Grupo VI

SELECT public.recompute_salary_group_value_chain('84b341c3-0cdf-48c2-b3f8-420c0bd8067c');
SELECT public.recompute_salary_group_value_chain('77fa61a0-9a18-449a-9aac-1c97027d7f26');
SELECT public.recompute_salary_group_value_chain('7132bb66-f07f-482c-98b3-ab54c6b14fe3');
SELECT public.recompute_salary_group_value_chain('8ff46262-dcb2-4173-badc-a4dc4ca4b7a8');
SELECT public.recompute_salary_group_value_chain('c9cfad04-231e-4ca3-894e-0fc183a1aaf0');
SELECT public.recompute_salary_group_value_chain('8eb38db7-b3f3-4727-85fa-c0389580c9de');

CREATE OR REPLACE FUNCTION public.trg_fn_validate_salary_group_value_bounds()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_group public.salary_groups%ROWTYPE;
  v_prev_amount numeric;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'El monto salarial debe ser mayor que cero.';
  END IF;

  IF NEW.amount > 100000 THEN
    RAISE EXCEPTION 'El monto salarial no puede superar 100,000 CUP.';
  END IF;

  SELECT * INTO v_group
  FROM public.salary_groups
  WHERE id = NEW.salary_group_id;

  IF FOUND AND v_group.sequence_number > 1 AND COALESCE(NEW.is_active, true) = true THEN
    SELECT sgv.amount INTO v_prev_amount
    FROM public.salary_groups prev_g
    JOIN public.salary_group_values sgv ON sgv.salary_group_id = prev_g.id
    WHERE prev_g.salary_scale_id = v_group.salary_scale_id
      AND prev_g.sequence_number = v_group.sequence_number - 1
      AND sgv.is_active = true
      AND sgv.effective_to IS NULL
    ORDER BY sgv.effective_from DESC
    LIMIT 1;

    IF v_prev_amount IS NOT NULL AND NEW.amount < v_prev_amount THEN
      RAISE EXCEPTION 'El monto del grupo (%) no puede ser inferior al monto vigente del grupo inmediato anterior (% CUP).',
        NEW.amount, v_prev_amount;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_salary_group_value_bounds ON public.salary_group_values;
CREATE TRIGGER trg_validate_salary_group_value_bounds
BEFORE INSERT OR UPDATE ON public.salary_group_values
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_salary_group_value_bounds();

-- =============================================================================
-- 11. N12 — Traducir descripción de SuperAdmin en platform_roles
-- =============================================================================

UPDATE public.platform_roles
SET description = 'Administrador de plataforma con acceso total'
WHERE description = 'Platform administrator with full access';

-- =============================================================================
-- 12. N13 — save_entity_plan: exigir motivo cuando se modifica un plan existente
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_entity_plan(
  p_entity_id uuid,
  p_package_prenomina boolean,
  p_package_training_sst boolean,
  p_reason text DEFAULT NULL::text,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entity RECORD;
  v_existing_plan RECORD;
  v_new_combination VARCHAR(50);
  v_old_combination VARCHAR(50);
  v_op_type VARCHAR(20);
  v_added TEXT[] := '{}';
  v_removed TEXT[] := '{}';
  v_plan_id UUID;
  v_user_email TEXT := NULL;
  v_acting_user_id UUID;
  v_result JSONB;
BEGIN
  v_acting_user_id := COALESCE(p_user_id, auth.uid());
  IF v_acting_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_acting_user_id;
  END IF;

  SELECT id, company_client_id, is_sitecorp_account, name
  INTO v_entity
  FROM public.organization_entities
  WHERE id = p_entity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Error: la entidad seleccionada no existe. Debes crearla antes de asignarle un plan.';
  END IF;

  IF v_entity.is_sitecorp_account IS NOT TRUE THEN
    RAISE EXCEPTION 'Error: esta entidad no está registrada como cuenta SiteCorp. No es posible asignarle un plan.';
  END IF;

  IF p_package_prenomina = true AND p_package_training_sst = true THEN
    v_new_combination := 'BASIC_FULL';
  ELSIF p_package_prenomina = true AND p_package_training_sst = false THEN
    v_new_combination := 'BASIC_PRENOMINA';
  ELSIF p_package_prenomina = false AND p_package_training_sst = true THEN
    v_new_combination := 'BASIC_TRAINING_SST';
  ELSE
    v_new_combination := 'BASIC';
  END IF;

  SELECT * INTO v_existing_plan
  FROM public.entity_plans
  WHERE entity_id = p_entity_id
  FOR UPDATE;

  IF FOUND THEN
    v_plan_id := v_existing_plan.id;
    v_old_combination := v_existing_plan.plan_combination;

    IF v_existing_plan.package_prenomina = p_package_prenomina AND
       v_existing_plan.package_training_sst = p_package_training_sst THEN
      SELECT to_jsonb(p) INTO v_result FROM public.entity_plans p WHERE p.id = v_plan_id;
      RETURN v_result;
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RAISE EXCEPTION 'El motivo u observación del cambio es obligatorio.';
    END IF;

    IF (NOT v_existing_plan.package_prenomina) AND p_package_prenomina THEN
      v_added := array_append(v_added, 'Prenómina');
    END IF;
    IF v_existing_plan.package_prenomina AND (NOT p_package_prenomina) THEN
      v_removed := array_append(v_removed, 'Prenómina');
    END IF;

    IF (NOT v_existing_plan.package_training_sst) AND p_package_training_sst THEN
      v_added := array_append(v_added, 'Capacitación y SST');
    END IF;
    IF v_existing_plan.package_training_sst AND (NOT p_package_training_sst) THEN
      v_removed := array_append(v_removed, 'Capacitación y SST');
    END IF;

    IF cardinality(v_removed) > 0 AND cardinality(v_added) = 0 THEN
      v_op_type := 'REDUCCION';
    ELSIF cardinality(v_added) > 0 AND cardinality(v_removed) = 0 THEN
      v_op_type := 'AMPLIACION';
    ELSE
      v_op_type := 'AMPLIACION';
    END IF;

    UPDATE public.entity_plans
    SET
      package_basic = true,
      package_prenomina = p_package_prenomina,
      package_training_sst = p_package_training_sst,
      plan_combination = v_new_combination,
      updated_at = now(),
      updated_by = v_acting_user_id
    WHERE id = v_plan_id;

    INSERT INTO public.entity_plan_history (
      plan_id,
      entity_id,
      operation_type,
      previous_combination,
      new_combination,
      previous_packages,
      new_packages,
      added_packages,
      removed_packages,
      reason,
      changed_by,
      changed_by_email,
      created_at
    ) VALUES (
      v_plan_id,
      p_entity_id,
      v_op_type,
      v_old_combination,
      v_new_combination,
      jsonb_build_object(
        'basic', v_existing_plan.package_basic,
        'prenomina', v_existing_plan.package_prenomina,
        'training_sst', v_existing_plan.package_training_sst
      ),
      jsonb_build_object(
        'basic', true,
        'prenomina', p_package_prenomina,
        'training_sst', p_package_training_sst
      ),
      v_added,
      v_removed,
      btrim(p_reason),
      v_acting_user_id,
      v_user_email,
      now()
    );
  ELSE
    v_op_type := 'CREACION';

    IF p_package_prenomina THEN
      v_added := array_append(v_added, 'Prenómina');
    END IF;
    IF p_package_training_sst THEN
      v_added := array_append(v_added, 'Capacitación y SST');
    END IF;

    INSERT INTO public.entity_plans (
      entity_id,
      company_client_id,
      package_basic,
      package_prenomina,
      package_training_sst,
      plan_combination,
      created_at,
      updated_at,
      created_by,
      updated_by
    ) VALUES (
      p_entity_id,
      v_entity.company_client_id,
      true,
      p_package_prenomina,
      p_package_training_sst,
      v_new_combination,
      now(),
      now(),
      v_acting_user_id,
      v_acting_user_id
    )
    RETURNING id INTO v_plan_id;

    INSERT INTO public.entity_plan_history (
      plan_id,
      entity_id,
      operation_type,
      previous_combination,
      new_combination,
      previous_packages,
      new_packages,
      added_packages,
      removed_packages,
      reason,
      changed_by,
      changed_by_email,
      created_at
    ) VALUES (
      v_plan_id,
      p_entity_id,
      'CREACION',
      NULL,
      v_new_combination,
      NULL,
      jsonb_build_object(
        'basic', true,
        'prenomina', p_package_prenomina,
        'training_sst', p_package_training_sst
      ),
      v_added,
      '{}',
      COALESCE(nullif(btrim(p_reason), ''), 'Asignación de plan inicial de la entidad'),
      v_acting_user_id,
      v_user_email,
      now()
    );
  END IF;

  SELECT to_jsonb(p) INTO v_result FROM public.entity_plans p WHERE p.id = v_plan_id;
  RETURN v_result;
END;
$function$;

-- =============================================================================
-- 13. N14 — Corregir correos @horizonte-demo.cu con letras comidas por tildes
-- =============================================================================

UPDATE public.candidates
SET email = regexp_replace(
              translate(lower(split_part(btrim(first_name), ' ', 1)), 'áéíóúüñ', 'aeiouun'),
              '[^a-z0-9]', '', 'g'
            )
            || '.'
            || regexp_replace(
                 translate(lower(btrim(first_surname)), 'áéíóúüñ', 'aeiouun'),
                 '[^a-z0-9]', '', 'g'
               )
            || '@horizonte-demo.cu'
WHERE email LIKE '%@horizonte-demo.cu';

UPDATE public.workers
SET email = regexp_replace(
              translate(lower(split_part(btrim(first_name), ' ', 1)), 'áéíóúüñ', 'aeiouun'),
              '[^a-z0-9]', '', 'g'
            )
            || '.'
            || regexp_replace(
                 translate(lower(btrim(first_surname)), 'áéíóúüñ', 'aeiouun'),
                 '[^a-z0-9]', '', 'g'
               )
            || '@horizonte-demo.cu'
WHERE email LIKE '%@horizonte-demo.cu';

COMMIT;
