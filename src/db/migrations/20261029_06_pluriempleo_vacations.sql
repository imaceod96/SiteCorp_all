-- ============================================================================
-- PLURIEMPLEO — BLOQUE 4 (B): VACACIONES INDEPENDIENTES POR CONTRATO
-- Estado: APLICADA en Supabase y verificada. Este archivo incorpora ya, dentro de su
--   propio SQL, la corrección de consolidación del índice de devengos por contrato
--   (`uq_worker_vacation_accrual`, sección 1).
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
--
-- OBJETIVO
--   Cada contrato (asignación) tiene su PROPIO saldo, devengos y consumos de vacaciones,
--   calculados con la jornada/calendario de SU puesto. Consumir o finalizar un contrato no
--   afecta al otro. Con 2 contratos es OBLIGATORIO identificar el contrato en las operaciones.
--   Los trabajadores con un solo contrato conservan el comportamiento actual.
--
-- ESTRUCTURA (mínima)
--   · `worker_vacations.assignment_id`           (nullable, FK)
--   · `worker_vacation_movements.assignment_id`  (nullable, FK) + índices
--   · `uq_worker_vacation_accrual` pasa a ser POR CONTRATO (trabajador + asignación +
--     año + mes): antes era trabajador + año + mes, y el devengo del segundo contrato
--     del mismo mes fallaba con un error 23505.
--   Se reutilizan `worker_vacations`, `worker_vacation_movements`, `worker_position_on` y
--   las funciones actuales (ahora con parámetro de asignación opcional).
--
-- DATOS HISTÓRICOS SIN CONTRATO
--   · Se ADOPTAN (una sola vez) cuando el trabajador tiene EXACTAMENTE una asignación
--     vigente (sin ambigüedad).
--   · Los que siguen sin asignación (trabajador con 2 contratos o ninguno) se cuentan de
--     forma determinista en el contrato MÁS ANTIGUO del trabajador (su contrato original),
--     nunca repartidos ni duplicados.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ESTRUCTURA: dimensión de asignación en vacaciones
-- ---------------------------------------------------------------------------
alter table public.worker_vacations
  add column if not exists assignment_id uuid
    references public.worker_position_assignments(id) on delete set null;

alter table public.worker_vacation_movements
  add column if not exists assignment_id uuid
    references public.worker_position_assignments(id) on delete set null;

create index if not exists idx_worker_vacations_assignment
  on public.worker_vacations (worker_id, assignment_id);

create index if not exists idx_worker_vacation_movements_assignment
  on public.worker_vacation_movements (worker_id, assignment_id);

-- Devengo POR CONTRATO: el índice único previo (`uq_worker_vacation_accrual` sobre
-- trabajador + año + mes) impedía que dos contratos del MISMO trabajador tuvieran su
-- devengo del mismo mes: el segundo devengo fallaba con un error 23505 (clave duplicada)
-- y el contrato se quedaba sin acumular su devengo. Se redefine por asignación,
-- con el mismo patrón que los índices de contrato de los Bloques 1 y 4:
-- `COALESCE(assignment_id, ceros)` mantiene la unicidad de los devengos legados (sin
-- asignación) sin bloquear a los contratos que sí identifican el suyo.
drop index if exists public.uq_worker_vacation_accrual;

create unique index if not exists uq_worker_vacation_accrual
  on public.worker_vacation_movements (
    worker_id,
    coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    accrual_year,
    accrual_month
  )
  where movement_type = 'ACCRUAL';

-- Adopción sin ambigüedad: sólo si el trabajador tiene UNA asignación vigente.
update public.worker_vacations v
set assignment_id = a.id, updated_at = now()
from public.worker_position_assignments a
where v.assignment_id is null
  and a.worker_id = v.worker_id
  and a.is_current = true and a.end_date is null
  and (select count(*) from public.worker_position_assignments a2
       where a2.worker_id = v.worker_id and a2.is_current = true and a2.end_date is null) = 1;

update public.worker_vacation_movements m
set assignment_id = a.id
from public.worker_position_assignments a
where m.assignment_id is null
  and a.worker_id = m.worker_id
  and a.is_current = true and a.end_date is null
  and (select count(*) from public.worker_position_assignments a2
       where a2.worker_id = m.worker_id and a2.is_current = true and a2.end_date is null) = 1;


-- ---------------------------------------------------------------------------
-- 2. RESOLUTOR DE ASIGNACIÓN DE VACACIONES (0 → null legacy; 1 → ese; >1 sin id → error)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_vacation_assignment(
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
  if p_assignment_id is not null then
    select a.id into v_target
    from public.worker_position_assignments a
    where a.id = p_assignment_id and a.worker_id = p_worker_id
      and a.is_current = true and a.end_date is null;
    if v_target is null then
      raise exception 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    end if;
    return v_target;
  end if;

  select count(*) into v_count
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null;

  if v_count = 0 then return null; end if;
  if v_count > 1 then
    raise exception 'El trabajador tiene % contratos activos: identifique el contrato para operar las vacaciones', v_count;
  end if;

  select a.id into v_target
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null;
  return v_target;
end $$;

-- Predicado de pertenencia de una fila de vacaciones a un contrato.
--
-- Reglas (Bloque 5.1):
--   · Sin contrato identificado (`p_assignment_id is null`) la fila pertenece al saldo
--     global del trabajador: es la lectura de siempre.
--   · Con contrato identificado, la fila pertenece a ese contrato sólo si lo declara.
--   · Una fila HISTÓRICA sin asignación se atribuye al contrato SÓLO cuando el
--     trabajador tiene UNA ÚNICA asignación vigente (asociación inequívoca). Con varias
--     asignaciones posibles la fila NO se atribuye a ninguna: nunca se elige un contrato
--     arbitrariamente. La fila no se pierde ni se borra —sigue sumando al saldo global—
--     y `worker_vacation_summary` la señala como pendiente de conciliación.
create or replace function public.worker_vacation_row_in_contract(
  p_worker_id uuid,
  p_assignment_id uuid,
  p_row_assignment_id uuid
)
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  select p_assignment_id is null
      or p_row_assignment_id = p_assignment_id
      or (p_row_assignment_id is null
          and (select count(*)
               from public.worker_position_assignments a
               where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null) = 1
          and p_assignment_id = (select a.id
               from public.worker_position_assignments a
               where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null))
$$;


-- ---------------------------------------------------------------------------
-- 3. PUESTO / JORNADA / CALENDARIO por asignación
-- ---------------------------------------------------------------------------
drop function if exists public.worker_position_on(uuid, date);
create or replace function public.worker_position_on(
  p_worker_id uuid,
  p_date date,
  p_assignment_id uuid default null
)
returns uuid
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  select a.position_id
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id
    and (p_assignment_id is null or a.id = p_assignment_id)
    and a.start_date <= p_date
    and (a.end_date is null or a.end_date >= p_date)
  order by a.start_date desc, a.created_at desc
  limit 1
$$;

drop function if exists public.worker_vacation_weekdays_on(uuid, date);
create or replace function public.worker_vacation_weekdays_on(
  p_worker_id uuid,
  p_date date,
  p_assignment_id uuid default null
)
returns integer[]
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare v_pos uuid; v_start date;
begin
  v_pos := public.worker_position_on(p_worker_id, p_date, p_assignment_id);
  if v_pos is null then
    v_start := public.worker_vacation_accrual_start(p_worker_id);
    if v_start is not null and p_date < v_start then
      select position_id into v_pos from public.worker_position_assignments
      where worker_id = p_worker_id and (p_assignment_id is null or id = p_assignment_id)
      order by start_date asc limit 1;
    else
      select position_id into v_pos from public.worker_position_assignments
      where worker_id = p_worker_id and (p_assignment_id is null or id = p_assignment_id)
      order by end_date desc nulls last limit 1;
    end if;
  end if;
  if v_pos is null then return array[]::integer[]; end if;
  return public.position_working_weekdays(v_pos);
end;
$$;

drop function if exists public.vacation_count_working_days(uuid, date, date, boolean);
create or replace function public.vacation_count_working_days(
  p_worker_id uuid,
  p_from date,
  p_to date,
  p_require_employment boolean,
  p_assignment_id uuid default null
)
returns integer
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  select count(*)::int
  from generate_series(p_from, p_to, interval '1 day') g(d)
  where extract(isodow from g.d)::int = any(public.worker_vacation_weekdays_on(p_worker_id, g.d::date, p_assignment_id))
    and (not p_require_employment or public.worker_vacation_is_employed_on(p_worker_id, g.d::date))
$$;

drop function if exists public.vacation_target_annual(uuid, integer);
create or replace function public.vacation_target_annual(
  p_worker_id uuid,
  p_year integer,
  p_assignment_id uuid default null
)
returns numeric
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare v_employed int; v_calendar int;
begin
  v_employed := public.vacation_count_working_days(p_worker_id, make_date(p_year,1,1), make_date(p_year,12,31), true, p_assignment_id);
  v_calendar := public.vacation_count_working_days(p_worker_id, make_date(p_year,1,1), make_date(p_year,12,31), false, p_assignment_id);
  if coalesce(v_calendar,0) = 0 then return 0; end if;
  return round(24 * v_employed::numeric / v_calendar::numeric, 4);
end;
$$;

drop function if exists public.worker_vacation_accrual_end(uuid);
create or replace function public.worker_vacation_accrual_end(
  p_worker_id uuid,
  p_assignment_id uuid default null
)
returns date
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
begin
  if p_assignment_id is not null then
    if exists (select 1 from public.worker_position_assignments where id = p_assignment_id and is_current) then
      return null;
    end if;
    return (select max(end_date) from public.worker_position_assignments where id = p_assignment_id);
  end if;
  if exists (select 1 from public.worker_position_assignments where worker_id = p_worker_id and is_current) then
    return null;
  end if;
  return (select max(end_date) from public.worker_position_assignments where worker_id = p_worker_id and end_date is not null);
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. SALDO y DEVENGO por contrato
-- ---------------------------------------------------------------------------
drop function if exists public.worker_vacation_balance(uuid);
create or replace function public.worker_vacation_balance(
  p_worker_id uuid,
  p_assignment_id uuid default null
)
returns numeric
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  select coalesce(sum(amount), 0)::numeric(10,4)
  from public.worker_vacation_movements m
  where m.worker_id = p_worker_id
    and public.worker_vacation_row_in_contract(p_worker_id, p_assignment_id, m.assignment_id)
$$;

drop function if exists public.calculate_worker_vacation_accrual(uuid, integer, integer);
create or replace function public.calculate_worker_vacation_accrual(
  p_worker_id uuid,
  p_year integer,
  p_month integer,
  p_assignment_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare
  v_month_start date := make_date(p_year, p_month, 1);
  v_month_end date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_wd_month integer;
  v_wd_year integer;
  v_wd_after integer;
  v_target numeric(10,4);
  v_calculated numeric(10,4);
  v_prev numeric(10,4);
  v_pos uuid;
  v_weekdays integer[];
begin
  v_wd_year := public.vacation_count_working_days(p_worker_id, make_date(p_year,1,1), make_date(p_year,12,31), false, p_assignment_id);
  v_wd_month := public.vacation_count_working_days(p_worker_id, v_month_start, v_month_end, true, p_assignment_id);
  v_pos := public.worker_position_on(p_worker_id, v_month_end, p_assignment_id);
  v_weekdays := public.worker_vacation_weekdays_on(p_worker_id, v_month_end, p_assignment_id);

  if coalesce(v_wd_year,0) = 0 then
    v_calculated := 0;
  else
    v_wd_after := public.vacation_count_working_days(p_worker_id, (v_month_start + interval '1 month')::date, make_date(p_year,12,31), true, p_assignment_id);
    if coalesce(v_wd_after,0) = 0 then
      v_target := public.vacation_target_annual(p_worker_id, p_year, p_assignment_id);
      select coalesce(sum(calculated_amount), 0) into v_prev
      from public.worker_vacation_movements m
      where m.worker_id = p_worker_id and m.movement_type = 'ACCRUAL'
        and m.accrual_year = p_year and m.accrual_month < p_month
        and public.worker_vacation_row_in_contract(p_worker_id, p_assignment_id, m.assignment_id);
      v_calculated := greatest(0, round(v_target - v_prev, 4));
    else
      v_calculated := round(24 * v_wd_month::numeric / v_wd_year::numeric, 4);
    end if;
  end if;

  return jsonb_build_object(
    'calculated', v_calculated,
    'working_days_month', v_wd_month,
    'working_days_year', v_wd_year,
    'position_id', v_pos,
    'weekdays', to_jsonb(coalesce(v_weekdays, array[]::integer[]))
  );
end;
$$;

drop function if exists public.vacation_post_accrual_internal(uuid, integer, integer);
create or replace function public.vacation_post_accrual_internal(
  p_worker_id uuid,
  p_year integer,
  p_month integer,
  p_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%ROWTYPE;
  v_existing public.worker_vacation_movements%ROWTYPE;
  v_calc jsonb;
  v_calculated numeric(10,4);
  v_balance numeric(10,4);
  v_credited numeric(10,4);
  v_id uuid;
  v_effective date;
  v_assignment uuid;
begin
  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;

  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  perform pg_advisory_xact_lock(hashtextextended('worker_vacation_accrual:' || p_worker_id::text || ':' || coalesce(v_assignment::text, 'null'), 0));

  select * into v_existing from public.worker_vacation_movements
  where worker_id = p_worker_id and movement_type = 'ACCRUAL'
    and accrual_year = p_year and accrual_month = p_month
    and assignment_id is not distinct from v_assignment;
  if found then
    return jsonb_build_object('status','exists','movement_id',v_existing.id,'amount',v_existing.amount,'calculated',v_existing.calculated_amount);
  end if;

  v_calc := public.calculate_worker_vacation_accrual(p_worker_id, p_year, p_month, v_assignment);
  v_calculated := (v_calc->>'calculated')::numeric;
  v_effective := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);
  v_credited := round(least(v_calculated, greatest(0, 24 - v_balance)), 4);

  insert into public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, accrual_year, accrual_month, working_days_month, working_days_year,
    position_id, schedule_weekdays, description, created_by
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, 'ACCRUAL', v_credited, v_calculated,
    v_effective, p_year, p_month,
    nullif(v_calc->>'working_days_month','')::int, nullif(v_calc->>'working_days_year','')::int,
    nullif(v_calc->>'position_id','')::uuid,
    (select array_agg(x::int order by x::int) from jsonb_array_elements_text(v_calc->'weekdays') x),
    format('Devengo %s/%s', lpad(p_month::text, 2, '0'), p_year), auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('status','posted','movement_id',v_id,'amount',v_credited,'calculated',v_calculated,'balance', round(v_balance + v_credited, 4));
end;
$$;

drop function if exists public.post_worker_vacation_accrual(uuid, integer, integer);
create or replace function public.post_worker_vacation_accrual(
  p_worker_id uuid, p_year integer, p_month integer, p_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare v_worker public.workers%ROWTYPE;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;
  if not public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage') then
    raise exception 'Permission denied: vacations.manage is required in this entity';
  end if;
  return public.vacation_post_accrual_internal(p_worker_id, p_year, p_month, p_assignment_id);
end;
$$;

drop function if exists public.run_worker_vacation_catchup(uuid);
create or replace function public.run_worker_vacation_catchup(
  p_worker_id uuid,
  p_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%ROWTYPE;
  v_start date;
  v_end date;
  v_last_closed date;
  v_cursor date;
  v_posted int := 0;
  v_result jsonb;
  v_assignments uuid[];
  v_assignment uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;
  if not (public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage')
          or public.can_access_entity(v_worker.organization_entity_id, 'vacations.view')) then
    raise exception 'Permission denied: vacations access is required in this entity';
  end if;

  v_start := public.worker_vacation_accrual_start(p_worker_id);
  if v_start is null then return jsonb_build_object('posted', 0); end if;

  v_last_closed := (date_trunc('month', current_date) - interval '1 day')::date;

  -- Sin asignación explícita: se procesan TODOS los contratos vigentes.
  if p_assignment_id is null then
    v_assignments := array(
      select a.id from public.worker_position_assignments a
      where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null);
    if coalesce(array_length(v_assignments, 1), 0) = 0 then v_assignments := array[null]::uuid[]; end if;
  else
    v_assignments := array[public.resolve_vacation_assignment(p_worker_id, p_assignment_id)];
  end if;

  foreach v_assignment in array v_assignments loop
    v_end := public.worker_vacation_accrual_end(p_worker_id, v_assignment);
    v_last_closed := (date_trunc('month', current_date) - interval '1 day')::date;
    if v_end is not null and v_end < v_last_closed then v_last_closed := v_end; end if;

    v_cursor := date_trunc('month', v_start)::date;
    while v_cursor <= v_last_closed loop
      v_result := public.vacation_post_accrual_internal(p_worker_id, extract(year from v_cursor)::int, extract(month from v_cursor)::int, v_assignment);
      if v_result->>'status' = 'posted' then v_posted := v_posted + 1; end if;
      v_cursor := (v_cursor + interval '1 month')::date;
    end loop;
  end loop;

  return jsonb_build_object('posted', v_posted);
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. RESUMEN y REGISTRO/EDICIÓN/REVERSIÓN por contrato
-- ---------------------------------------------------------------------------
drop function if exists public.worker_vacation_summary(uuid);
create or replace function public.worker_vacation_summary(
  p_worker_id uuid,
  p_assignment_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%ROWTYPE;
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
  v_year int := extract(year from current_date)::int;
  v_weekdays integer[];
  v_cutoff date;
  v_assignment uuid;
  v_current_assignments integer;
  v_unassigned_movements integer;
  v_unassigned_days numeric(10,4);
  v_reconciliation boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;
  if not public.can_access_entity(v_worker.organization_entity_id, 'vacations.view') then
    raise exception 'Permission denied: vacations.view is required in this entity';
  end if;

  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);

  select coalesce(sum(amount), 0) into v_accrued_this
  from public.worker_vacation_movements m
  where m.worker_id = p_worker_id and m.movement_type = 'ACCRUAL' and m.accrual_year = v_year
    and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  select coalesce(-sum(amount), 0) into v_consumed_this
  from public.worker_vacation_movements m
  where m.worker_id = p_worker_id and m.movement_type in ('VACATION_USAGE','REVERSAL')
    and extract(year from m.effective_date)::int = v_year
    and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  v_calc := public.calculate_worker_vacation_accrual(p_worker_id, v_year, extract(month from current_date)::int, v_assignment);
  v_next := (v_calc->>'calculated')::numeric;
  v_projected := least(24, v_balance + v_next);
  v_status := case when v_balance >= 24 then 'LIMIT_REACHED'
                   when v_balance + v_next > 24 then 'NEAR_LIMIT'
                   else 'NORMAL' end;

  select * into v_current from public.worker_vacations v
    where v.worker_id = p_worker_id and v.status <> 'CANCELLED'
      and v.start_date <= current_date and v.end_date >= current_date
      and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id)
    order by v.start_date desc limit 1;

  select * into v_next_vac from public.worker_vacations v
    where v.worker_id = p_worker_id and v.status <> 'CANCELLED' and v.start_date > current_date
      and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id)
    order by v.start_date asc limit 1;

  select coalesce(sum(v.charged_days), 0) into v_scheduled from public.worker_vacations v
    where v.worker_id = p_worker_id and v.status <> 'CANCELLED' and v.start_date > current_date
      and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id);

  v_weekdays := public.worker_vacation_weekdays_on(p_worker_id, current_date, v_assignment);
  select max(m.effective_date) into v_cutoff from public.worker_vacation_movements m
    where m.worker_id = p_worker_id and m.movement_type = 'INITIAL_BALANCE'
      and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  -- CONCILIACIÓN PENDIENTE (Bloque 5.1): con VARIAS asignaciones vigentes, un movimiento
  -- histórico sin contrato identificado no se atribuye a ninguna, pero tampoco se excluye
  -- en silencio: el saldo por contrato no lo incluye y el resumen lo advierte. Con una sola
  -- asignación la asociación es inequívoca y la advertencia no se activa.
  select count(*) into v_current_assignments
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null;

  select count(*), coalesce(sum(m.amount), 0)
  into v_unassigned_movements, v_unassigned_days
  from public.worker_vacation_movements m
  where m.worker_id = p_worker_id and m.assignment_id is null;

  v_reconciliation := v_current_assignments > 1 and v_unassigned_movements > 0;

  return jsonb_build_object(
    'worker_id', p_worker_id,
    'assignment_id', v_assignment,
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
    'current_vacation_return', case when v_current.id is not null then v_current.end_date + 1 else null end,
    'next_vacation_start', v_next_vac.start_date,
    'next_vacation_end', v_next_vac.end_date,
    'opening_cutoff', v_cutoff,
    'has_schedule', v_weekdays is not null and coalesce(array_length(v_weekdays,1),0) > 0
  );
end;
$$;

drop function if exists public.register_worker_vacation(uuid, date, date, text, uuid);
create or replace function public.register_worker_vacation(
  p_worker_id uuid,
  p_start_date date,
  p_end_date date,
  p_notes text default null,
  p_request_id uuid default null,
  p_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%ROWTYPE;
  v_natural int;
  v_sundays int;
  v_charged numeric(10,4);
  v_balance numeric(10,4);
  v_existing public.worker_vacations%ROWTYPE;
  v_id uuid;
  v_status text;
  v_assignment uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'Las fechas de inicio y fin son obligatorias'; end if;

  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;
  if not public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage') then
    raise exception 'Permission denied: vacations.manage is required in this entity';
  end if;

  -- Contrato obligatorio si el trabajador tiene 2 contratos activos.
  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  perform pg_advisory_xact_lock(hashtextextended('worker_vacation:' || p_worker_id::text || ':' || coalesce(v_assignment::text, 'null'), 0));

  if p_request_id is not null then
    select * into v_existing from public.worker_vacations
    where worker_id = p_worker_id and request_id = p_request_id;
    if found then
      return jsonb_build_object('status','exists','vacation_id',v_existing.id,'charged_days',v_existing.charged_days);
    end if;
  end if;

  if p_end_date < p_start_date then raise exception 'La fecha final no puede ser anterior a la inicial'; end if;
  v_natural := (p_end_date - p_start_date) + 1;
  if v_natural > 15 then raise exception 'El período no puede superar 15 días naturales'; end if;

  v_sundays := (select count(*) from generate_series(p_start_date, p_end_date, interval '1 day') g(d) where extract(isodow from g.d)::int = 7);
  v_charged := v_natural - v_sundays;

  if exists (
    select 1 from public.worker_vacations v
    where v.worker_id = p_worker_id and v.status <> 'CANCELLED'
      and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, v.assignment_id)
      and p_start_date <= v.end_date and p_end_date >= v.start_date
  ) then
    raise exception 'El período se solapa con vacaciones ya registradas para este contrato' using errcode = '23505';
  end if;

  if coalesce(v_worker.employment_status, '') <> 'active' and p_start_date > current_date then
    raise exception 'No se pueden registrar vacaciones futuras para un trabajador inactivo';
  end if;

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);
  if v_charged > v_balance then
    raise exception 'Saldo insuficiente: el contrato dispone de % días y el período consumiría % días',
      to_char(v_balance, 'FM999990.00'), v_charged using errcode = '23514';
  end if;

  v_status := case when p_start_date <= current_date then 'TAKEN' else 'SCHEDULED' end;

  insert into public.worker_vacations (
    company_client_id, organization_entity_id, worker_id, assignment_id, start_date, end_date,
    natural_days, sundays_count, charged_days, status, notes, request_id, created_by
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, p_start_date, p_end_date,
    v_natural, v_sundays, v_charged, v_status, nullif(btrim(coalesce(p_notes, '')), ''), p_request_id, auth.uid()
  ) returning id into v_id;

  insert into public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, vacation_id, description, created_by
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, 'VACATION_USAGE', -v_charged, -v_charged,
    p_start_date, v_id,
    format('Vacaciones %s a %s (%s días descontados)', to_char(p_start_date, 'DD/MM/YYYY'), to_char(p_end_date, 'DD/MM/YYYY'), v_charged),
    auth.uid()
  );

  return jsonb_build_object('status','created','vacation_id',v_id,'assignment_id',v_assignment,'natural_days',v_natural,'sundays',v_sundays,'charged_days',v_charged,'balance', round(v_balance - v_charged, 4));
end;
$$;

-- Cancelación: usa la asignación GUARDADA en la vacación (no requiere parámetro nuevo).
create or replace function public.cancel_worker_vacation(p_vacation_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare v public.worker_vacations%ROWTYPE;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v from public.worker_vacations where id = p_vacation_id;
  if not found then raise exception 'Vacation period was not found'; end if;
  if not public.can_access_entity(v.organization_entity_id, 'vacations.manage') then
    raise exception 'Permission denied: vacations.manage is required in this entity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('worker_vacation:' || v.worker_id::text || ':' || coalesce(v.assignment_id::text, 'null'), 0));

  if v.status = 'CANCELLED' then
    return jsonb_build_object('status','already_cancelled','balance', public.worker_vacation_balance(v.worker_id, v.assignment_id));
  end if;

  update public.worker_vacations
  set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(),
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
  where id = p_vacation_id;

  insert into public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, vacation_id, description, created_by
  ) values (
    v.company_client_id, v.organization_entity_id, v.worker_id, v.assignment_id, 'REVERSAL', v.charged_days, v.charged_days,
    current_date, v.id,
    format('Reversión por cancelación (%s a %s)', to_char(v.start_date, 'DD/MM/YYYY'), to_char(v.end_date, 'DD/MM/YYYY')),
    auth.uid()
  );

  return jsonb_build_object('status','cancelled','reversed_days', v.charged_days, 'balance', public.worker_vacation_balance(v.worker_id, v.assignment_id));
end;
$$;

drop function if exists public.adjust_worker_vacation_balance(uuid, numeric, text, date);
create or replace function public.adjust_worker_vacation_balance(
  p_worker_id uuid, p_amount numeric, p_reason text, p_effective_date date default null, p_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%ROWTYPE;
  v_balance numeric(10,4);
  v_effective date := coalesce(p_effective_date, current_date);
  v_id uuid;
  v_assignment uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'El ajuste debe ser distinto de cero'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'El motivo del ajuste es obligatorio'; end if;

  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;
  if not public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage') then
    raise exception 'Permission denied: vacations.manage is required in this entity';
  end if;

  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  perform pg_advisory_xact_lock(hashtextextended('worker_vacation:' || p_worker_id::text || ':' || coalesce(v_assignment::text, 'null'), 0));

  v_balance := public.worker_vacation_balance(p_worker_id, v_assignment);
  if v_balance + p_amount > 24 then raise exception 'El saldo no puede superar 24 días'; end if;
  if v_balance + p_amount < 0 then raise exception 'El saldo no puede quedar negativo'; end if;

  insert into public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, reason, description, created_by
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, 'ADJUSTMENT', round(p_amount,4), round(p_amount,4),
    v_effective, btrim(p_reason), format('Ajuste manual: %s', btrim(p_reason)), auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('status','adjusted','movement_id',v_id,'assignment_id',v_assignment,'balance', round(v_balance + p_amount, 4));
end;
$$;

drop function if exists public.set_worker_vacation_opening_balance(uuid, numeric, date);
create or replace function public.set_worker_vacation_opening_balance(
  p_worker_id uuid, p_amount numeric, p_cutoff_date date, p_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%ROWTYPE;
  v_id uuid;
  v_assignment uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_cutoff_date is null then raise exception 'La fecha de corte es obligatoria'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 24 then raise exception 'El saldo inicial debe estar entre 0 y 24 días'; end if;

  select * into v_worker from public.workers where id = p_worker_id;
  if not found then raise exception 'Worker was not found'; end if;
  if not public.can_access_entity(v_worker.organization_entity_id, 'vacations.manage') then
    raise exception 'Permission denied: vacations.manage is required in this entity';
  end if;

  v_assignment := public.resolve_vacation_assignment(p_worker_id, p_assignment_id);

  perform pg_advisory_xact_lock(hashtextextended('worker_vacation:' || p_worker_id::text || ':' || coalesce(v_assignment::text, 'null'), 0));

  if exists (
    select 1 from public.worker_vacation_movements m
    where m.worker_id = p_worker_id and m.movement_type = 'ACCRUAL' and m.effective_date > p_cutoff_date
      and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id)
  ) then
    raise exception 'Ya existen devengos posteriores a la fecha de corte; no se puede reinicializar el saldo';
  end if;

  delete from public.worker_vacation_movements m
  where m.worker_id = p_worker_id and m.movement_type = 'INITIAL_BALANCE'
    and public.worker_vacation_row_in_contract(p_worker_id, v_assignment, m.assignment_id);

  insert into public.worker_vacation_movements (
    company_client_id, organization_entity_id, worker_id, assignment_id, movement_type, amount, calculated_amount,
    effective_date, description, created_by
  ) values (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment, 'INITIAL_BALANCE', round(p_amount,4), round(p_amount,4),
    p_cutoff_date, format('Saldo inicial a %s', to_char(p_cutoff_date, 'DD/MM/YYYY')), auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('status','opening_set','movement_id',v_id,'assignment_id',v_assignment,'balance', round(p_amount,4));
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. VISTA DE ENTIDAD: una fila por contrato vigente (o legacy sin contrato)
-- ---------------------------------------------------------------------------
drop function if exists public.entity_vacation_overview(uuid);
create or replace function public.entity_vacation_overview(p_entity_id uuid)
returns TABLE(worker_id uuid, assignment_id uuid, full_name text, area_name text, job_name text, position_name text, balance numeric, next_accrual numeric, projected_balance numeric, status text, scheduled_future_days numeric, current_vacation_end date, next_vacation_start date, has_schedule boolean, active_vacation boolean, reconciliation_required boolean)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  w record;
  a record;
  s jsonb;
  v_weekdays integer[];
  v_has_assignment boolean;
  v_reconciliation boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (public.can_access_entity(p_entity_id, 'vacations.view') or public.can_access_entity(p_entity_id, 'vacations.manage')) then
    raise exception 'Permission denied: vacations.view is required in this entity';
  end if;

  for w in
    select wk.* from public.workers wk
    where wk.organization_entity_id = p_entity_id and wk.employment_status = 'active'
    order by wk.first_surname, wk.first_name
  loop
    v_has_assignment := false;
    for a in
      select a2.id as assignment_id, a2.position_id as position_id
      from public.worker_position_assignments a2
      where a2.worker_id = w.id and a2.is_current = true and a2.end_date is null
      order by a2.start_date
    loop
      v_has_assignment := true;
      perform public.run_worker_vacation_catchup(w.id, a.assignment_id);
      s := public.worker_vacation_summary(w.id, a.assignment_id);

      worker_id := w.id;
      assignment_id := a.assignment_id;
      full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));

      select ar.name into area_name
      from public.organization_positions p
      join public.organization_jobs j on j.id = p.job_id
      join public.organization_areas ar on ar.id = j.area_id
      where p.id = a.position_id;

      select j.name into job_name
      from public.organization_positions p
      join public.organization_jobs j on j.id = p.job_id
      where p.id = a.position_id;

      select p.name into position_name
      from public.organization_positions p where p.id = a.position_id;

      balance := (s->>'balance')::numeric;
      next_accrual := (s->>'next_accrual')::numeric;
      projected_balance := (s->>'projected_balance')::numeric;
      status := s->>'status';
      scheduled_future_days := (s->>'scheduled_future_days')::numeric;
      current_vacation_end := (s->>'current_vacation_end')::date;
      next_vacation_start := (s->>'next_vacation_start')::date;
      v_weekdays := public.worker_vacation_weekdays_on(w.id, current_date, a.assignment_id);
      has_schedule := v_weekdays is not null and coalesce(array_length(v_weekdays,1),0) > 0;
      active_vacation := current_vacation_end is not null;
      v_reconciliation := coalesce((s->>'reconciliation_required')::boolean, false);
      reconciliation_required := v_reconciliation;

      return next;
    end loop;

    -- Trabajador sin contrato vigente: se conserva su fila legacy (sin asignación).
    if not v_has_assignment then
      perform public.run_worker_vacation_catchup(w.id, null);
      s := public.worker_vacation_summary(w.id, null);

      worker_id := w.id;
      assignment_id := null;
      full_name := btrim(w.first_name || ' ' || w.first_surname || ' ' || coalesce(w.second_surname, ''));
      area_name := null; job_name := null; position_name := null;
      balance := (s->>'balance')::numeric;
      next_accrual := (s->>'next_accrual')::numeric;
      projected_balance := (s->>'projected_balance')::numeric;
      status := s->>'status';
      scheduled_future_days := (s->>'scheduled_future_days')::numeric;
      current_vacation_end := (s->>'current_vacation_end')::date;
      next_vacation_start := (s->>'next_vacation_start')::date;
      v_weekdays := public.worker_vacation_weekdays_on(w.id, current_date, null);
      has_schedule := v_weekdays is not null and coalesce(array_length(v_weekdays,1),0) > 0;
      active_vacation := current_vacation_end is not null;
      v_reconciliation := coalesce((s->>'reconciliation_required')::boolean, false);
      reconciliation_required := v_reconciliation;

      return next;
    end if;
  end loop;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 7. PERMISOS
-- ---------------------------------------------------------------------------
grant execute on function public.resolve_vacation_assignment(uuid, uuid) to authenticated;
grant execute on function public.worker_vacation_row_in_contract(uuid, uuid, uuid) to authenticated;
revoke execute on function public.resolve_vacation_assignment(uuid, uuid) from public, anon;
revoke execute on function public.worker_vacation_row_in_contract(uuid, uuid, uuid) from public, anon;

grant execute on function public.worker_position_on(uuid, date, uuid) to authenticated;
grant execute on function public.worker_vacation_weekdays_on(uuid, date, uuid) to authenticated;
grant execute on function public.vacation_count_working_days(uuid, date, date, boolean, uuid) to authenticated;
grant execute on function public.vacation_target_annual(uuid, integer, uuid) to authenticated;
grant execute on function public.worker_vacation_accrual_end(uuid, uuid) to authenticated;
grant execute on function public.worker_vacation_balance(uuid, uuid) to authenticated;
grant execute on function public.calculate_worker_vacation_accrual(uuid, integer, integer, uuid) to authenticated;
grant execute on function public.vacation_post_accrual_internal(uuid, integer, integer, uuid) to authenticated;
grant execute on function public.post_worker_vacation_accrual(uuid, integer, integer, uuid) to authenticated;
grant execute on function public.run_worker_vacation_catchup(uuid, uuid) to authenticated;
grant execute on function public.worker_vacation_summary(uuid, uuid) to authenticated;
grant execute on function public.register_worker_vacation(uuid, date, date, text, uuid, uuid) to authenticated;
grant execute on function public.adjust_worker_vacation_balance(uuid, numeric, text, date, uuid) to authenticated;
grant execute on function public.set_worker_vacation_opening_balance(uuid, numeric, date, uuid) to authenticated;
grant execute on function public.entity_vacation_overview(uuid) to authenticated;

revoke execute on function public.worker_position_on(uuid, date, uuid) from public, anon;
revoke execute on function public.worker_vacation_weekdays_on(uuid, date, uuid) from public, anon;
revoke execute on function public.vacation_count_working_days(uuid, date, date, boolean, uuid) from public, anon;
revoke execute on function public.vacation_target_annual(uuid, integer, uuid) from public, anon;
revoke execute on function public.worker_vacation_accrual_end(uuid, uuid) from public, anon;
revoke execute on function public.worker_vacation_balance(uuid, uuid) from public, anon;
revoke execute on function public.calculate_worker_vacation_accrual(uuid, integer, integer, uuid) from public, anon;
revoke execute on function public.vacation_post_accrual_internal(uuid, integer, integer, uuid) from public, anon;
revoke execute on function public.post_worker_vacation_accrual(uuid, integer, integer, uuid) from public, anon;
revoke execute on function public.run_worker_vacation_catchup(uuid, uuid) from public, anon;
revoke execute on function public.worker_vacation_summary(uuid, uuid) from public, anon;
revoke execute on function public.register_worker_vacation(uuid, date, date, text, uuid, uuid) from public, anon;
revoke execute on function public.adjust_worker_vacation_balance(uuid, numeric, text, date, uuid) from public, anon;
revoke execute on function public.set_worker_vacation_opening_balance(uuid, numeric, date, uuid) from public, anon;
revoke execute on function public.entity_vacation_overview(uuid) from public, anon;


-- ============================================================================
-- FIN DEL BLOQUE 4 (B) — APLICADO en Supabase (con la corrección del índice de
-- devengos por contrato de la sección 1).
-- ============================================================================
