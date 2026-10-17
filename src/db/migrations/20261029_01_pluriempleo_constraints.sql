-- ============================================================================
-- PLURIEMPLEO — BLOQUE 1: PREPARACIÓN DE ESQUEMA
-- Estado: PREPARADA · NO EJECUTADA (pendiente de autorización explícita).
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
-- Cuando se autorice, se aplicará contra la base de datos y se conservará como
-- evidencia del cambio real, igual que el resto de registros de este directorio.
--
-- OBJETIVO (sólo lo imprescindible para admitir 2 contratos activos por trabajador)
--   1. Adaptar los índices de relaciones vigentes de `worker_position_assignments`
--      y `employment_contracts` para admitir dos relaciones vigentes, sin permitir
--      duplicar el MISMO puesto.
--   2. Garantizar el máximo de 2 contratos activos con una validación segura ante
--      concurrencia (trigger que serializa por trabajador), sin depender sólo de
--      los índices.
--   3. Adaptar el histórico salarial para permitir registros independientes por
--      contrato en una misma fecha, conservando la deduplicación por contrato.
--   4. Adaptar `prenomina_worker_entries` para una entrada por contrato y período,
--      preservando la integridad de los datos existentes.
--   5. Dejar las referencias contractuales estrictamente necesarias para
--      identificar cada contrato en cálculos y movimientos, reutilizando columnas
--      ya existentes siempre que ha sido posible.
--
-- LO QUE **NO** HACE ESTE BLOQUE
--   · No toca datos existentes (no duplica trabajadores, no reescribe contratos).
--   · No crea arquitectura de nómina nueva ni fórmulas salariales.
--   · No modifica las RPC de contratación ni el frontend.
--
-- ORDEN SEGURO DE APLICACIÓN
--   1) índices de vigencia  2) triggers de límite  3) índice de histórico salarial
--   4) columnas + claves de prenómina. Todo dentro de una transacción.
--
-- Nombres de índice CONSERVADOS a propósito: `wpa_current_per_worker_unique` es
-- referenciado por `create_worker_with_position` (SQLERRM LIKE '%wpa_current_per_worker_unique%')
-- para devolver «El trabajador ya tiene un puesto actual asignado». Redefinir el
-- índice con el MISMO nombre mantiene ese mensaje cuando se intenta duplicar el puesto.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. RELACIONES VIGENTES: admitir hasta dos por trabajador
--    - Asignaciones: única por (trabajador, puesto) → dos puestos distintos OK,
--      repetir el mismo puesto NO.
--    - Contratos: única por (trabajador, asignación) → dos contratos vigentes en
--      asignaciones distintas OK; nunca dos vigentes sobre la misma asignación.
--    Ambas claves son parciales (`is_current`), así que los contratos/asignaciones
--    FINALIZADOS no cuentan (regla: los finalizados no cuentan para el límite).
-- ---------------------------------------------------------------------------
drop index if exists public.wpa_current_per_worker_unique;
create unique index wpa_current_per_worker_unique
  on public.worker_position_assignments (worker_id, position_id)
  where is_current = true and end_date is null;

drop index if exists public.ec_current_per_worker_unique;
create unique index ec_current_per_worker_unique
  on public.employment_contracts (worker_id, assignment_id)
  where is_current = true;


-- ---------------------------------------------------------------------------
-- 2. LÍMITE DE 2 CONTRATOS ACTIVOS (seguro ante concurrencia)
--    Los índices anteriores NO pueden expresar «máximo 2». Se añade un trigger que:
--      · bloquea la fila del trabajador (`FOR UPDATE`) → serializa altas
--        concurrentes del MISMO trabajador (evita carreras entre transacciones);
--      · cuenta los contratos vigentes del trabajador (excluyendo la fila nueva);
--      · lanza si ya hay 2.
--    Se aplica a TODAS las rutas de escritura (cualquier RPC que inserte/active un
--    contrato pasa por aquí), sin modificar ninguna RPC.
--
--    Orden comprobado en las RPC actuales: `complete_worker_contract`,
--    `change_worker_contract` y `reincorporate_worker` cierran el contrato vigente
--    ANTES de insertar el nuevo, por lo que el trigger no da falsos positivos.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_worker_contract_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_active integer;
begin
  -- Sólo vigila contratos VIGENTES.
  if new.is_current is not true then
    return new;
  end if;

  -- Serializa altas concurrentes del mismo trabajador (lock de la fila del trabajador).
  perform 1 from public.workers where id = new.worker_id for update;

  select count(*) into v_active
  from public.employment_contracts c
  where c.worker_id = new.worker_id
    and c.is_current = true
    and c.id <> new.id;

  if v_active >= 2 then
    raise exception 'El trabajador ya tiene 2 contratos activos: no se puede crear un tercero'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists employment_contracts_enforce_limit on public.employment_contracts;
create trigger employment_contracts_enforce_limit
  before insert or update on public.employment_contracts
  for each row execute function public.enforce_worker_contract_limit();


-- Mismo límite sobre las asignaciones vigentes, para mantener asignaciones y
-- contratos alineados y cubrir también la ruta `link_worker_to_position`
-- (que hoy crea asignación sin contrato).
create or replace function public.enforce_worker_assignment_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_active integer;
begin
  if new.is_current is not true or new.end_date is not null then
    return new;
  end if;

  perform 1 from public.workers where id = new.worker_id for update;

  select count(*) into v_active
  from public.worker_position_assignments a
  where a.worker_id = new.worker_id
    and a.is_current = true
    and a.end_date is null
    and a.id <> new.id;

  if v_active >= 2 then
    raise exception 'El trabajador ya tiene 2 puestos vigentes: no se puede crear un tercero'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists worker_position_assignments_enforce_limit on public.worker_position_assignments;
create trigger worker_position_assignments_enforce_limit
  before insert or update on public.worker_position_assignments
  for each row execute function public.enforce_worker_assignment_limit();


-- ---------------------------------------------------------------------------
-- 3. HISTÓRICO SALARIAL: registros independientes POR CONTRATO
--    Se añade `employment_contract_id` a la clave de deduplicación, conservando
--    las reglas existentes (una fila por trabajador + contrato + tipo + fecha).
--    `coalesce(..., '000...')` mantiene la deduplicación de filas antiguas sin
--    contrato (los NULL son distintos entre sí en un índice único).
--    Se conserva el nombre del índice (usado por `record_worker_salary_event`,
--    que hace `ON CONFLICT DO NOTHING` sin destino explícito).
-- ---------------------------------------------------------------------------
drop index if exists public.worker_salary_history_period_start_unique;
create unique index worker_salary_history_period_start_unique
  on public.worker_salary_history (
    worker_id,
    coalesce(employment_contract_id, '00000000-0000-0000-0000-000000000000'::uuid),
    change_type,
    effective_date
  )
  where change_type in ('INITIAL_CONTRACT', 'CONTRACT_CHANGE', 'REINCORPORATION');

drop index if exists public.worker_salary_history_scale_change_unique;
create unique index worker_salary_history_scale_change_unique
  on public.worker_salary_history (
    worker_id,
    coalesce(employment_contract_id, '00000000-0000-0000-0000-000000000000'::uuid),
    salary_group_value_id
  )
  where change_type = 'SALARY_SCALE_CHANGE' and salary_group_value_id is not null;


-- ---------------------------------------------------------------------------
-- 4. PRENÓMINA: una entrada por CONTRATO y período
--    Se añaden las referencias al contrato/asignación (NULL-ables, porque las
--    filas históricas no las tienen). La antigua unicidad (período, trabajador)
--    se conserva EXACTAMENTE para las filas sin asignación mediante un índice
--    parcial, y se añade la nueva unicidad (período, asignación) para las filas
--    nuevas. Así los datos existentes mantienen su integridad sin backfill.
-- ---------------------------------------------------------------------------
alter table public.prenomina_worker_entries
  add column if not exists assignment_id uuid
    references public.worker_position_assignments(id) on delete set null,
  add column if not exists employment_contract_id uuid
    references public.employment_contracts(id) on delete set null;

-- La restricción original pasa a ser un índice parcial equivalente (sólo filas sin asignación).
alter table public.prenomina_worker_entries
  drop constraint if exists prenomina_worker_entries_period_worker_unique;

create unique index if not exists prenomina_worker_entries_period_worker_unique
  on public.prenomina_worker_entries (period_id, worker_id)
  where assignment_id is null;

create unique index if not exists prenomina_worker_entries_period_assignment_unique
  on public.prenomina_worker_entries (period_id, assignment_id)
  where assignment_id is not null;

create index if not exists idx_prenomina_worker_entries_contract
  on public.prenomina_worker_entries (employment_contract_id);


-- ---------------------------------------------------------------------------
-- 5. REFERENCIAS CONTRACTUALES EN CÁLCULOS Y MOVIMIENTOS
--    NO se crean columnas nuevas: se reutilizan las existentes.
--      · worker_payroll_movements.assignment_id / position_id / event_id  (ya existen)
--      · worker_employment_movements.previous_assignment_id / new_assignment_id (ya existen)
--      · worker_salary_history.assignment_id / employment_contract_id  (ya existen)
--      · prenomina_worker_entries.assignment_id / employment_contract_id  (añadidas §4)
--    La identificación del contrato en los movimientos de nómina (evitar la
--    colisión del índice `worker_payroll_movements_dedup_idx` entre dos altas en
--    la misma fecha) se resolverá en el Bloque 2 pasando `event_id = assignment_id`.
-- ---------------------------------------------------------------------------


-- ============================================================================
-- FIN DEL BLOQUE 1 — NO EJECUTADO.
-- ============================================================================
