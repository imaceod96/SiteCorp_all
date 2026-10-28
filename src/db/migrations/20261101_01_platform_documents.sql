-- ============================================================================
-- Documentos del Super Admin (alcance GLOBAL de SiteCorp)
-- ----------------------------------------------------------------------------
-- PROPÓSITO
--   Persistencia del módulo «Documentos» del Super Admin: carpetas de UN solo nivel
--   y documentos globales, con su archivo en un bucket PRIVADO.
--
--   NO tiene relación con los documentos de una entidad (`governing_documents`), de un
--   trabajador/candidato (`worker_documents`) ni con las plantillas documentales: ni las
--   tablas ni el bucket se comparten. Este script no modifica ninguna de ellas.
--
-- SEGURIDAD
--   · Acceso exclusivo del Super Admin global: todas las políticas usan la función ya
--     existente `public.is_platform_superadmin()` (no se crea un modelo de permisos
--     paralelo ni se inventan códigos nuevos).
--   · El bucket es PRIVADO (`public = false`): los archivos sólo se sirven por URL firmada
--     y caduca a los 60 s.
--   · La FK sin cascada impide borrar una carpeta que todavía tenga documentos: la regla
--     se aplica también en el servidor, no sólo en la interfaz.
--
-- ESTADO: NO EJECUTADO. Requiere autorización expresa antes de aplicarse.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Carpetas (un solo nivel: no hay `parent_id`)
-- ----------------------------------------------------------------------------
create table if not exists public.platform_document_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint platform_document_folders_name_not_blank check (btrim(name) <> '')
);

-- Dos carpetas no pueden llamarse igual (comparación sin distinguir mayúsculas).
create unique index if not exists platform_document_folders_name_unique
  on public.platform_document_folders (lower(btrim(name)));

-- ----------------------------------------------------------------------------
-- 2. Documentos (metadatos; el archivo vive en Storage)
-- ----------------------------------------------------------------------------
create table if not exists public.platform_documents (
  id           uuid primary key default gen_random_uuid(),
  folder_id    uuid references public.platform_document_folders(id) on delete restrict,
  name         text not null,
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text,
  file_size    bigint,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint platform_documents_name_not_blank check (btrim(name) <> ''),
  constraint platform_documents_file_name_not_blank check (btrim(file_name) <> ''),
  constraint platform_documents_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint platform_documents_file_size_not_negative check (file_size is null or file_size >= 0)
);

create index if not exists platform_documents_folder_id_idx
  on public.platform_documents (folder_id);

-- ----------------------------------------------------------------------------
-- 3. Grants de la Data API
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on table public.platform_document_folders to authenticated;
grant select, insert, update, delete on table public.platform_documents to authenticated;
grant select, insert, update, delete on table public.platform_document_folders to service_role;
grant select, insert, update, delete on table public.platform_documents to service_role;

-- ----------------------------------------------------------------------------
-- 4. RLS: exclusivo del Super Admin global
-- ----------------------------------------------------------------------------
alter table public.platform_document_folders enable row level security;
alter table public.platform_documents enable row level security;

drop policy if exists "platform_document_folders_superadmin" on public.platform_document_folders;
create policy "platform_document_folders_superadmin"
  on public.platform_document_folders
  for all
  to authenticated
  using (public.is_platform_superadmin())
  with check (public.is_platform_superadmin());

drop policy if exists "platform_documents_superadmin" on public.platform_documents;
create policy "platform_documents_superadmin"
  on public.platform_documents
  for all
  to authenticated
  using (public.is_platform_superadmin())
  with check (public.is_platform_superadmin());

-- ----------------------------------------------------------------------------
-- 5. Storage: bucket PRIVADO y políticas equivalentes
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('platform_documents', 'platform_documents', false)
on conflict (id) do nothing;

drop policy if exists "platform_documents_objects_select" on storage.objects;
create policy "platform_documents_objects_select"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'platform_documents' and public.is_platform_superadmin());

drop policy if exists "platform_documents_objects_insert" on storage.objects;
create policy "platform_documents_objects_insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'platform_documents' and public.is_platform_superadmin());

drop policy if exists "platform_documents_objects_update" on storage.objects;
create policy "platform_documents_objects_update"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'platform_documents' and public.is_platform_superadmin())
  with check (bucket_id = 'platform_documents' and public.is_platform_superadmin());

drop policy if exists "platform_documents_objects_delete" on storage.objects;
create policy "platform_documents_objects_delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'platform_documents' and public.is_platform_superadmin());
