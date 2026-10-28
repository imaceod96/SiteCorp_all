-- ============================================================================
-- PLURIEMPLEO — BLOQUE 2: RPC DE ALTA DEL SEGUNDO CONTRATO
-- Estado: PREPARADA · NO EJECUTADA (pendiente de autorización explícita).
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
-- Se aplicará tras el Bloque 1 (`20261029_01_pluriempleo_constraints.sql`).
--
-- OBJETIVO
--   Contratar a un trabajador EXISTENTE y ACTIVO para un SEGUNDO puesto de su
--   misma entidad, generando:
--     · una nueva asignación de puesto (independiente de la primera);
--     · su contrato laboral independiente;
--     · snapshots contractuales y salariales;
--     · condiciones contractuales (firma, pago, retribución);
--     · histórico salarial propio del contrato;
--     · bitácora laboral del evento;
--     · movimiento de nómina ALTA identificado por la nueva asignación.
--   Todo en UNA transacción (cualquier fallo revierte por completo).
--
--   NO crea candidato, NO duplica al trabajador, NO toca el primer contrato ni
--   sus movimientos, y REUTILIZA las primitivas de la contratación normal:
--     capture_contract_salary_snapshot · capture_contract_party_snapshot ·
--     apply_contract_conditions · create_payroll_movement · validate_hiring_readiness ·
--     format_contract_readiness_message.
--   No define fórmulas nuevas (antigüedad, CLA, nocturnidad y complementos siguen
--   calculándose con las reglas vigentes del puesto/contrato de cada asignación).
--
-- COMPATIBILIDAD CON EL BLOQUE 1
--   · Nuevo índice `ec_current_per_worker_unique (worker_id, assignment_id) WHERE is_current`
--     → admite este segundo contrato.
--   · Trigger `employment_contracts_enforce_limit` → bloquea un tercero (cuenta 1 < 2).
--   · Índice de histórico salarial por contrato → permite un `INITIAL_CONTRACT` propio
--     en la misma fecha que el del primer contrato.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. HABILITADOR DE ESQUEMA (imprescindible para la RPC)
--    La bitácora laboral sólo admitía CAMBIO_PUESTO / BAJA / REINCORPORACION /
--    CAMBIO_CONTRATO. Se amplía el CHECK con 'PLURIEMPLEO' para registrar el
--    evento del segundo contrato como movimiento propio, sin reutilizar (ni
--    falsear) un tipo existente. Es una ampliación de valores permitidos: no
--    altera ninguna fila existente.
-- ---------------------------------------------------------------------------
alter table public.worker_employment_movements
  drop constraint if exists worker_employment_movements_movement_type_check;

alter table public.worker_employment_movements
  add constraint worker_employment_movements_movement_type_check
  check (movement_type in (
    'CAMBIO_PUESTO', 'BAJA', 'REINCORPORACION', 'CAMBIO_CONTRATO', 'PLURIEMPLEO'
  ));


-- ---------------------------------------------------------------------------
-- 1. RPC DE ALTA POR PLURIEMPLEO
--    Firma alineada con `reincorporate_worker` / `hire_candidate` para que la capa
--    de aplicación y el diálogo reutilicen el mismo contrato de datos.
-- ---------------------------------------------------------------------------
create or replace function public.create_worker_pluriemploy(
  p_worker_id uuid,
  p_position_id uuid,
  p_hire_date date,
  p_contract_type_id uuid,
  p_contract_start_date date default null,
  p_contract_end_date date default null,
  p_notes text default null,
  p_representative_assignment_id uuid default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_payment_method_id uuid default null,
  p_compensation_components jsonb default null,
  p_payment_schedule_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
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

  -- Trabajador (bloqueado): debe existir, estar activo y pertenecer a la entidad.
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

  -- Regla 2: Pluriempleo exige EXACTAMENTE un contrato activo.
  select count(*) into v_active_contracts
  from public.employment_contracts
  where worker_id = p_worker_id and is_current = true;

  if v_active_contracts = 0 then
    raise exception 'El trabajador no tiene un contrato activo: use la contratación normal';
  end if;

  if v_active_contracts >= 2 then
    raise exception 'El trabajador ya tiene 2 contratos activos: no se puede crear un tercero';
  end if;

  -- Puesto destino (bloqueado): misma entidad y activo.
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

  -- No permitir dos contratos activos sobre el MISMO puesto.
  if exists (
    select 1 from public.worker_position_assignments a
    where a.worker_id = p_worker_id
      and a.position_id = p_position_id
      and a.is_current = true
      and a.end_date is null
  ) then
    raise exception 'El trabajador ya ocupa el puesto seleccionado';
  end if;

  select * into v_job from public.organization_jobs where id = v_position.job_id;

  -- El Cargo Especialista Principal se formaliza por Resolución, no por contrato.
  if coalesce(v_job.is_principal_specialist, false) then
    raise exception 'El segundo puesto pertenece a un Cargo Especialista Principal (Resolución); Pluriempleo sólo admite puestos con contrato laboral';
  end if;

  -- Capacidad vigente del puesto destino (mismo criterio que la reubicación).
  select count(*) into v_occupied
  from public.worker_position_assignments a
  join public.workers w on w.id = a.worker_id
  where a.position_id = p_position_id
    and a.is_current = true
    and a.end_date is null
    and w.employment_status = 'active';

  if v_occupied >= v_position.authorized_quantity then
    raise exception 'El puesto seleccionado ya no tiene vacantes disponibles';
  end if;

  -- Tipo de contrato (mismo catálogo y reglas que la contratación normal).
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

  -- Integridad contractual central (reutiliza las reglas existentes del backend).
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

  -- 1) Nueva asignación de puesto (independiente de la primera).
  insert into public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
  values (p_worker_id, p_position_id, p_hire_date, null, true)
  returning id into v_new_assignment_id;

  -- 2) Nuevo contrato vigente e independiente.
  insert into public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, is_current
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_new_assignment_id,
    p_contract_type_id, v_contract_start, p_contract_end_date, true
  ) returning id into v_contract_id;

  -- 3) Snapshots y condiciones (MISMAS primitivas que la contratación normal).
  --    El histórico salarial se registra como INITIAL_CONTRACT de ESTE contrato
  --    (el índice del Bloque 1 lo admite aunque la fecha coincida con el primero).
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

  -- 4) Bitácora laboral: movimiento propio del segundo contrato.
  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    previous_contract_id, new_contract_id, effective_date, reason, notes, created_by
  ) values (
    p_worker_id, 'PLURIEMPLEO', null, v_new_assignment_id,
    null, v_contract_id, p_hire_date,
    coalesce(nullif(btrim(coalesce(v_job.name, '')), ''), 'Pluriempleo'),
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  -- 5) Movimiento de NÓMINA ALTA, identificado por la nueva asignación.
  --    `event_id = v_new_assignment_id` resuelve la identificación única y evita la
  --    colisión con el ALTA del primer contrato en el índice
  --    `worker_payroll_movements_dedup_idx (worker_id, event_type, effective_date, event_id)`.
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
end $$;


-- ---------------------------------------------------------------------------
-- 2. PERMISOS (mínimo privilegio, mismo patrón que el resto de RPC del módulo)
-- ---------------------------------------------------------------------------
grant execute on function public.create_worker_pluriemploy(
  uuid, uuid, date, uuid, date, date, text, uuid, date, text, uuid, jsonb, text
) to authenticated;

revoke execute on function public.create_worker_pluriemploy(
  uuid, uuid, date, uuid, date, date, text, uuid, date, text, uuid, jsonb, text
) from public, anon;


-- ============================================================================
-- FIN DEL BLOQUE 2 — NO EJECUTADO.
-- ============================================================================
