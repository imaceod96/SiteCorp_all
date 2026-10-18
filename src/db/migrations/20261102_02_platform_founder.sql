-- ============================================================================
-- SUPER ADMIN FUNDADOR — Identificación persistente y protección (Etapa B)
-- ----------------------------------------------------------------------------
-- PROPÓSITO
--   Reservar EXCLUSIVAMENTE a una cuenta (la fundadora) la facultad de asignar y retirar el
--   rol SuperAdmin, y proteger esa cuenta frente a eliminación, desactivación y retirada
--   accidental de su rol.
--
--   No se crea un sistema de roles paralelo: se sigue usando `platform_roles` /
--   `platform_user_roles`. Lo único nuevo es la IDENTIFICACIÓN de la cuenta fundadora y las
--   guardas que limitan las operaciones sobre el rol SuperAdmin.
--
-- IDENTIFICACIÓN
--   `public.platform_founder` es una tabla de UNA SOLA FILA. La identidad es el UUID de
--   Supabase Auth (`user_id`), nunca el correo ni el username.
--
--   Cuenta fundadora CONFIRMADA: `admin` · e7062a40-bc05-4ffb-a5a5-ba73d1ab116f
--
-- LO QUE ESTA MIGRACIÓN **NO** HACE
--   · No inserta, modifica ni elimina NINGUNA fila de `platform_user_roles`: las
--     asignaciones de rol actuales (incluida la de la cuenta `pedro`) quedan intactas.
--     La tabla de roles se LEE para validar, nunca se escribe.
--   · No altera permisos ni políticas de las tablas existentes.
--   · No crea ningún rol nuevo.
--
-- SEGURIDAD ANTE ERRORES
--   Todo el bloque de designación valida ANTES de escribir y aborta con un mensaje explícito
--   si algo no cuadra (cuenta inexistente, perfil inactivo, sin rol SuperAdmin, otra cuenta
--   ya designada). Un `raise` revierte la migración completa en la transacción de aplicación:
--   nunca puede quedar aplicada a medias ni con una cuenta equivocada.
--
-- BORRADOS EN CASCADA
--   Eliminar una cuenta arrastra sus asignaciones de rol por integridad referencial. Esa
--   cascada se autoriza con una prueba POSITIVA (disparador anidado o el servicio de Auth),
--   nunca por la mera ausencia de sesión, y la vía de las Edge Functions (`service_role`)
--   queda siempre sujeta a la regla: con `auth.uid()` nulo y `service_role` la operación se
--   rechaza.
--
-- ESTADO: NO EJECUTADO. Requiere autorización expresa antes de aplicarse.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Identificación persistente de la cuenta fundadora (una sola fila)
-- ----------------------------------------------------------------------------
create table if not exists public.platform_founder (
  user_id       uuid primary key references auth.users(id) on delete restrict,
  -- Columna de relleno que garantiza UNA SOLA FILA (patrón estándar de tabla unitaria):
  -- vale siempre `true`, así que la restricción única no admite una segunda fila. Lleva valor
  -- por defecto: quien designa la cuenta fundadora no tiene que indicarla.
  single_row    boolean not null default true,
  designated_at timestamptz not null default now(),
  designated_by uuid,
  note          text,
  constraint platform_founder_single_row_unique unique (single_row),
  constraint platform_founder_single_row_true check (single_row)
);

comment on table public.platform_founder is
  'Cuenta fundadora de SiteCorp (una sola fila, garantizada por `single_row`). Su user_id es el UUID de Supabase Auth. No se puede eliminar ni desactivar, y sólo la designa una migración explícita.';

comment on column public.platform_founder.single_row is
  'Siempre `true`: junto con la restricción única, impide que exista más de una cuenta fundadora.';

-- ----------------------------------------------------------------------------
-- 2. Grants y RLS: legible por SuperAdmin, escritura sólo del propietario
-- ----------------------------------------------------------------------------
-- La designación del fundador NO se puede hacer desde la aplicación ni con la service role:
-- sólo la realiza una migración explícita (propietario de la tabla). Así ninguna operación
-- ordinaria ni ninguna Edge Function puede sustituir la cuenta fundadora.
grant select on table public.platform_founder to authenticated;
grant select on table public.platform_founder to service_role;

revoke insert, update, delete, truncate on table public.platform_founder from authenticated;
revoke insert, update, delete, truncate on table public.platform_founder from service_role;
revoke all on table public.platform_founder from anon;

alter table public.platform_founder enable row level security;

drop policy if exists "platform_founder_select_superadmin" on public.platform_founder;
create policy "platform_founder_select_superadmin"
  on public.platform_founder
  for select
  to authenticated
  using (public.is_platform_superadmin());

-- ----------------------------------------------------------------------------
-- 3. Funciones de identificación
-- ----------------------------------------------------------------------------
-- ¿La sesión actual es la cuenta fundadora?
create or replace function public.is_platform_founder()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.platform_founder f where f.user_id = auth.uid()
  );
$$;

-- ¿El usuario indicado es la cuenta fundadora? (para las guardas, no depende de la sesión)
create or replace function public.is_founder_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_founder f where f.user_id = target_user_id
  );
$$;

revoke all on function public.is_platform_founder() from public, anon;
revoke all on function public.is_founder_user(uuid) from public, anon;
grant execute on function public.is_platform_founder() to authenticated, service_role;
grant execute on function public.is_founder_user(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Guarda del rol SuperAdmin en `platform_user_roles` (INSERT, UPDATE y DELETE)
-- ----------------------------------------------------------------------------
-- Reglas (se aplican en la BASE, no en React):
--   · asignar el rol SuperAdmin  → sólo la cuenta fundadora;
--   · retirar el rol SuperAdmin  → sólo la cuenta fundadora;
--   · el rol SuperAdmin de la PROPIA cuenta fundadora no se puede retirar nunca;
--   · `service_role` NO puede asignarlo ni retirarlo (las Edge Functions no son una vía
--     alternativa: la asignación legítima del fundador viaja con SU token, no con la
--     service role);
--   · el mantenimiento de base (`postgres` / `supabase_admin`) sí puede, como propietario;
--   · los roles ordinarios NO pasan por ninguna de estas reglas.
--
-- La función es SECURITY INVOKER a propósito: así `current_user` refleja el rol REAL de la
-- conexión (y no el propietario de la función), lo que permite distinguir `service_role`.
create or replace function public.enforce_founder_only_superadmin_role()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  v_role_id uuid;
begin
  v_role_id := case when tg_op = 'DELETE' then old.platform_role_id else new.platform_role_id end;

  -- (1) Borrado en CASCADA de una cuenta: NO es una retirada de rol.
  --     La ausencia de sesión (`auth.uid()` nulo) NO se acepta como prueba por sí sola. Hace
  --     falta una prueba POSITIVA de que el borrado lo provoca la desaparición de la cuenta:
  --       · `pg_trigger_depth() > 1`: el disparador se ejecuta ANIDADO dentro de otro
  --         disparador, que es exactamente la situación de un borrado en cascada de la
  --         integridad referencial al eliminar la cuenta; o
  --       · `current_user = 'supabase_auth_admin'`: lo ejecuta el servicio de Auth al borrar la
  --         cuenta (GoTrue). No es alcanzable desde la aplicación ni desde una Edge Function.
  --     Además se exige que NO haya sesión de aplicación y que el actor no sea `service_role`
  --     (la vía de las Edge Functions, que nunca puede eludir la regla: una operación con
  --     `auth.uid()` nulo y `service_role` cae en los puntos 2–5 y se rechaza).
  --     Se comprueba ANTES de leer el catálogo de roles para no depender de los privilegios de
  --     lectura del rol de infraestructura que ejecuta la cascada.
  --     Sólo afecta a DELETE: en INSERT/UPDATE no existe ninguna excepción de este tipo y la
  --     única vía de mantenimiento es `postgres`/`supabase_admin` (punto 3).
  if tg_op = 'DELETE'
     and auth.uid() is null
     and current_user <> 'service_role'
     and (pg_trigger_depth() > 1 or current_user = 'supabase_auth_admin') then
    return old;
  end if;

  -- (2) ¿El rol afectado es el SuperAdmin del sistema?
  --     Los roles ordinarios salen por aquí: la administración normal no se ve afectada.
  if not exists (
    select 1 from public.platform_roles pr
    where pr.id = v_role_id
      and pr.name = 'SuperAdmin'
      and pr.is_system_role = true
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- (3) Mantenimiento de base de datos (propietario): permitido y documentado.
  if current_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- (4) El rol SuperAdmin de la propia cuenta fundadora no se retira nunca.
  if tg_op = 'DELETE' and public.is_founder_user(old.user_id) then
    raise exception 'No se puede retirar el rol SuperAdmin a la cuenta fundadora de SiteCorp.'
      using errcode = '42501';
  end if;

  -- (5) Cualquier otra asignación o retirada del rol SuperAdmin exige ser la fundadora.
  if not public.is_platform_founder() then
    raise exception 'Solo la cuenta fundadora puede asignar o retirar el rol SuperAdmin.'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.enforce_founder_only_superadmin_role() from public;

drop trigger if exists platform_user_roles_founder_only on public.platform_user_roles;
create trigger platform_user_roles_founder_only
  before insert or update or delete on public.platform_user_roles
  for each row execute function public.enforce_founder_only_superadmin_role();

-- ----------------------------------------------------------------------------
-- 5. La cuenta fundadora no se puede desactivar
-- ----------------------------------------------------------------------------
-- Se suma (no sustituye) a la protección ya existente `profiles_protect_is_active`: aquélla
-- decide QUIÉN puede cambiar `is_active`, ésta impide que el fundador quede inactivo por
-- cualquiera, incluida la service role. Al llamarse `profiles_protect_founder`, se dispara
-- antes (orden alfabético) y su mensaje es el que ve el usuario.
create or replace function public.protect_founder_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- `is distinct from false` cubre también el caso de un `is_active` nulo heredado: cualquier
  -- transición hacia inactivo de la cuenta fundadora se rechaza.
  if new.is_active is false
     and old.is_active is distinct from false
     and public.is_founder_user(old.id) then
    raise exception 'La cuenta fundadora de SiteCorp no se puede desactivar.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_founder_profile() from public;

drop trigger if exists profiles_protect_founder on public.profiles;
create trigger profiles_protect_founder
  before update of is_active on public.profiles
  for each row execute function public.protect_founder_profile();

-- La eliminación de la cuenta fundadora ya queda bloqueada por la FK
-- `platform_founder.user_id → auth.users(id) ON DELETE RESTRICT` (segunda barrera: la Edge
-- Function `delete-platform-user` la rechaza antes, con un mensaje claro).

-- ----------------------------------------------------------------------------
-- 6. Designación de la cuenta fundadora
-- ----------------------------------------------------------------------------
-- UUID de Supabase Auth confirmado como cuenta fundadora (`admin`).
-- No se escribe ninguna otra tabla: las asignaciones de roles NO se tocan.
do $$
declare
  v_founder uuid := 'e7062a40-bc05-4ffb-a5a5-ba73d1ab116f';
  v_username text;
  v_is_active boolean;
begin
  -- (a) La cuenta debe existir.
  select p.username, p.is_active
    into v_username, v_is_active
  from public.profiles p
  where p.id = v_founder;

  if not found then
    raise exception 'El UUID % no corresponde a ninguna cuenta de SiteCorp: no se puede designar como fundadora.', v_founder;
  end if;

  -- (b) Su perfil debe estar activo.
  if v_is_active is not true then
    raise exception 'La cuenta % (%) no está activa (is_active = %): no puede ser la fundadora.',
      v_username, v_founder, coalesce(v_is_active::text, 'NULL');
  end if;

  -- (c) Debe tener asignado el rol SuperAdmin.
  if not exists (
    select 1
    from public.platform_user_roles pur
    join public.platform_roles pr on pr.id = pur.platform_role_id
    where pur.user_id = v_founder
      and pr.name = 'SuperAdmin'
      and pr.is_system_role = true
  ) then
    raise exception 'La cuenta % (%) no tiene el rol SuperAdmin: no puede ser la fundadora.',
      v_username, v_founder;
  end if;

  -- (d) No puede existir OTRA cuenta designada como fundadora.
  if exists (select 1 from public.platform_founder f where f.user_id <> v_founder) then
    raise exception 'Ya existe otra cuenta designada como fundadora en public.platform_founder: revísala antes de aplicar esta migración.';
  end if;

  -- (e) Designación (idempotente: reejecutarla no cambia nada).
  insert into public.platform_founder (user_id, note)
  values (v_founder, 'Cuenta fundadora de SiteCorp (admin)')
  on conflict (user_id) do nothing;
end $$;
