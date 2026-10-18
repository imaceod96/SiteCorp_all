-- ============================================================================
-- HISTORIAL — Auditoría centralizada de SiteCorp (Etapa A)
-- ----------------------------------------------------------------------------
-- PROPÓSITO
--   Fuente ÚNICA de eventos de auditoría: operaciones administrativas y de negocio que
--   deben poder reconstruirse después. No es un log de navegación ni de consultas.
--
--   Sustituye a la ausencia total de auditoría: `auth.audit_log_entries` está vacía en este
--   proyecto y no hay ninguna tabla de auditoría en `public`. NO se crea un sistema paralelo:
--   este es el único mecanismo, y los históricos de dominio que YA existen
--   (`document_generation_events`, `worker_employment_movements`, `worker_salary_history`,
--   `worker_vacation_movements`, `worker_payroll_movements`) siguen siendo la historia
--   propia de cada módulo: la auditoría los referencia, no los duplica.
--
-- DECISIONES CLAVE
--   · SIN CLAVES FORÁNEAS: el evento guarda el ID y el NOMBRE del ejecutor y de la entidad
--     COPIADOS. Así el histórico sobrevive al borrado del usuario o de la entidad, y la
--     auditoría nunca puede bloquear una eliminación legítima.
--   · INMUTABLE: sólo SELECT para `authenticated` (y sólo SuperAdmin por RLS). No hay
--     políticas de INSERT/UPDATE/DELETE, no se conceden esos privilegios y un disparador
--     bloquea UPDATE/DELETE incluso con `service_role`.
--   · ESCRITURA SÓLO DESDE SERVIDOR: la función `record_audit_event` es SECURITY DEFINER y
--     NO se concede a `authenticated`; la usan los disparadores y las Edge Functions.
--   · SIN DATOS SENSIBLES: no se guardan contraseñas, tokens ni claves. `old_values` y
--     `new_values` son opcionales y deben contener sólo campos no sensibles.
--
-- ESTADO: NO EJECUTADO. Requiere autorización expresa antes de aplicarse.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabla de eventos (sin FK, por diseño)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_events (
  id                     uuid primary key default gen_random_uuid(),
  occurred_at            timestamptz not null default now(),

  -- Ejecutor (identificador + nombre CONSERVADO en el momento del hecho)
  actor_user_id          uuid,
  actor_full_name        text,
  actor_username         text,

  -- Ámbito
  scope                  text not null default 'SITECORP',
  organization_entity_id uuid,
  entity_name            text,
  company_client_id      uuid,

  -- Qué ocurrió
  module                 text not null,
  action                 text not null,
  entity_type            text,
  record_id              text,
  description            text not null,
  old_values             jsonb,
  new_values             jsonb,
  result                 text not null default 'SUCCESS',

  constraint audit_events_scope_check check (scope in ('SITECORP', 'ENTITY')),
  constraint audit_events_result_check check (result in ('SUCCESS', 'FAILURE', 'DENIED')),
  constraint audit_events_module_not_blank check (btrim(module) <> ''),
  constraint audit_events_action_not_blank check (btrim(action) <> ''),
  constraint audit_events_description_not_blank check (btrim(description) <> '')
);

comment on table public.audit_events is
  'Historial de SiteCorp: eventos de auditoría inmutables. Sin FK a propósito: conservan nombre e identificador del ejecutor y de la entidad aunque se eliminen.';

-- ----------------------------------------------------------------------------
-- 2. Índices para la consulta paginada y los filtros combinables
-- ----------------------------------------------------------------------------
create index if not exists audit_events_occurred_at_idx
  on public.audit_events (occurred_at desc);

create index if not exists audit_events_scope_occurred_at_idx
  on public.audit_events (scope, occurred_at desc);

create index if not exists audit_events_entity_occurred_at_idx
  on public.audit_events (organization_entity_id, occurred_at desc);

create index if not exists audit_events_actor_occurred_at_idx
  on public.audit_events (actor_user_id, occurred_at desc);

create index if not exists audit_events_module_occurred_at_idx
  on public.audit_events (module, occurred_at desc);

create index if not exists audit_events_result_idx
  on public.audit_events (result);

create index if not exists audit_events_record_id_idx
  on public.audit_events (record_id);

-- ----------------------------------------------------------------------------
-- 3. Grants de la Data API (lectura sí, escritura no)
-- ----------------------------------------------------------------------------
revoke all on table public.audit_events from anon;
revoke insert, update, delete, truncate on table public.audit_events from authenticated;

grant select on table public.audit_events to authenticated;
grant select, insert on table public.audit_events to service_role;

-- ----------------------------------------------------------------------------
-- 4. RLS: sólo SuperAdmin lee. Nadie escribe desde el cliente.
-- ----------------------------------------------------------------------------
alter table public.audit_events enable row level security;

drop policy if exists "audit_events_select_superadmin" on public.audit_events;
create policy "audit_events_select_superadmin"
  on public.audit_events
  for select
  to authenticated
  using (public.is_platform_superadmin());

-- ----------------------------------------------------------------------------
-- 5. Inmutabilidad: ni UPDATE ni DELETE (tampoco con service_role)
-- ----------------------------------------------------------------------------
create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Los eventos del Historial son inmutables: no se pueden modificar ni eliminar.'
    using errcode = '42501';
end;
$$;

revoke all on function public.prevent_audit_event_mutation() from public;

drop trigger if exists audit_events_no_mutation on public.audit_events;
create trigger audit_events_no_mutation
  before update or delete on public.audit_events
  for each row execute function public.prevent_audit_event_mutation();

-- ----------------------------------------------------------------------------
-- 6. Mecanismo ÚNICO de escritura
-- ----------------------------------------------------------------------------
-- La usan los disparadores de las tablas auditadas y las Edge Functions (con service_role).
-- Cuando el actor no se indica, se resuelve desde la sesión (`auth.uid()`).
-- NO se concede a `authenticated`: un cliente no puede fabricar eventos.
create or replace function public.record_audit_event(
  p_module text,
  p_action text,
  p_description text,
  p_scope text default 'SITECORP',
  p_organization_entity_id uuid default null,
  p_entity_name text default null,
  p_company_client_id uuid default null,
  p_entity_type text default null,
  p_record_id text default null,
  p_old_values jsonb default null,
  p_new_values jsonb default null,
  p_result text default 'SUCCESS',
  p_actor_user_id uuid default null,
  p_actor_full_name text default null,
  p_actor_username text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, auth.uid());
  v_full_name text := p_actor_full_name;
  v_username text := p_actor_username;
  v_profile record;
  v_entity_name text := p_entity_name;
  v_id uuid := gen_random_uuid();
begin
  -- Nombre CONSERVADO del ejecutor: se copia ahora, no se resuelve después.
  if v_actor is not null and (v_full_name is null or v_username is null) then
    select p.full_name, p.username into v_profile
    from public.profiles p
    where p.id = v_actor;

    v_full_name := coalesce(v_full_name, v_profile.full_name);
    v_username := coalesce(v_username, v_profile.username);
  end if;

  -- Nombre de la entidad, también copiado.
  if v_entity_name is null and p_organization_entity_id is not null then
    select oe.name into v_entity_name
    from public.organization_entities oe
    where oe.id = p_organization_entity_id;

    v_entity_name := coalesce(v_entity_name, p_entity_name);
  end if;

  insert into public.audit_events (
    id, actor_user_id, actor_full_name, actor_username,
    scope, organization_entity_id, entity_name, company_client_id,
    module, action, entity_type, record_id, description,
    old_values, new_values, result
  ) values (
    v_id, v_actor, v_full_name, v_username,
    coalesce(nullif(btrim(p_scope), ''), 'SITECORP'),
    p_organization_entity_id, v_entity_name, p_company_client_id,
    p_module, p_action, p_entity_type, p_record_id, p_description,
    p_old_values, p_new_values,
    coalesce(nullif(btrim(p_result), ''), 'SUCCESS')
  );

  return v_id;
end;
$$;

comment on function public.record_audit_event is
  'Único punto de escritura del Historial. SECURITY DEFINER: sólo lo usan disparadores y Edge Functions.';

revoke all on function public.record_audit_event(
  text, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, text, uuid, text, text
) from public;
revoke all on function public.record_audit_event(
  text, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, text, uuid, text, text
) from anon;
revoke all on function public.record_audit_event(
  text, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, text, uuid, text, text
) from authenticated;
grant execute on function public.record_audit_event(
  text, text, text, text, uuid, text, uuid, text, text, jsonb, jsonb, text, uuid, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Instrumentación (ETAPA C — NO incluida aquí)
-- ----------------------------------------------------------------------------
-- Los disparadores se añadirán en migraciones posteriores, empezando por:
--   · platform_user_roles  (alta/baja de roles)          → módulo 'roles'
--   · platform_roles / platform_role_permissions        → módulo 'roles'
--   · profiles.is_active (activación/desactivación)     → módulo 'users'
--   · organization_entities (alta/cambio/desactivación)  → módulo 'entities'
--   · governing_documents / platform_documents           → módulo 'documents'
-- y después los módulos laborales (candidatos, trabajadores, contratos, puestos, salario,
-- pluriempleo, nómina, vacaciones).
--
-- Regla para operaciones críticas: el disparador escribe el evento en la MISMA transacción
-- que el cambio; si la auditoría falla, el cambio se revierte (no hay modificación sin
-- registro). En las Edge Functions la escritura se hace con `record_audit_event` y, cuando
-- la trazabilidad es obligatoria, la operación se aborta si la auditoría falla.
