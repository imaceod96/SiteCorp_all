-- ============================================================================
-- PLURIEMPLEO — BLOQUE 3 (B): CAMBIO SALARIAL MASIVO Y ALERTAS POR CONTRATO
-- Estado: PREPARADA · NO EJECUTADA (pendiente de autorización explícita).
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
--
-- OBJETIVO
--   · Permitir que un cambio salarial general genere un movimiento de nómina
--     INDIVIDUAL por cada contrato afectado (sin mezclar ni duplicar), en lugar de
--     un único movimiento por trabajador resuelto con `LIMIT 1`.
--   · Relacionar cada vencimiento contractual con SU contrato y SU puesto reales
--     (no con la posición "vigente" genérica del trabajador).
--
-- AJUSTE DE ESQUEMA NECESARIO (mínimo, documentado)
--   `worker_payroll_movements_dedup_idx` deduplicaba por
--   `(worker_id, event_type, effective_date, event_id)`. Un cambio salarial masivo usa
--   UN `event_id` común (el evento documental) para todos los contratos del trabajador,
--   de modo que dos contratos afectados colisionaban y el segundo movimiento se perdía.
--   Se AÑADE `assignment_id` a la clave para que cada contrato tenga su movimiento sin
--   perder la idempotencia. No altera filas existentes (una asignación ⇒ mismo comportamiento).
--
-- ANTIGÜEDAD COMPARTIDA
--   El histórico salarial y los anexos siguen generándose en
--   `apply_salary_group_value_change` → `salary_change_impact`, que YA itera por
--   contrato/asignación. Con el índice del Bloque 1 cada contrato registra su histórico
--   propio aunque compartan la misma fecha. La antigüedad NO se recalcula aquí.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. AJUSTE DE ESQUEMA: identificación única del movimiento por contrato
-- ---------------------------------------------------------------------------
drop index if exists public.worker_payroll_movements_dedup_idx;
create unique index worker_payroll_movements_dedup_idx
  on public.worker_payroll_movements (
    worker_id,
    event_type,
    effective_date,
    coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );


-- ---------------------------------------------------------------------------
-- 2. IMPACTO DEL CAMBIO SALARIAL (`salary_change_impact`)
--    Fija el contrato a SU asignación (`c.assignment_id = a.id`). Sin este ajuste, con
--    2 contratos activos el JOIN original (asignaciones × contratos) producía un
--    producto cartesiano y duplicaba/mezclaba el impacto, el histórico y los anexos.
--    Lo consume tanto el preview como `apply_salary_group_value_change` (que genera el
--    histórico y el anexo POR CONTRATO). Firma y columnas sin cambios.
-- ---------------------------------------------------------------------------
create or replace function public.salary_change_impact(
  p_salary_group_id uuid,
  p_new_amount numeric,
  p_effective_date date default current_date
)
returns table(worker_id uuid, worker_code text, worker_name text, identification text, area_name text, job_name text, position_name text, group_sequence_number integer, previous_amount numeric, currency_code text, contract_id uuid, contract_start_date date, contract_type_name text, assignment_id uuid, position_id uuid, job_id uuid)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  WITH ctx AS (
    SELECT COALESCE(p_effective_date, CURRENT_DATE) AS ref_date
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
    -- Contrato de ESTA asignación (evita el cross join asignaciones × contratos).
    LEFT JOIN public.employment_contracts c
      ON c.worker_id = w.id AND c.assignment_id = a.id AND c.is_current = true
    LEFT JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
    LEFT JOIN LATERAL public.resolve_salary_group_value(g.id, ctx.ref_date - 1) prev ON true
    WHERE w.employment_status = 'active'
      AND g.id = p_salary_group_id
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


-- ---------------------------------------------------------------------------
-- 3. CAMBIO SALARIAL MASIVO (`finalize_salary_change_event`)
--    Un movimiento de nómina REUBICACIÓN por CADA contrato afectado (los del grupo
--    salarial del evento). Idempotente por (trabajador, evento, asignación).
-- ---------------------------------------------------------------------------
create or replace function public.finalize_salary_change_event(
  p_salary_group_id uuid,
  p_effective_date date,
  p_description text,
  p_workers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_worker uuid;
  v_prev numeric;
  v_tenant uuid;
  v_event uuid;
  v_seq integer;
  v_created int := 0;
  v_skipped int := 0;
  v_batches jsonb;
  v_rec record;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_salary_group_id is null or p_effective_date is null then
    raise exception 'El grupo salarial y la fecha efectiva son obligatorios';
  end if;

  -- S2: autorización por escala salarial (plataforma salary.manage, superadmin o salary.manage de la entidad)
  if not public.can_manage_salary_scale((select sg.salary_scale_id from public.salary_groups sg where sg.id = p_salary_group_id)) then
    raise exception 'Permiso denegado: se requiere salary.manage sobre la escala del grupo salarial';
  end if;

  select sg.sequence_number into v_seq from public.salary_groups sg where sg.id = p_salary_group_id;

  if p_workers is not null and jsonb_array_length(p_workers) > 0 then
    select w.company_client_id into v_tenant
    from public.workers w where w.id = ((p_workers->0->>'worker_id')::uuid);
  end if;

  insert into public.document_generation_events (
    company_client_id, organization_entity_id, event_type, description, effective_date, metadata, created_by
  ) values (
    coalesce(v_tenant, gen_random_uuid()), null, 'SALARY_SCALE_CHANGE',
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Cambio salarial'),
    p_effective_date,
    jsonb_build_object('salary_group_id', p_salary_group_id, 'sequence_number', v_seq),
    auth.uid()
  ) returning id into v_event;

  -- Trabajadores ÚNICOS afectados (la lista del impacto puede repetir worker_id por contrato).
  for v_worker in
    select distinct (item->>'worker_id')::uuid
    from jsonb_array_elements(coalesce(p_workers, '[]'::jsonb)) item
    where coalesce(item->>'worker_id', '') <> ''
  loop
    -- Importe anterior del grupo (idéntico para todos los contratos del mismo grupo).
    select nullif(item->>'previous_amount', '')::numeric into v_prev
    from jsonb_array_elements(coalesce(p_workers, '[]'::jsonb)) item
    where (item->>'worker_id')::uuid = v_worker
    limit 1;

    -- Un movimiento por CADA contrato afectado (asignación vigente del grupo del evento).
    for v_rec in
      select a.id as assignment_id, a.position_id
      from public.worker_position_assignments a
      join public.workers w on w.id = a.worker_id
      join public.organization_positions p on p.id = a.position_id
      join public.organization_jobs j on j.id = p.job_id
      where a.worker_id = v_worker
        and a.is_current = true
        and a.end_date is null
        and w.employment_status = 'active'
        and j.salary_group_id = p_salary_group_id
      order by a.start_date
    loop
      begin
        perform public.create_payroll_movement(
          v_worker, 'REUBICACION', p_effective_date,
          v_rec.position_id, v_rec.position_id, v_rec.assignment_id, v_event,
          v_prev, v_seq, null, v_seq
        );
        v_created := v_created + 1;
      exception when others then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  v_batches := public.create_document_batches_for_event(v_event);

  return jsonb_build_object(
    'event_id', v_event,
    'movements_created', v_created,
    'movements_skipped', v_skipped,
    'batches', v_batches->'batches'
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- 4. ALERTAS DE VENCIMIENTO (`contract_expiry_alerts`)
--    Cada vencimiento se relaciona con SU contrato y SU puesto (vía la asignación del
--    contrato), no con la posición vigente resuelta con LATERAL ... LIMIT 1.
-- ---------------------------------------------------------------------------
create or replace function public.contract_expiry_alerts(
  target_entity_id uuid,
  horizon_days integer default 30,
  target_worker_id uuid default null
)
returns TABLE(worker_id uuid, worker_code text, worker_name text, identification text, area_name text, job_name text, position_name text, position_code text, contract_id uuid, contract_type_name text, contract_type_code text, contract_start_date date, contract_end_date date, salary_group_id uuid, salary_scale_id uuid, salary_group_sequence_number integer, days_remaining integer, alert_state text)
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $function$
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
    p.code AS position_code,
    c.id AS contract_id,
    ct.name AS contract_type_name,
    ct.code AS contract_type_code,
    c.start_date AS contract_start_date,
    c.end_date AS contract_end_date,
    sg.id AS salary_group_id,
    sg.salary_scale_id AS salary_scale_id,
    sg.sequence_number AS salary_group_sequence_number,
    (c.end_date - CURRENT_DATE)::integer AS days_remaining,
    CASE
      WHEN c.end_date IS NULL THEN 'NO_END_DATE'
      WHEN c.end_date < CURRENT_DATE THEN 'OVERDUE'
      WHEN c.end_date = CURRENT_DATE THEN 'DUE_TODAY'
      WHEN c.end_date <= CURRENT_DATE + 7 THEN 'DUE_IN_7'
      WHEN c.end_date <= CURRENT_DATE + 15 THEN 'DUE_IN_15'
      WHEN c.end_date <= CURRENT_DATE + 30 THEN 'DUE_IN_30'
      ELSE 'DUE_AFTER_30'
    END AS alert_state
  FROM public.employment_contracts c
  JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
  JOIN public.workers w ON w.id = c.worker_id
  -- Puesto del PROPIO contrato (su asignación), nunca la posición "vigente" genérica.
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
    AND (c.end_date IS NULL OR c.end_date <= CURRENT_DATE + h.days)
  ORDER BY c.end_date ASC NULLS LAST, w.first_surname ASC, w.first_name ASC;
END;
$function$;


-- ============================================================================
-- FIN DEL BLOQUE 3 (B) — NO EJECUTADO.
-- ============================================================================
