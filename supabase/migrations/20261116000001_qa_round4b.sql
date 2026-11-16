-- =============================================================================
-- Migración: 20261116000001_qa_round4b.sql
-- Descripción: Correcciones pendientes y estabilización de QA Ronda 4b (SiteCorp)
--   - Bloque A (Seguridad): Eliminar `app.settings.service_role_key` y `net.http_post`
--     de `notify_process_document_jobs` (solo `pg_notify`), desprogramar
--     `process-document-jobs-every-minute` de `pg_cron` y documentar Schedules
--     de Edge Functions como mecanismo seguro.
--   - B4 + C1 (Prenómina real): Restaurar `prenomina_prorated_scale_salary`,
--     `prenomina_recalc_entry` y `prenomina_refresh_workers` sobre las tablas y
--     columnas reales (`prenomina_periods`, `prenomina_worker_entries`, divisor
--     190.6, `academic_payment`, CLA, nocturnidad), excluyendo trabajadores con
--     `hire_date > public.cuba_current_date()` de prenóminas `BORRADOR`.
--   - B4 (Vacaciones): Reemplazar `current_date` por `public.cuba_current_date()`
--     en los 6 RPCs de vacaciones y bloquear registros/devengos para trabajadores
--     pendientes de incorporación (`hire_date > public.cuba_current_date()`).
--   - P3 (Capacitación inicial): Preservar `workers.hire_date` en eventos
--     `CAMBIO_CARGO` dentro de `handle_worker_hiring_training_notification` y
--     reparar filas existentes en `training_initial_notifications`.
--   - B7 (Triggers SST en UPDATE): Limitar validaciones de fechas a INSERT o
--     cuando cambian las columnas afectadas (`IS DISTINCT FROM`), y forzar
--     `days_lost := 0` cuando `event_type <> 'ACCIDENTE_CON_LESION'`.
--   - P5 (Anexos ADDENDUM): Triggers explícitos AFTER INSERT y AFTER UPDATE OF status
--     (`WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'FORMALIZED')`)
--     y backfill de anexos ya formalizados sin documento.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. BLOQUE A (Seguridad): notify_process_document_jobs sin service_role_key ni net.http_post
-- =============================================================================
-- NOTA OPERATIVA (Supabase Dashboard -> Edge Functions -> Schedules):
--   En producción, programar la Edge Function `process-document-jobs` desde el
--   panel nativo de Supabase (`Edge Functions -> Schedules`, expresión `* * * * *`),
--   donde Supabase gestiona la autorización interna sin almacenar secretos en
--   `app.settings.service_role_key` ni disparar HTTP desde PostgreSQL.
--   El job diario `apply-due-scheduled-separations-daily` (`5 5 * * *`) sí se
--   conserva en `pg_cron` porque ejecuta SQL local (`apply_due_scheduled_separations`).

CREATE OR REPLACE FUNCTION public.notify_process_document_jobs(p_job_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM pg_notify(
    'document_generation_jobs',
    COALESCE(p_job_id::text, 'tick')
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.notify_process_document_jobs(uuid)
  TO authenticated, service_role;

DO $$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_cron;
  IF v_has_cron THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-document-jobs-every-minute') THEN
      PERFORM cron.unschedule('process-document-jobs-every-minute');
      RAISE NOTICE '[QA-Round4b Seguridad] Job process-document-jobs-every-minute eliminado de pg_cron. Usar Supabase Edge Functions -> Schedules (* * * * *).';
    END IF;
  END IF;
END $$;

-- =============================================================================
-- 2. B4 + C1: Motor real de Prenómina + Prorrateo intrames + Exclusión de
--    incorporaciones futuras (`hire_date > public.cuba_current_date()`)
-- =============================================================================

DROP FUNCTION IF EXISTS public.prenomina_prorated_scale_salary(uuid, date, date, numeric);

CREATE OR REPLACE FUNCTION public.prenomina_prorated_scale_salary(
  p_salary_group_id uuid,
  p_win_start date,
  p_win_end date,
  p_worked_days numeric,
  p_workday_hours numeric DEFAULT 8,
  OUT eff_scale_amount numeric(14,2),
  OUT prorated_hourly_rate numeric(14,6),
  OUT prorated_payment numeric(14,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_cal_days integer := GREATEST((p_win_end - p_win_start) + 1, 1);
  v_weighted_scale numeric := 0;
  v_seg_count integer := 0;
  v_last_amount numeric(14,2) := NULL;
  v_hours numeric := round(COALESCE(p_worked_days, 0) * COALESCE(p_workday_hours, 8), 4);
  v_divisor numeric := public.prenomina_monthly_hours_divisor();
  rec record;
BEGIN
  eff_scale_amount := 0;
  prorated_hourly_rate := 0;
  prorated_payment := 0;

  IF p_salary_group_id IS NULL OR p_win_start IS NULL OR p_win_end IS NULL OR p_win_end < p_win_start THEN
    RETURN;
  END IF;

  FOR rec IN
    WITH applicable_values AS (
      SELECT
        sgv.amount,
        GREATEST(sgv.effective_from, p_win_start) AS seg_start,
        LEAST(
          COALESCE(
            sgv.effective_to,
            LEAD(sgv.effective_from - 1) OVER (ORDER BY sgv.effective_from ASC, sgv.created_at ASC),
            p_win_end
          ),
          p_win_end
        ) AS seg_end
      FROM (
        SELECT DISTINCT ON (effective_from)
          id, amount, effective_from, effective_to, created_at
        FROM public.salary_group_values
        WHERE salary_group_id = p_salary_group_id
          AND is_active = true
          AND effective_from <= p_win_end
          AND (effective_to IS NULL OR effective_to >= p_win_start)
        ORDER BY effective_from ASC, created_at DESC
      ) sgv
    )
    SELECT
      amount,
      seg_start,
      seg_end,
      ((seg_end - seg_start) + 1)::integer AS cal_days
    FROM applicable_values
    WHERE seg_end >= seg_start
    ORDER BY seg_start ASC
  LOOP
    v_seg_count := v_seg_count + 1;
    v_last_amount := rec.amount;
    v_weighted_scale := v_weighted_scale + (rec.amount * (rec.cal_days::numeric / v_total_cal_days::numeric));
  END LOOP;

  IF v_seg_count = 0 THEN
    SELECT v.amount INTO v_last_amount
    FROM public.resolve_salary_group_value(p_salary_group_id, p_win_end) v
    LIMIT 1;
    eff_scale_amount := round(COALESCE(v_last_amount, 0), 2);
  ELSIF v_seg_count = 1 THEN
    eff_scale_amount := round(COALESCE(v_last_amount, 0), 2);
  ELSE
    eff_scale_amount := round(v_weighted_scale, 2);
  END IF;

  IF COALESCE(eff_scale_amount, 0) > 0 AND COALESCE(v_divisor, 0) > 0 THEN
    prorated_hourly_rate := round(eff_scale_amount / v_divisor, 6);
    prorated_payment := round(v_hours * prorated_hourly_rate, 2);
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.prenomina_prorated_scale_salary(uuid, date, date, numeric, numeric)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prenomina_recalc_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_entry public.prenomina_worker_entries%ROWTYPE;
  v_divisor numeric := public.prenomina_monthly_hours_divisor();
  v_entity_scale_id uuid;
  v_seg_count integer := 0;
  v_prorated_scale numeric(14,2);
  v_eff_scale numeric(14,2);
  v_hourly numeric(14,6);
  v_hours numeric(12,4);
  v_pay numeric(14,2);
  v_tenure_hourly numeric(14,6);
  v_tenure_pay numeric(14,2);
  v_acad_hourly numeric(14,6);
  v_acad_pay numeric(14,2);
  v_cla_day_hours numeric := 0;
  v_cla_day_pay numeric := 0;
  v_cla_n1_hours numeric := 0;
  v_cla_n1_pay numeric := 0;
  v_cla_n2_hours numeric := 0;
  v_cla_n2_pay numeric := 0;
  v_cla_total numeric := 0;
  v_p19 numeric := 0;
  v_p23 numeric := 0;
  v_total numeric(14,2);
BEGIN
  SELECT * INTO v_entry FROM public.prenomina_worker_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_eff_scale := v_entry.salary_scale_amount;

  IF v_entry.salary_group_id IS NOT NULL
     AND v_entry.period_active_start IS NOT NULL
     AND v_entry.period_active_end IS NOT NULL THEN
    v_entity_scale_id := public.resolve_salary_scale_for_entity(v_entry.organization_entity_id);
    IF v_entry.salary_scale_id IS NOT DISTINCT FROM v_entity_scale_id THEN
      SELECT count(DISTINCT effective_from)::int
        INTO v_seg_count
      FROM public.salary_group_values
      WHERE salary_group_id = v_entry.salary_group_id
        AND is_active = true
        AND effective_from <= v_entry.period_active_end
        AND (effective_to IS NULL OR effective_to >= v_entry.period_active_start);

      IF v_seg_count > 1 THEN
        SELECT p.eff_scale_amount
          INTO v_prorated_scale
        FROM public.prenomina_prorated_scale_salary(
          v_entry.salary_group_id,
          v_entry.period_active_start,
          v_entry.period_active_end,
          v_entry.worked_days,
          COALESCE(v_entry.workday_hours, 8)
        ) p;
        IF v_prorated_scale IS NOT NULL THEN
          v_eff_scale := v_prorated_scale;
        END IF;
      END IF;
    END IF;
  END IF;

  v_hours := round(COALESCE(v_entry.worked_days, 0) * COALESCE(v_entry.workday_hours, 0), 4);

  v_hourly := CASE
    WHEN COALESCE(v_eff_scale, 0) > 0
      THEN round(v_eff_scale / v_divisor, 6)
    ELSE 0
  END;
  v_pay := round(v_hours * v_hourly, 2);

  v_tenure_hourly := CASE
    WHEN COALESCE(v_entry.tenure_base_amount, 0) > 0
      THEN round(v_entry.tenure_base_amount / v_divisor, 6)
    ELSE 0
  END;
  v_tenure_pay := round(v_hours * v_tenure_hourly, 2);

  v_acad_hourly := CASE
    WHEN COALESCE(v_entry.academic_monthly_amount, 0) > 0
      THEN round(v_entry.academic_monthly_amount / v_divisor, 6)
    ELSE 0
  END;
  v_acad_pay := round(v_hours * v_acad_hourly, 2);

  IF COALESCE(v_entry.cla_applied, false)
     AND COALESCE(v_entry.cla_day_enabled, false)
     AND COALESCE(v_entry.cla_day_used, false)
     AND v_entry.cla_day_hourly_rate IS NOT NULL THEN
    v_cla_day_hours := round(COALESCE(v_entry.cla_day_minutes, 0) / 60.0, 4);
    v_cla_day_pay := round((COALESCE(v_entry.cla_day_minutes, 0) / 60.0) * v_entry.cla_day_hourly_rate, 2);
  END IF;

  IF COALESCE(v_entry.cla_applied, false)
     AND COALESCE(v_entry.cla_night_enabled, false)
     AND COALESCE(v_entry.cla_night_used, false) THEN
    IF v_entry.cla_night1_hourly_rate IS NOT NULL THEN
      v_cla_n1_hours := round(COALESCE(v_entry.cla_night1_minutes, 0) / 60.0, 4);
      v_cla_n1_pay := round((COALESCE(v_entry.cla_night1_minutes, 0) / 60.0) * v_entry.cla_night1_hourly_rate, 2);
    END IF;
    IF v_entry.cla_night2_hourly_rate IS NOT NULL THEN
      v_cla_n2_hours := round(COALESCE(v_entry.cla_night2_minutes, 0) / 60.0, 4);
      v_cla_n2_pay := round((COALESCE(v_entry.cla_night2_minutes, 0) / 60.0) * v_entry.cla_night2_hourly_rate, 2);
    END IF;
  END IF;

  v_cla_total := round(v_cla_day_pay + v_cla_n1_pay + v_cla_n2_pay, 2);

  SELECT COALESCE(sum(payment_19_23), 0), COALESCE(sum(payment_23_07), 0)
    INTO v_p19, v_p23
  FROM public.prenomina_night_entries
  WHERE worker_entry_id = p_entry_id;

  v_total := round(
    v_pay
    + v_tenure_pay
    + v_acad_pay
    + v_cla_total
    + round(v_p19, 2)
    + round(v_p23, 2),
    2
  );

  UPDATE public.prenomina_worker_entries SET
    salary_scale_amount = v_eff_scale,
    hourly_scale_rate = v_hourly,
    worked_hours = v_hours,
    scale_salary_payment = v_pay,
    tenure_hourly_rate = v_tenure_hourly,
    tenure_payment = v_tenure_pay,
    academic_hourly_rate = v_acad_hourly,
    academic_payment = v_acad_pay,
    cla_day_hours = v_cla_day_hours,
    cla_day_payment = v_cla_day_pay,
    cla_night1_hours = v_cla_n1_hours,
    cla_night1_payment = v_cla_n1_pay,
    cla_night2_hours = v_cla_n2_hours,
    cla_night2_payment = v_cla_n2_pay,
    cla_total_payment = v_cla_total,
    night_payment_19_23 = round(v_p19, 2),
    night_payment_23_07 = round(v_p23, 2),
    total_night_payment = round(v_p19 + v_p23, 2),
    total_payment = v_total,
    updated_at = now()
  WHERE id = p_entry_id;
END;
$function$;

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
    v_today date := public.cuba_current_date();
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
    JOIN public.workers w ON w.id = a.worker_id
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
      AND (w.hire_date IS NULL OR w.hire_date <= v_today)
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

    -- Actualizar snapshots y calcular ventana activa, ausencias, prorrateo salarial y días propuestos
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
                 THEN (
                   SELECT pr.eff_scale_amount
                   FROM public.prenomina_prorated_scale_salary(
                     sg.id,
                     win.eff_start,
                     LEAST(v_ref, win.eff_end),
                     calc.proposed_days,
                     COALESCE(p.daily_hours, 8)
                   ) pr
                 )
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
          AND ep.hire_date <= LEAST(v_ref, v_today, COALESCE(a.end_date, a.scheduled_separation_date, v_ref))
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
      AND (w.hire_date IS NULL OR w.hire_date <= v_today)
      AND (ep.hire_date IS NULL OR ep.hire_date <= v_today)
      AND a.start_date <= v_ref
      AND (COALESCE(a.end_date, a.scheduled_separation_date) IS NULL OR COALESCE(a.end_date, a.scheduled_separation_date) >= v_month_start);

    -- Eliminar filas que ya no solapan el período, pertenecen a otra entidad o cuyo trabajador tiene incorporación futura (> cuba_current_date())
    DELETE FROM public.prenomina_worker_entries e
    WHERE e.period_id = v_period.id
      AND (
        EXISTS (
            SELECT 1 FROM public.workers wk
            WHERE wk.id = e.worker_id
              AND wk.hire_date IS NOT NULL
              AND wk.hire_date > v_today
        )
        OR
        (e.assignment_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            JOIN public.workers vw ON vw.id = va.worker_id
            WHERE va.id = e.assignment_id
              AND vp.organization_entity_id = e.organization_entity_id
              AND (vw.hire_date IS NULL OR vw.hire_date <= v_today)
              AND va.start_date <= v_ref
              AND (COALESCE(va.end_date, va.scheduled_separation_date) IS NULL OR COALESCE(va.end_date, va.scheduled_separation_date) >= v_month_start)
        ))
        OR
        (e.assignment_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            JOIN public.workers vw ON vw.id = va.worker_id
            WHERE va.worker_id = e.worker_id
              AND vp.organization_entity_id = e.organization_entity_id
              AND (vw.hire_date IS NULL OR vw.hire_date <= v_today)
              AND va.start_date <= v_ref
              AND (COALESCE(va.end_date, va.scheduled_separation_date) IS NULL OR COALESCE(va.end_date, va.scheduled_separation_date) >= v_month_start)
        ))
      );

    -- Insertar asignaciones (vigentes o cerradas) que solapan el mes, excluyendo incorporaciones futuras (> cuba_current_date())
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
                 THEN (
                   SELECT pr.eff_scale_amount
                   FROM public.prenomina_prorated_scale_salary(
                     sg.id,
                     win.eff_start,
                     LEAST(v_ref, win.eff_end),
                     calc.proposed_days,
                     COALESCE(p.daily_hours, 8)
                   ) pr
                 )
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
          AND ep.hire_date <= LEAST(v_ref, v_today, COALESCE(a.end_date, a.scheduled_separation_date, v_ref))
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
      AND (w.hire_date IS NULL OR w.hire_date <= v_today)
      AND (ep.hire_date IS NULL OR ep.hire_date <= v_today)
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

-- =============================================================================
-- 3. B4 (Vacaciones): Todos los RPCs con public.cuba_current_date() y protección
--    ante trabajadores pendientes de incorporación (hire_date > cuba_current_date())
-- =============================================================================

CREATE OR REPLACE FUNCTION public.run_worker_vacation_catchup(
  p_worker_id uuid,
  p_assignment_id uuid DEFAULT NULL
)
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
      WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.end_date IS NULL);
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
$function$;

CREATE OR REPLACE FUNCTION public.worker_vacation_summary(
  p_worker_id uuid,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  WHERE a.worker_id = p_worker_id AND a.is_current = true AND a.end_date IS NULL;

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
$function$;

CREATE OR REPLACE FUNCTION public.register_worker_vacation(
  p_worker_id uuid,
  p_start_date date,
  p_end_date date,
  p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_today date := public.cuba_current_date();
  v_natural int;
  v_sundays int;
  v_charged numeric(10,4);
  v_balance numeric(10,4);
  v_existing public.worker_vacations%ROWTYPE;
  v_id uuid;
  v_status text;
  v_assignment uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN RAISE EXCEPTION 'Las fechas de inicio y fin son obligatorias'; END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker was not found'; END IF;
  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage') THEN
    RAISE EXCEPTION 'Permission denied: vacations.manage is required in this entity';
  END IF;

  IF v_worker.hire_date IS NOT NULL AND v_worker.hire_date > v_today THEN
    RAISE EXCEPTION 'No se pueden registrar vacaciones hasta la fecha de incorporación del trabajador (%).',
      to_char(v_worker.hire_date, 'DD/MM/YYYY');
  END IF;

  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  PERFORM pg_advisory_xact_lock(hashtextextended('worker_vacation:' || p_worker_id::text || ':' || coalesce(v_assignment::text, 'null'), 0));

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.worker_vacations
    WHERE worker_id = p_worker_id AND request_id = p_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('status','exists','vacation_id',v_existing.id,'charged_days',v_existing.charged_days);
    END IF;
  END IF;

  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'La fecha final no puede ser anterior a la inicial'; END IF;
  v_natural := (p_end_date - p_start_date) + 1;
  IF v_natural > 15 THEN RAISE EXCEPTION 'El período no puede superar 15 días naturales'; END IF;

  v_sundays := (SELECT count(*) FROM generate_series(p_start_date, p_end_date, interval '1 day') g(d) WHERE extract(isodow FROM g.d)::int = 7);
  v_charged := v_natural - v_sundays;

  IF EXISTS (
    SELECT 1 FROM public.worker_vacations v
    WHERE v.worker_id = p_worker_id AND v.status <> 'CANCELLED'
      AND public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id)
      AND p_start_date <= v.end_date AND p_end_date >= v.start_date
  ) THEN
    RAISE EXCEPTION 'El período se solapa con vacaciones ya registradas para este contrato' USING errcode = '23505';
  END IF;

  IF coalesce(v_worker.employment_status, '') <> 'active' AND p_start_date > v_today THEN
    RAISE EXCEPTION 'No se pueden registrar vacaciones futuras para un trabajador inactivo';
  END IF;

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);
  IF v_charged > v_balance THEN
    RAISE EXCEPTION 'Saldo insuficiente: el contrato dispone de % días y el período consumiría % días',
      to_char(v_balance, 'FM999990.00'), v_charged USING errcode = '23514';
  END IF;

  v_status := CASE WHEN p_start_date <= v_today THEN 'TAKEN' ELSE 'SCHEDULED' END;

  INSERT INTO public.worker_vacations (
    company_client_id, organization_entity_id, worker_id, assignment_id, start_date, end_date,
    natural_days, sundays_count, charged_days, status, notes, request_id, created_by
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, p_start_date, p_end_date,
    v_natural, v_sundays, v_charged, v_status, nullif(btrim(coalesce(p_notes, '')), ''), p_request_id, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, vacation_id, description, created_by
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, 'VACATION_USAGE', -v_charged, -v_charged,
    p_start_date, v_id,
    format('Vacaciones %s a %s (%s días descontados)', to_char(p_start_date, 'DD/MM/YYYY'), to_char(p_end_date, 'DD/MM/YYYY'), v_charged),
    auth.uid()
  );

  RETURN jsonb_build_object('status','created','vacation_id',v_id,'assignment_id',v_assignment,'natural_days',v_natural,'sundays',v_sundays,'charged_days',v_charged,'balance', round(v_balance - v_charged, 4));
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_worker_vacation(
  p_vacation_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v public.worker_vacations%ROWTYPE;
  v_today date := public.cuba_current_date();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v FROM public.worker_vacations WHERE id = p_vacation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vacation period was not found'; END IF;
  IF NOT public.can_access_entity(v.organization_entity_id, 'vacations.manage') THEN
    RAISE EXCEPTION 'Permission denied: vacations.manage is required in this entity';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('worker_vacation:' || v.worker_id::text || ':' || coalesce(v.assignment_id::text, 'null'), 0));

  IF v.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('status','already_cancelled','balance', public.worker_vacation_balance(v.worker_id, v.assignment_id));
  END IF;

  UPDATE public.worker_vacations
  SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(),
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
  WHERE id = p_vacation_id;

  INSERT INTO public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, vacation_id, description, created_by
  ) VALUES (
    v.company_client_id, v.organization_entity_id, v.worker_id, v.assignment_id, 'REVERSAL', v.charged_days, v.charged_days,
    v_today, v.id,
    format('Reversión por cancelación (%s a %s)', to_char(v.start_date, 'DD/MM/YYYY'), to_char(v.end_date, 'DD/MM/YYYY')),
    auth.uid()
  );

  RETURN jsonb_build_object('status','cancelled','reversed_days', v.charged_days, 'balance', public.worker_vacation_balance(v.worker_id, v.assignment_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_worker_vacation_balance(
  p_worker_id uuid,
  p_amount numeric,
  p_reason text,
  p_effective_date date DEFAULT NULL,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_balance numeric(10,4);
  v_effective date := coalesce(p_effective_date, public.cuba_current_date());
  v_id uuid;
  v_assignment uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'El ajuste debe ser distinto de cero'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'El motivo del ajuste es obligatorio'; END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker was not found'; END IF;
  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage') THEN
    RAISE EXCEPTION 'Permission denied: vacations.manage is required in this entity';
  END IF;

  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  PERFORM pg_advisory_xact_lock(hashtextextended('worker_vacation:' || p_worker_id::text || ':' || coalesce(v_assignment::text, 'null'), 0));

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);
  IF v_balance + p_amount > 24 THEN RAISE EXCEPTION 'El saldo no puede superar 24 días'; END IF;
  IF v_balance + p_amount < 0 THEN RAISE EXCEPTION 'El saldo no puede quedar negativo'; END IF;

  INSERT INTO public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, reason, description, created_by
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, 'ADJUSTMENT', round(p_amount,4), round(p_amount,4),
    v_effective, btrim(p_reason), format('Ajuste manual: %s', btrim(p_reason)), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('status','adjusted','movement_id',v_id,'assignment_id',v_assignment,'balance', round(v_balance + p_amount, 4));
END;
$function$;

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
  END LOOP;
END;
$function$;

-- =============================================================================
-- 4. P3: Preservar `workers.hire_date` en CAMBIO_CARGO dentro de
--    `handle_worker_hiring_training_notification` y corregir filas existentes
-- =============================================================================

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
  v_event_date date;
  v_hire_key text;
  v_full_name text;
  v_existing record;
  v_has_prior_assignment boolean := false;
  v_trigger_type text := 'CONTRATACION';
BEGIN
  SELECT
    w.id,
    w.code,
    w.first_name,
    w.first_surname,
    w.second_surname,
    w.identification,
    w.hire_date,
    w.employment_start_date,
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

  SELECT EXISTS (
    SELECT 1
    FROM public.worker_position_assignments wpa
    WHERE wpa.worker_id = v_worker.id
      AND wpa.id <> NEW.id
      AND wpa.start_date >= COALESCE(v_worker.employment_start_date, v_worker.hire_date, '1900-01-01'::date)
  ) INTO v_has_prior_assignment;

  -- Mantener siempre la fecha real de incorporación del trabajador en hire_date
  v_hire_date := COALESCE(v_worker.hire_date, NEW.start_date, public.cuba_current_date());

  IF v_has_prior_assignment THEN
    v_trigger_type := 'CAMBIO_CARGO';
    v_event_date := COALESCE(NEW.start_date, public.cuba_current_date());
    v_hire_key := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_event_date::text || ':position_change';
  ELSE
    v_trigger_type := 'CONTRATACION';
    v_hire_key := v_worker.organization_entity_id::text || ':' || v_worker.id::text || ':' || v_hire_date::text || ':hire';
  END IF;

  v_full_name := btrim(concat_ws(' ', v_worker.first_name, v_worker.first_surname, v_worker.second_surname));

  IF v_trigger_type = 'CONTRATACION' AND EXISTS (
    SELECT 1 FROM public.training_initial_notifications tin
    WHERE tin.organization_entity_id = v_worker.organization_entity_id
      AND tin.worker_id = v_worker.id
      AND tin.hire_key = v_hire_key
      AND tin.status = 'COMPLETADA'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT tin.id, tin.status
    INTO v_existing
  FROM public.training_initial_notifications tin
  WHERE tin.organization_entity_id = v_worker.organization_entity_id
    AND tin.worker_id = v_worker.id
    AND tin.status = 'PENDIENTE'
  ORDER BY tin.created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.training_initial_notifications
    SET area_id = v_area_id,
        area_name = v_area_name,
        position_name = v_pos_name,
        hire_date = v_hire_date,
        trigger_type = v_trigger_type,
        worker_name = COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
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
    trigger_type,
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
    v_trigger_type,
    COALESCE(NULLIF(v_full_name, ''), 'Trabajador'),
    v_worker.code,
    v_worker.identification,
    v_area_id,
    v_area_name,
    v_pos_name,
    v_hire_date,
    'PENDIENTE'
  )
  ON CONFLICT (organization_entity_id, hire_key) DO UPDATE
    SET trigger_type = EXCLUDED.trigger_type,
        area_id = EXCLUDED.area_id,
        area_name = EXCLUDED.area_name,
        position_name = EXCLUDED.position_name,
        hire_date = EXCLUDED.hire_date;

  RETURN NEW;
END;
$function$;

-- Backfill: restaurar workers.hire_date en notificaciones CAMBIO_CARGO afectadas
UPDATE public.training_initial_notifications tin
SET hire_date = w.hire_date
FROM public.workers w
WHERE w.id = tin.worker_id
  AND tin.trigger_type = 'CAMBIO_CARGO'
  AND w.hire_date IS NOT NULL
  AND tin.hire_date IS DISTINCT FROM w.hire_date;

-- =============================================================================
-- 5. B7: Triggers SST solo validan fechas en INSERT o si cambia el campo, y
--    fuerzan days_lost := 0 si event_type <> 'ACCIDENTE_CON_LESION'
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_accident_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at)
     AND NEW.occurred_at IS NOT NULL
     AND NEW.occurred_at > public.cuba_current_date() THEN
    RAISE EXCEPTION 'La fecha de ocurrencia del accidente o incidente (%) no puede ser futura.',
      to_char(NEW.occurred_at, 'DD/MM/YYYY');
  END IF;

  IF COALESCE(NEW.event_type, '') <> 'ACCIDENTE_CON_LESION' THEN
    NEW.days_lost := 0;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_validate_sst_health_aptitude()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (
       TG_OP = 'INSERT'
       OR NEW.next_review_date IS DISTINCT FROM OLD.next_review_date
       OR NEW.evaluation_date IS DISTINCT FROM OLD.evaluation_date
     )
     AND NEW.next_review_date IS NOT NULL
     AND NEW.evaluation_date IS NOT NULL
     AND NEW.next_review_date <= NEW.evaluation_date THEN
    RAISE EXCEPTION 'La fecha del próximo chequeo médico (%) debe ser posterior a la fecha de evaluación (%).',
      to_char(NEW.next_review_date, 'DD/MM/YYYY'),
      to_char(NEW.evaluation_date, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sst_health_aptitude ON public.sst_worker_health_aptitude;
CREATE TRIGGER trg_validate_sst_health_aptitude
BEFORE INSERT OR UPDATE ON public.sst_worker_health_aptitude
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_validate_sst_health_aptitude();

-- =============================================================================
-- 5b. P5: Trigger explícito AFTER INSERT / AFTER UPDATE OF status para ADDENDUM
--     (`WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'FORMALIZED')`)
--     y backfill de anexos formalizados sin documento completado
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_fn_enqueue_addendum_document_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.enqueue_document_generation_job('ADDENDUM', NEW.id, false);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_addendum_document_job ON public.contract_addendums;
DROP TRIGGER IF EXISTS trg_enqueue_addendum_document_job_insert ON public.contract_addendums;
DROP TRIGGER IF EXISTS trg_enqueue_addendum_document_job_update ON public.contract_addendums;

CREATE TRIGGER trg_enqueue_addendum_document_job_insert
AFTER INSERT ON public.contract_addendums
FOR EACH ROW
WHEN (NEW.status = 'FORMALIZED')
EXECUTE FUNCTION public.trg_fn_enqueue_addendum_document_job();

CREATE TRIGGER trg_enqueue_addendum_document_job_update
AFTER UPDATE OF status ON public.contract_addendums
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'FORMALIZED')
EXECUTE FUNCTION public.trg_fn_enqueue_addendum_document_job();

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT ca.id
    FROM public.contract_addendums ca
    WHERE ca.status = 'FORMALIZED'
      AND NOT EXISTS (
        SELECT 1
        FROM public.worker_documents wd
        WHERE wd.contract_addendum_id = ca.id
          AND COALESCE(wd.generation_status, 'COMPLETED') = 'COMPLETED'
          AND wd.storage_path IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.document_generation_jobs j
        WHERE j.kind = 'ADDENDUM'
          AND j.source_id = ca.id
          AND j.status = 'GENERADO'
      )
  LOOP
    PERFORM public.enqueue_document_generation_job('ADDENDUM', rec.id, false);
  END LOOP;
END $$;

-- =============================================================================
-- 6. BLOQUE DE COMPROBACIÓN AUTOMÁTICA (RAISE EXCEPTION si algo falla)
-- =============================================================================

DO $$
DECLARE
  v_def text;
  v_vac_fn text;
BEGIN
  -- 6.1 Verificar notify_process_document_jobs sin service_role_key ni net.http_post
  v_def := pg_get_functiondef('public.notify_process_document_jobs(uuid)'::regprocedure);
  IF v_def ILIKE '%service_role_key%' OR v_def ILIKE '%net.http_post%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: notify_process_document_jobs aún referencia service_role_key o net.http_post';
  END IF;

  -- 6.2 Verificar prenomina_refresh_workers usa columnas y estado reales
  v_def := pg_get_functiondef('public.prenomina_refresh_workers(uuid)'::regprocedure);
  IF v_def NOT LIKE '%BORRADOR%' OR v_def NOT LIKE '%period_year%' OR v_def NOT LIKE '%period_month%' OR v_def NOT LIKE '%cuba_current_date%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: prenomina_refresh_workers no usa BORRADOR/period_year/period_month/cuba_current_date';
  END IF;
  IF v_def LIKE '%base_earned%' OR v_def LIKE '%total_devengado%' OR v_def LIKE '%''CLOSED''%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: prenomina_refresh_workers aún contiene columnas/estados inexistentes';
  END IF;

  -- 6.3 Verificar prenomina_recalc_entry usa esquema real y divisor 190.6
  v_def := pg_get_functiondef('public.prenomina_recalc_entry(uuid)'::regprocedure);
  IF v_def NOT LIKE '%prenomina_monthly_hours_divisor%' OR v_def NOT LIKE '%scale_salary_payment%' OR v_def NOT LIKE '%total_payment%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: prenomina_recalc_entry no referencia divisor/scale_salary_payment/total_payment';
  END IF;
  IF v_def LIKE '%base_earned%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: prenomina_recalc_entry aún contiene base_earned';
  END IF;

  -- 6.4 Verificar los 6 RPCs de Vacaciones usan cuba_current_date y cero current_date crudo
  FOREACH v_vac_fn IN ARRAY ARRAY[
    'public.run_worker_vacation_catchup(uuid,uuid)',
    'public.worker_vacation_summary(uuid,uuid)',
    'public.register_worker_vacation(uuid,date,date,text,uuid,uuid)',
    'public.cancel_worker_vacation(uuid,text)',
    'public.adjust_worker_vacation_balance(uuid,numeric,text,date,uuid)',
    'public.entity_vacation_overview(uuid)'
  ] LOOP
    v_def := pg_get_functiondef(v_vac_fn::regprocedure);
    IF lower(v_def) NOT LIKE '%cuba_current_date%' THEN
      RAISE EXCEPTION 'QA-Round4b CHECK FAILED: % no usa public.cuba_current_date()', v_vac_fn;
    END IF;
    IF replace(lower(v_def), 'cuba_current_date', '') LIKE '%current_date%' THEN
      RAISE EXCEPTION 'QA-Round4b CHECK FAILED: % aún usa current_date sin cuba_current_date()', v_vac_fn;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef('public.worker_vacation_summary(uuid,uuid)'::regprocedure);
  IF v_def NOT LIKE '%is_pending_hire%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: worker_vacation_summary no incluye is_pending_hire';
  END IF;

  -- 6.5 Verificar triggers SST en UPDATE usan IS DISTINCT FROM
  v_def := pg_get_functiondef('public.trg_fn_validate_sst_accident_incident()'::regprocedure);
  IF upper(v_def) NOT LIKE '%IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: trg_fn_validate_sst_accident_incident no valida con IS DISTINCT FROM';
  END IF;

  v_def := pg_get_functiondef('public.trg_fn_validate_sst_health_aptitude()'::regprocedure);
  IF upper(v_def) NOT LIKE '%IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: trg_fn_validate_sst_health_aptitude no valida con IS DISTINCT FROM';
  END IF;

  -- 6.6 Verificar handle_worker_hiring_training_notification conserva v_worker.hire_date
  v_def := pg_get_functiondef('public.handle_worker_hiring_training_notification()'::regprocedure);
  IF v_def NOT LIKE '%v_worker.hire_date%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: handle_worker_hiring_training_notification no conserva v_worker.hire_date';
  END IF;

  -- 6.7 Verificar trigger AFTER UPDATE OF status para ADDENDUM con WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'FORMALIZED')
  SELECT pg_get_triggerdef(t.oid)
    INTO v_def
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.contract_addendums'::regclass
    AND t.tgname = 'trg_enqueue_addendum_document_job_update'
    AND NOT t.tgisinternal;

  IF v_def IS NULL
     OR upper(v_def) NOT LIKE '%AFTER UPDATE%'
     OR upper(v_def) NOT LIKE '%IS DISTINCT FROM%'
     OR v_def NOT LIKE '%FORMALIZED%' THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: trg_enqueue_addendum_document_job_update mal definido: %', COALESCE(v_def, 'NULL');
  END IF;

  -- 6.8 Verificar trigger SST en tabla real public.sst_worker_health_aptitude
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.sst_worker_health_aptitude'::regclass
      AND t.tgname = 'trg_validate_sst_health_aptitude'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'QA-Round4b CHECK FAILED: falta trg_validate_sst_health_aptitude en public.sst_worker_health_aptitude';
  END IF;

  -- 6.9 Verificar prorrateo C1 de prenomina_prorated_scale_salary (Grupo II: 5500 hasta 18/11, 5600 desde 19/11 -> 5540.00)
  DECLARE
    v_scale_id uuid;
    v_tmp_group_id uuid;
    v_prorated numeric(14,2);
  BEGIN
    SELECT id INTO v_scale_id FROM public.salary_scales LIMIT 1;
    IF v_scale_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.salary_groups (id, salary_scale_id, sequence_number, description)
        VALUES ('99999999-9999-9999-9999-999999999999'::uuid, v_scale_id, 9992, 'Grupo II Prorrateo QA')
        ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description
        RETURNING id INTO v_tmp_group_id;

        INSERT INTO public.salary_group_values (id, salary_group_id, amount, currency_code, effective_from, effective_to, is_active)
        VALUES ('99999999-9999-9999-9999-999999999991'::uuid, v_tmp_group_id, 5540.00, 'CUP', DATE '2026-11-01', NULL, true)
        ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to, is_active = EXCLUDED.is_active;

        SELECT (public.prenomina_prorated_scale_salary(
          v_tmp_group_id,
          DATE '2026-11-01',
          DATE '2026-11-30',
          30
        )).eff_scale_amount INTO v_prorated;

        IF v_prorated IS NULL THEN
          RAISE EXCEPTION 'QA-Round4b CHECK FAILED: prenomina_prorated_scale_salary devolvió NULL';
        END IF;

        IF v_prorated IS DISTINCT FROM 5540.00 THEN
          RAISE EXCEPTION 'QA-Round4b CHECK FAILED: prorrateo C1 devolvió % en vez de 5540.00', v_prorated;
        END IF;

        RAISE EXCEPTION USING ERRCODE = 'QA401', MESSAGE = 'Rollback controlado de prueba C1';
      EXCEPTION
        WHEN SQLSTATE 'QA401' THEN
          NULL;
      END;
    END IF;
  END;
END $$;

COMMIT;
