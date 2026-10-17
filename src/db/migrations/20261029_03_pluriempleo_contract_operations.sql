-- ============================================================================
-- PLURIEMPLEO — BLOQUE 3 (A): OPERACIONES CONTRACTUALES POR CONTRATO
-- Estado: PREPARADA · NO EJECUTADA (pendiente de autorización explícita).
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
-- Se aplicará tras los Bloques 1 y 2.
--
-- OBJETIVO
--   Permitir que las operaciones contractuales actúen sobre UN contrato/asignación
--   concreto cuando el trabajador tiene 2 contratos activos, sin tocar el otro y
--   conservando intacto el funcionamiento de los trabajadores con 1 solo contrato.
--
--   · `change_worker_position`      → reubica SOLO la asignación objetivo.
--   · `complete_worker_contract`    → registra el contrato de SOLO la asignación objetivo.
--   · `change_worker_contract`      → cambia el tipo de SOLO el contrato objetivo.
--   · `register_worker_separation`  → finaliza SOLO la asignación/contrato objetivo;
--                                     deja al trabajador inactivo sólo si no queda otro activo.
--
-- CÓMO SE IDENTIFICA EL CONTRATO
--   Se AÑADE un parámetro opcional final (`p_target_assignment_id` / `p_target_contract_id`).
--   Sin él: si el trabajador tiene 1 sola relación vigente se conserva el comportamiento
--   actual; si tiene 2, la operación se RECHAZA con un mensaje claro (no se elige al azar).
--   Como la firma cambia, se elimina la versión anterior para no dejar ambigüedad en PostgREST.
--   Verificado: ninguna otra función referencia estas RPC (no hay dependencias internas).
--
-- ANTIGÜEDAD COMPARTIDA
--   No se toca ningún cálculo de antigüedad: sigue residiendo en el TRABAJADOR
--   (`workers.employment_start_date` / `hire_date`) y se paga en cada contrato según su
--   puesto/escala. Crear o finalizar un contrato NO reinicia ni modifica esa fecha.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. RESOLUTORES COMPARTIDOS DEL CONTRATO/ASIGNACIÓN OBJETIVO
--    Reutilizables por todas las operaciones; evitan duplicar la regla de selección.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_worker_target_assignment(
  p_worker_id uuid,
  p_assignment_id uuid default null
)
returns uuid
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare
  v_count integer;
  v_target uuid;
begin
  -- Objetivo explícito: debe estar vigente y pertenecer al trabajador.
  if p_assignment_id is not null then
    select a.id into v_target
    from public.worker_position_assignments a
    where a.id = p_assignment_id
      and a.worker_id = p_worker_id
      and a.is_current = true
      and a.end_date is null;
    if v_target is null then
      raise exception 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    end if;
    return v_target;
  end if;

  select count(*) into v_count
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null;

  if v_count = 0 then
    raise exception 'El trabajador no tiene un puesto actual asignado';
  end if;

  if v_count > 1 then
    raise exception 'El trabajador tiene % contratos activos: identifique la asignación a modificar', v_count;
  end if;

  select a.id into v_target
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null
  order by a.start_date desc
  limit 1;

  return v_target;
end $$;

create or replace function public.resolve_worker_target_contract(
  p_worker_id uuid,
  p_contract_id uuid default null
)
returns uuid
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare
  v_count integer;
  v_target uuid;
begin
  if p_contract_id is not null then
    select c.id into v_target
    from public.employment_contracts c
    where c.id = p_contract_id
      and c.worker_id = p_worker_id
      and c.is_current = true;
    if v_target is null then
      raise exception 'El contrato seleccionado no está vigente o no pertenece al trabajador';
    end if;
    return v_target;
  end if;

  select count(*) into v_count
  from public.employment_contracts c
  where c.worker_id = p_worker_id and c.is_current = true;

  if v_count = 0 then
    raise exception 'El trabajador no tiene un contrato vigente';
  end if;

  if v_count > 1 then
    raise exception 'El trabajador tiene % contratos activos: identifique el contrato a modificar', v_count;
  end if;

  select c.id into v_target
  from public.employment_contracts c
  where c.worker_id = p_worker_id and c.is_current = true
  order by c.start_date desc
  limit 1;

  return v_target;
end $$;


-- ---------------------------------------------------------------------------
-- 2. CAMBIO DE PUESTO (`change_worker_position`) — actúa sólo sobre la asignación objetivo
-- ---------------------------------------------------------------------------
drop function if exists public.change_worker_position(
  uuid, uuid, date, text, text, boolean, date, text, uuid, text, boolean, date
);

create or replace function public.change_worker_position(
  p_worker_id uuid,
  p_new_position_id uuid,
  p_effective_date date,
  p_reason text default null,
  p_notes text default null,
  p_create_addendum boolean default true,
  p_signature_date date default null,
  p_signature_place text default null,
  p_representative_assignment_id uuid default null,
  p_reason_code text default null,
  p_require_formalized boolean default false,
  p_resolution_date date default null,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_position public.organization_positions%rowtype;
  v_job public.organization_jobs%rowtype;
  v_is_principal boolean := false;
  v_resolution_id uuid := null;
  v_occupied integer;
  v_new_assignment_id uuid;
  v_contract_id uuid;
  v_group_id uuid;
  v_scale_id uuid;
  v_value_id uuid;
  v_amount numeric;
  v_currency text;
  v_previous_salary numeric;
  v_old_group uuid;
  v_old_amount numeric;
  v_old_seq integer;
  v_history_id uuid;
  v_preview jsonb;
  v_changes jsonb;
  v_addendum jsonb := null;
  v_skipped text := null;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_effective_date is null then
    raise exception 'La fecha efectiva es obligatoria';
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    raise exception 'Trabajador no encontrado';
  end if;

  if not public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para gestionar trabajadores en esta entidad';
  end if;

  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  -- Asignación OBJETIVO (explícita o única vigente; si hay 2 sin identificar → error).
  select * into v_current from public.worker_position_assignments
  where id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  for update;

  if v_current.position_id = p_new_position_id then
    raise exception 'El trabajador ya ocupa el puesto seleccionado';
  end if;

  if p_effective_date <= v_current.start_date then
    raise exception 'La fecha efectiva debe ser posterior al inicio del puesto actual';
  end if;

  -- Snapshot salarial de la situación ANTERIOR (antes de cerrar el assignment).
  select ctx.salary_group_id, ctx.amount into v_old_group, v_old_amount
  from public.position_salary_context(v_current.position_id, p_effective_date) ctx;
  if v_old_group is not null then
    select sg.sequence_number into v_old_seq from public.salary_groups sg where sg.id = v_old_group;
  end if;

  select * into v_position from public.organization_positions where id = p_new_position_id for update;
  if not found then
    raise exception 'El puesto seleccionado no existe';
  end if;

  if v_position.organization_entity_id <> v_worker.organization_entity_id then
    raise exception 'El puesto seleccionado no pertenece a la entidad del trabajador';
  end if;

  if not v_position.is_active then
    raise exception 'El puesto seleccionado no está activo';
  end if;

  select * into v_job from public.organization_jobs where id = v_position.job_id;
  v_is_principal := coalesce(v_job.is_principal_specialist, false);

  select count(*) into v_occupied
  from public.worker_position_assignments a
  join public.workers w on w.id = a.worker_id
  where a.position_id = p_new_position_id and a.is_current = true and a.end_date is null
    and w.employment_status = 'active';

  if v_occupied >= v_position.authorized_quantity then
    raise exception 'El puesto seleccionado ya no tiene vacantes disponibles';
  end if;

  -- Contrato VIGENTE de ESTA asignación (no el del trabajador en general).
  select id into v_contract_id
  from public.employment_contracts
  where assignment_id = v_current.id and is_current = true
  order by start_date desc limit 1;

  -- La vista previa corresponde a la MISMA asignación objetivo (y por tanto al mismo
  -- contrato) que se va a mover: nunca a una asignación arbitraria.
  v_preview := public.position_change_preview(
    p_worker_id, p_new_position_id, p_effective_date, v_current.id
  );
  v_changes := coalesce(v_preview->'changes', '[]'::jsonb);

  update public.worker_position_assignments
  set end_date = p_effective_date - 1, is_current = false, updated_at = now()
  where id = v_current.id;

  insert into public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
  values (p_worker_id, p_new_position_id, p_effective_date, null, true)
  returning id into v_new_assignment_id;

  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, created_by
  ) values (
    p_worker_id, 'CAMBIO_PUESTO', v_current.id, v_new_assignment_id,
    p_effective_date,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  );

  select ctx.salary_group_id, ctx.salary_scale_id, ctx.salary_group_value_id, ctx.amount, ctx.currency_code
  into v_group_id, v_scale_id, v_value_id, v_amount, v_currency
  from public.position_salary_context(p_new_position_id, p_effective_date) ctx;

  if v_amount is not null then
    v_previous_salary := public.worker_last_recorded_salary(p_worker_id, p_effective_date);
    if v_previous_salary is distinct from v_amount then
      v_history_id := public.record_worker_salary_event(
        p_worker_id, v_contract_id, v_new_assignment_id,
        v_group_id, v_scale_id, v_value_id,
        v_previous_salary, v_amount, v_currency, p_effective_date,
        'POSITION_CHANGE', p_reason
      );
    end if;
  end if;

  if v_is_principal then
    v_resolution_id := (public.create_worker_resolution(
      p_worker_id, v_new_assignment_id, p_new_position_id,
      coalesce(p_resolution_date, p_effective_date),
      p_representative_assignment_id, null, 'MOVEMENT'
    )->>'resolution_id')::uuid;
    v_skipped := 'PRINCIPAL_SPECIALIST';
  elsif p_create_addendum and jsonb_array_length(v_changes) > 0 then
    if v_contract_id is null then
      v_skipped := 'NO_CONTRACT';
    else
      v_addendum := public.create_contract_addendum(
        p_worker_id, v_changes,
        coalesce(nullif(btrim(coalesce(p_reason_code, '')), ''), 'POSITION_CHANGE'),
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cambio de puesto'),
        p_effective_date, p_notes, 'POSITION_CHANGE', v_new_assignment_id, v_history_id,
        'CONTRACT_VARIATION_ADDENDUM', p_signature_date, p_signature_place,
        p_representative_assignment_id, p_require_formalized, null,
        (v_preview->>'total_before')::numeric, (v_preview->>'total_after')::numeric
      );
    end if;
  end if;

  -- Movimiento de Nómina: REUBICACIÓN de ESTE contrato. `event_id = nueva asignación`
  -- identifica el movimiento y evita colisiones si el otro contrato se reubica el mismo día.
  perform public.create_payroll_movement(
    p_worker_id, 'REUBICACION', p_effective_date,
    v_current.position_id, p_new_position_id, v_new_assignment_id, v_new_assignment_id,
    v_old_amount, v_old_seq, v_amount, null
  );

  return jsonb_build_object(
    'previous_assignment_id', v_current.id,
    'new_assignment_id', v_new_assignment_id,
    'effective_date', p_effective_date,
    'employment_contract_id', v_contract_id,
    'salary_history_id', v_history_id,
    'changes', v_changes,
    'has_contractual_changes', jsonb_array_length(v_changes) > 0,
    'is_principal_specialist', v_is_principal,
    'resolution_id', v_resolution_id,
    'addendum_skipped', v_skipped,
    'addendum', v_addendum
  );
end $$;


-- ---------------------------------------------------------------------------
-- 3. REGISTRAR CONTRATO (`complete_worker_contract`) — sólo la asignación objetivo
-- ---------------------------------------------------------------------------
drop function if exists public.complete_worker_contract(
  uuid, uuid, date, date, uuid, date, text, uuid, jsonb, text
);

create or replace function public.complete_worker_contract(
  p_worker_id uuid,
  p_contract_type_id uuid,
  p_contract_start_date date,
  p_contract_end_date date default null,
  p_representative_assignment_id uuid default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_payment_method_id uuid default null,
  p_compensation_components jsonb default null,
  p_payment_schedule_text text default null,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_assignment_id uuid;
  v_contract_type public.employment_contract_types%ROWTYPE;
  v_contract_id uuid;
  v_has_previous boolean;
  v_previous_schedule text;
  v_conditions jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  -- Asignación OBJETIVO (explícita o única vigente).
  v_assignment_id := public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id);

  -- Validar tipo de contrato (catálogo global de SiteCorp)
  SELECT * INTO v_contract_type FROM public.employment_contract_types
  WHERE id = p_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  IF p_contract_start_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de inicio del contrato es obligatoria';
  END IF;

  IF v_contract_type.code = 'DETERMINADO' AND p_contract_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
  END IF;

  IF p_contract_end_date IS NOT NULL AND p_contract_end_date <= p_contract_start_date THEN
    RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
  END IF;

  -- Cerrar el contrato vigente de ESTA asignación (si existe), preservando su día/momento
  -- de pago como prellenado del nuevo (Fase 11A.7 §8). NO toca el otro contrato.
  SELECT payment_schedule_text INTO v_previous_schedule
  FROM public.employment_contracts
  WHERE assignment_id = v_assignment_id AND is_current = true
  ORDER BY start_date DESC
  LIMIT 1;

  v_has_previous := EXISTS (
    SELECT 1 FROM public.employment_contracts
    WHERE assignment_id = v_assignment_id AND is_current = true
  );

  UPDATE public.employment_contracts
  SET is_current = false, updated_at = now()
  WHERE assignment_id = v_assignment_id AND is_current = true;

  -- Registrar nuevo contrato vigente para la asignación objetivo
  INSERT INTO public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, is_current
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment_id,
    p_contract_type_id, p_contract_start_date, p_contract_end_date, true
  ) RETURNING id INTO v_contract_id;

  -- Fase 11A: snapshot salarial contractual e histórico salarial (por contrato)
  PERFORM public.capture_contract_salary_snapshot(
    v_contract_id,
    CASE WHEN v_has_previous THEN 'CONTRACT_CHANGE' ELSE 'INITIAL_CONTRACT' END,
    p_contract_start_date,
    NULL
  );
  PERFORM public.capture_contract_party_snapshot(
    v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, p_contract_start_date)
  );

  -- Condiciones contractuales del NUEVO contrato (firma, pago, retribución, prellenado)
  v_conditions := public.apply_contract_conditions(
    v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    COALESCE(nullif(btrim(coalesce(p_payment_schedule_text, '')), ''), v_previous_schedule)
  );

  RETURN jsonb_build_object(
    'contract_id', v_contract_id,
    'assignment_id', v_assignment_id,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 4. CAMBIO DE CONTRATO (`change_worker_contract`) — sólo el contrato objetivo
-- ---------------------------------------------------------------------------
drop function if exists public.change_worker_contract(
  uuid, uuid, date, date, text, uuid, date, text, uuid, jsonb, text
);

create or replace function public.change_worker_contract(
  p_worker_id uuid,
  p_new_contract_type_id uuid,
  p_effective_date date,
  p_new_end_date date default null,
  p_notes text default null,
  p_representative_assignment_id uuid default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_payment_method_id uuid default null,
  p_compensation_components jsonb default null,
  p_payment_schedule_text text default null,
  p_target_contract_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_current public.employment_contracts%ROWTYPE;
  v_type public.employment_contract_types%ROWTYPE;
  v_assignment_id uuid;
  v_new_contract_id uuid;
  v_conditions jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'La fecha efectiva es obligatoria';
  END IF;

  IF p_new_contract_type_id IS NULL THEN
    RAISE EXCEPTION 'El nuevo tipo de contrato es obligatorio';
  END IF;

  -- Bloquear al trabajador (serializa cambios contractuales concurrentes)
  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  IF v_worker.employment_status <> 'active' THEN
    RAISE EXCEPTION 'El trabajador no está activo';
  END IF;

  SELECT * INTO v_type FROM public.employment_contract_types
  WHERE id = p_new_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  -- Contrato OBJETIVO (explícito o único vigente) bloqueado.
  SELECT * INTO v_current FROM public.employment_contracts
  WHERE id = public.resolve_worker_target_contract(p_worker_id, p_target_contract_id)
  FOR UPDATE;

  IF p_effective_date <= v_current.start_date THEN
    RAISE EXCEPTION 'La fecha efectiva debe ser posterior al inicio del contrato vigente';
  END IF;

  IF v_type.code = 'DETERMINADO' AND p_new_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de finalización';
  END IF;

  IF p_new_end_date IS NOT NULL AND p_new_end_date <= p_effective_date THEN
    RAISE EXCEPTION 'La fecha de finalización debe ser posterior a la fecha efectiva';
  END IF;

  -- La asignación es la del CONTRATO objetivo: NO se modifica (sólo se referencia).
  v_assignment_id := v_current.assignment_id;

  -- 1) Cerrar SÓLO el contrato objetivo (se conserva como histórico). El otro contrato no se toca.
  UPDATE public.employment_contracts
  SET is_current = false,
      actual_end_date = p_effective_date - 1,
      updated_at = now()
  WHERE id = v_current.id;

  -- 2) Crear el nuevo contrato vigente sobre la misma asignación.
  INSERT INTO public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, actual_end_date, is_current
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment_id,
    p_new_contract_type_id, p_effective_date,
    CASE WHEN v_type.code = 'DETERMINADO' THEN p_new_end_date ELSE NULL END,
    NULL, true
  ) RETURNING id INTO v_new_contract_id;

  PERFORM public.capture_contract_salary_snapshot(v_new_contract_id, 'CONTRACT_CHANGE', p_effective_date, p_notes);
  PERFORM public.capture_contract_party_snapshot(
    v_new_contract_id, p_representative_assignment_id, coalesce(p_signature_date, p_effective_date)
  );

  v_conditions := public.apply_contract_conditions(
    v_new_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    COALESCE(nullif(btrim(coalesce(p_payment_schedule_text, '')), ''), v_current.payment_schedule_text)
  );

  -- 3) Bitácora del evento contractual
  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_contract_id, new_contract_id,
    effective_date, reason, notes, created_by
  ) VALUES (
    p_worker_id, 'CAMBIO_CONTRATO', v_current.id, v_new_contract_id,
    p_effective_date, v_type.name,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'previous_contract_id', v_current.id,
    'new_contract_id', v_new_contract_id,
    'effective_date', p_effective_date,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 5. FINALIZACIÓN POR CONTRATO (`register_worker_separation`) — sólo la asignación objetivo
--    Cierra únicamente esa asignación y su contrato; el trabajador permanece activo si
--    conserva otro contrato vigente y sólo pasa a inactivo cuando no queda ninguno.
-- ---------------------------------------------------------------------------
drop function if exists public.register_worker_separation(uuid, date, uuid, text);

create or replace function public.register_worker_separation(
  p_worker_id uuid,
  p_effective_date date,
  p_separation_reason_id uuid,
  p_notes text default null,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_reason public.worker_separation_reasons%rowtype;
  v_remaining integer;
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
    raise exception 'No tiene permiso para gestionar trabajadores en esta entidad';
  end if;

  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  select * into v_reason from public.worker_separation_reasons
  where id = p_separation_reason_id and is_active = true;
  if not found then
    raise exception 'El motivo de baja seleccionado no es válido';
  end if;

  -- Asignación OBJETIVO (explícita o única vigente; si hay 2 sin identificar → error).
  select * into v_current from public.worker_position_assignments
  where id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  for update;

  if p_effective_date < v_current.start_date then
    raise exception 'La fecha de baja no puede ser anterior al inicio del puesto actual';
  end if;

  -- Cerrar SÓLO la asignación objetivo.
  update public.worker_position_assignments
  set end_date = p_effective_date,
      is_current = false,
      updated_at = now()
  where id = v_current.id;

  -- Cerrar SÓLO los contratos vigentes de esa asignación.
  update public.employment_contracts
  set is_current = false,
      actual_end_date = p_effective_date,
      updated_at = now()
  where assignment_id = v_current.id and is_current = true;

  -- El trabajador sigue activo mientras conserve OTRO contrato vigente.
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
  end if;

  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, separation_reason_id, created_by
  ) values (
    p_worker_id, 'BAJA', v_current.id, null,
    p_effective_date, v_reason.name,
    nullif(btrim(coalesce(p_notes, '')), ''), v_reason.id, auth.uid()
  );

  -- Movimiento de Nómina: BAJA de ESTE contrato. `event_id = asignación` evita colisiones
  -- si el otro contrato se finaliza el mismo día.
  perform public.create_payroll_movement(
    p_worker_id, 'BAJA', p_effective_date,
    v_current.position_id, null, v_current.id, v_current.id
  );

  return jsonb_build_object(
    'assignment_id', v_current.id,
    'effective_date', p_effective_date,
    'separation_reason_id', v_reason.id,
    'remaining_active_assignments', v_remaining
  );
end $$;


-- ---------------------------------------------------------------------------
-- 6. PERMISOS
-- ---------------------------------------------------------------------------
grant execute on function public.resolve_worker_target_assignment(uuid, uuid) to authenticated;
grant execute on function public.resolve_worker_target_contract(uuid, uuid) to authenticated;
revoke execute on function public.resolve_worker_target_assignment(uuid, uuid) from public, anon;
revoke execute on function public.resolve_worker_target_contract(uuid, uuid) from public, anon;

grant execute on function public.change_worker_position(
  uuid, uuid, date, text, text, boolean, date, text, uuid, text, boolean, date, uuid
) to authenticated;
revoke execute on function public.change_worker_position(
  uuid, uuid, date, text, text, boolean, date, text, uuid, text, boolean, date, uuid
) from public, anon;

grant execute on function public.complete_worker_contract(
  uuid, uuid, date, date, uuid, date, text, uuid, jsonb, text, uuid
) to authenticated;
revoke execute on function public.complete_worker_contract(
  uuid, uuid, date, date, uuid, date, text, uuid, jsonb, text, uuid
) from public, anon;

grant execute on function public.change_worker_contract(
  uuid, uuid, date, date, text, uuid, date, text, uuid, jsonb, text, uuid
) to authenticated;
revoke execute on function public.change_worker_contract(
  uuid, uuid, date, date, text, uuid, date, text, uuid, jsonb, text, uuid
) from public, anon;

grant execute on function public.register_worker_separation(uuid, date, uuid, text, uuid) to authenticated;
revoke execute on function public.register_worker_separation(uuid, date, uuid, text, uuid) from public, anon;


-- ============================================================================
-- FIN DEL BLOQUE 3 (A) — NO EJECUTADO.
-- ============================================================================
