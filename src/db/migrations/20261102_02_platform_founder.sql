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
--   ⚠️  PLANTILLA SIN CONFIRMAR: el bloque final aborta a propósito mientras
--       `v_founder` siga siendo el UUID nulo. NO se puede aplicar por accidente ni fijar una
--       cuenta equivocada.
--
-- ESTADO: NO EJECUTADO. Requiere confirmación de la cuenta fundadora y autorización expresa.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Identificación persistente de la cuenta fundadora (una sola fila)
-- ----------------------------------------------------------------------------
create table if not exists public.platform_founder (
  user_id       uuid primary key references auth.users(id) on delete restrict,
  designated_at timestamptz not null default now(),
  designated_by uuid,
  note          text
);

comment on table public.platform_founder is
  'Cuenta fundadora de SiteCorp (una sola fila). Su user_id es el UUID de Supabase Auth. No se puede eliminar ni desactivar.';

-- Una única fila: el índice único sobre una expresión constante impide insertar una segunda.
create unique index if not exists platform_founder_single_row
  on public.platform_founder ((true));

-- ----------------------------------------------------------------------------
-- 2. Grants y RLS: legible por SuperAdmin, escritura sólo de servidor
-- ----------------------------------------------------------------------------
revoke insert, update, delete, truncate on table public.platform_founder from authenticated;
revoke all on table public.platform_founder from anon;
grant select on table public.platform_founder to authenticated;
grant select, insert, update, delete on table public.platform_founder to service_role;

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
-- 4. Guarda del rol SuperAdmin en `platform_user_roles`
-- ----------------------------------------------------------------------------
-- Reglas (se aplican en la BASE, no en React):
--   · asignar el rol SuperAdmin  → sólo la cuenta fundadora;
--   · retirar el rol SuperAdmin  → sólo la cuenta fundadora;
--   · el rol SuperAdmin de la PROPIA cuenta fundadora no se puede retirar nunca;
--   · `service_role` NO puede hacerlo (las Edge Functions no son una vía alternativa);
--   · el mantenimiento de base (`postgres` / `supabase_admin`) sí puede, como propietario.
--
-- La función es SECURITY INVOKER a propósito: así `current_user` refleja el rol REAL de la
-- conexión y no el propietario de la función.
create or replace function public.enforce_founder_only_superadmin_role()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  v_role_id uuid;
  v_target uuid;
begin
  v_role_id := case when tg_op = 'DELETE' then old.platform_role_id else new.platform_role_id end;
  v_target  := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

  -- ¿El rol afectado es el SuperAdmin del sistema?
  if not exists (
    select 1 from public.platform_roles pr
    where pr.id = v_role_id
      and pr.name = 'SuperAdmin'
      and pr.is_system_role = true
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Mantenimiento de base de datos (propietario): permitido y documentado.
  if current_user in ('postgres', 'supabase_admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- El rol SuperAdmin de la propia cuenta fundadora no se retira nunca.
  if tg_op = 'DELETE' and public.is_founder_user(old.user_id) then
    raise exception 'No se puede retirar el rol SuperAdmin a la cuenta fundadora de SiteCorp.'
      using errcode = '42501';
  end if;

  -- Cualquier otra asignación o retirada exige ser la cuenta fundadora.
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
create or replace function public.protect_founder_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active = false and old.is_active = true and public.is_founder_user(old.id) then
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
-- `platform_founder.user_id → auth.users(id) ON DELETE RESTRICT`.

-- ----------------------------------------------------------------------------
-- 6. Fijación de la cuenta fundadora — PLANTILLA
-- ----------------------------------------------------------------------------
-- ⚠️  SUSTITUIR ÚNICAMENTE el UUID de `v_founder` por el que se confirme como cuenta
--     fundadora. Mientras siga siendo el UUID nulo, este bloque ABORTA y la migración
--     completa se revierte: no hay forma de aplicarla con una cuenta equivocada.
do $$
declare
  -- UUID de Supabase Auth de la cuenta fundadora (pendiente de confirmación).
  v_founder uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_founder = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'PLANTILLA SIN CONFIRMAR: sustituye v_founder por el UUID confirmado de la cuenta fundadora antes de aplicar esta migración.';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_founder) then
    raise exception 'El UUID indicado no corresponde a ningún perfil de SiteCorp.';
  end if;

  if not exists (
    select 1
    from public.platform_user_roles pur
    join public.platform_roles pr on pr.id = pur.platform_role_id
    where pur.user_id = v_founder
      and pr.name = 'SuperAdmin'
      and pr.is_system_role = true
  ) then
    raise exception 'La cuenta indicada no tiene el rol SuperAdmin: no puede ser la fundadora.';
  end if;

  insert into public.platform_founder (user_id, note)
  values (v_founder, 'Cuenta fundadora de SiteCorp')
  on conflict (user_id) do nothing;
end $$;
