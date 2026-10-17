-- ============================================================================
-- PLURIEMPLEO — BLOQUE 4 (A): PRENÓMINA POR CONTRATO
-- Estado: PREPARADA · NO EJECUTADA (pendiente de autorización explícita).
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
--
-- OBJETIVO
--   Una entrada de prenómina por CONTRATO (asignación) y período, con su puesto,
--   grupo, escala, jornada y CLA propios. La antigüedad (y su pago) es la MISMA
--   para ambos contratos porque se resuelve desde el TRABAJADOR (fecha reconocida),
--   no desde el contrato. No se crea un motor nuevo: se reutiliza el existente.
--
-- COMPATIBILIDAD CON BLOQUES ANTERIORES
--   · Usa las columnas `assignment_id` / `employment_contract_id` de
--     `prenomina_worker_entries` y su índice único (period, assignment) del Bloque 1.
--   · No toca firmas de contratación, movimientos laborales ni salariales.
--
-- DATOS HISTÓRICOS
--   Las filas antiguas tienen `assignment_id IS NULL`. Se ADOPTAN sin ambigüedad sólo
--   cuando el trabajador tiene EXACTAMENTE una asignación vigente (no es arbitrario).
--   Si tiene 2, se dejan intactas y se documenta (se resuelve al identificar el contrato).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. REFRESCO DE TRABAJADORES (`prenomina_refresh_workers`) — una entrada por asignación
-- ---------------------------------------------------------------------------
create or replace function public.prenomina_refresh_workers(p_period_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
    v_period public.prenomina_periods%ROWTYPE;
    v_scale_id uuid;
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

    v_ref := (make_date(v_period.period_year, v_period.period_month, 1) + interval '1 month' - interval '1 day')::date;
    v_scale_id := public.resolve_salary_scale_for_entity(v_period.organization_entity_id);

    -- ADOPCIÓN (sin asignación arbitraria): filas antiguas de trabajadores con UNA sola
    -- asignación vigente pasan a identificar esa asignación y su contrato.
    UPDATE public.prenomina_worker_entries e
    SET assignment_id = a.id, employment_contract_id = c.id, updated_at = now()
    FROM public.worker_position_assignments a
    LEFT JOIN public.employment_contracts c ON c.assignment_id = a.id AND c.is_current = true
    WHERE e.period_id = v_period.id
      AND e.assignment_id IS NULL
      AND a.worker_id = e.worker_id
      AND a.is_current = true AND a.end_date IS NULL
      AND (SELECT count(*) FROM public.worker_position_assignments a2
           WHERE a2.worker_id = e.worker_id AND a2.is_current = true AND a2.end_date IS NULL) = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.prenomina_worker_entries x
        WHERE x.period_id = e.period_id AND x.assignment_id = a.id AND x.id <> e.id);

    -- UPDATE por ASIGNACIÓN: cada contrato refresca sus snapshots con SU puesto/cargo/grupo.
    -- La antigüedad (tn/band) se resuelve desde el TRABAJADOR → idéntica en ambos contratos.
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
        salary_scale_amount = CASE
            WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                THEN (SELECT r.amount FROM public.resolve_salary_group_value(sg.id) r)
            ELSE NULL END,
        salary_currency = CASE
            WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
                THEN (SELECT r.currency_code FROM public.resolve_salary_group_value(sg.id) r)
            ELSE NULL END,
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
        updated_at = now()
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    LEFT JOIN public.organization_positions p ON p.id = a.position_id AND p.is_active = true
    LEFT JOIN public.organization_jobs j ON j.id = p.job_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
    LEFT JOIN public.employment_contracts c ON c.assignment_id = a.id AND c.is_current = true
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
      AND a.is_current = true AND a.end_date IS NULL
      AND p.is_active = true
      AND p.organization_entity_id = w.organization_entity_id;

    -- DELETE: retira registros cuya asignación ya no está vigente; los históricos sin
    -- asignación se conservan salvo que el trabajador carezca por completo de puesto vigente.
    DELETE FROM public.prenomina_worker_entries e
    WHERE e.period_id = v_period.id
      AND (
        (e.assignment_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            WHERE va.id = e.assignment_id AND va.is_current = true AND va.end_date IS NULL
              AND vp.is_active = true AND vp.organization_entity_id = e.organization_entity_id))
        OR
        (e.assignment_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.worker_position_assignments va
            JOIN public.organization_positions vp ON vp.id = va.position_id
            WHERE va.worker_id = e.worker_id AND va.is_current = true AND va.end_date IS NULL
              AND vp.is_active = true AND vp.organization_entity_id = e.organization_entity_id))
      );

    -- INSERT: una entrada por CADA asignación vigente que aún no tenga registro en el período.
    INSERT INTO public.prenomina_worker_entries (
        period_id, organization_entity_id, worker_id, assignment_id, employment_contract_id,
        worker_name_snapshot, identification_snapshot, area_name_snapshot, job_name_snapshot, position_name_snapshot,
        salary_group_id, salary_group_sequence, salary_scale_id, salary_scale_amount, salary_currency, workday_hours,
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
        CASE WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
             THEN (SELECT r.amount FROM public.resolve_salary_group_value(sg.id) r) ELSE NULL END,
        CASE WHEN sg.salary_scale_id IS NOT NULL AND sg.salary_scale_id = v_scale_id
             THEN (SELECT r.currency_code FROM public.resolve_salary_group_value(sg.id) r) ELSE NULL END,
        p.daily_hours, tn.start_date, v_ref, tn.years, tn.months_rem,
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
    JOIN public.worker_position_assignments a ON a.worker_id = w.id AND a.is_current = true AND a.end_date IS NULL
    JOIN public.organization_positions p ON p.id = a.position_id AND p.is_active = true AND p.organization_entity_id = w.organization_entity_id
    LEFT JOIN public.organization_jobs j ON j.id = p.job_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
    LEFT JOIN public.employment_contracts c ON c.assignment_id = a.id AND c.is_current = true
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
    WHERE w.organization_entity_id = v_period.organization_entity_id AND w.employment_status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.prenomina_worker_entries x WHERE x.period_id = v_period.id AND x.assignment_id = a.id);

    GET DIAGNOSTICS v_added = ROW_COUNT;
    PERFORM public.prenomina_recalc_entry(e.id) FROM public.prenomina_worker_entries e WHERE e.period_id = v_period.id;
    RETURN v_added;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 2. CONFIGURACIÓN CLA de una entrada: usar la asignación DE LA ENTRADA (no "la vigente")
-- ---------------------------------------------------------------------------
create or replace function public.prenomina_cla_config(p_entry_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $function$
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

  -- Cargo del contrato DE LA ENTRADA (su asignación); compatibilidad legacy por worker.
  select j.id, coalesce(j.has_abnormal_conditions, false), coalesce(j.cla_day_enabled, false),
         j.cla_day_hourly_rate, coalesce(j.cla_night_enabled, false)
    into v_job_id, v_job_enabled, v_day_enabled, v_day_rate, v_night_enabled
  from public.worker_position_assignments a
  join public.organization_positions p on p.id = a.position_id and p.is_active = true
  join public.organization_jobs j on j.id = p.job_id
  where (
      (v_entry.assignment_id is not null and a.id = v_entry.assignment_id)
      or (v_entry.assignment_id is null and a.worker_id = v_entry.worker_id
          and a.is_current = true and a.end_date is null)
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
$function$;


-- ---------------------------------------------------------------------------
-- 3. GUARDAR CLA de una entrada: tarifas del Cargo del CONTRATO de la entrada
-- ---------------------------------------------------------------------------
create or replace function public.prenomina_save_cla(
  p_entry_id uuid, p_applied boolean, p_day_used boolean, p_day_minutes numeric,
  p_night_used boolean, p_night1_minutes numeric, p_night2_minutes numeric
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
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

  -- Cargo del contrato de la entrada.
  select j.id, coalesce(j.has_abnormal_conditions, false), coalesce(j.cla_day_enabled, false),
         j.cla_day_hourly_rate, coalesce(j.cla_night_enabled, false)
    into v_job_id, v_job_enabled, v_day_enabled, v_day_rate, v_night_enabled
  from public.worker_position_assignments a
  join public.organization_positions p on p.id = a.position_id and p.is_active = true
  join public.organization_jobs j on j.id = p.job_id
  where (
      (v_entry.assignment_id is not null and a.id = v_entry.assignment_id)
      or (v_entry.assignment_id is null and a.worker_id = v_entry.worker_id
          and a.is_current = true and a.end_date is null)
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
$function$;


-- ============================================================================
-- FIN DEL BLOQUE 4 (A) — NO EJECUTADO.
-- ============================================================================
