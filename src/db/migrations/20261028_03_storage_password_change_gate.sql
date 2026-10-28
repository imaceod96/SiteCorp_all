-- ============================================================================
-- SiteCorp · BLOQUE 35.2C.2 — BARRERA DE STORAGE PARA EL CAMBIO OBLIGATORIO
--
-- PREPARADA, NO APLICADA. Requiere autorización expresa antes de aplicarse.
-- DEPENDENCIA: requiere que 20261028_02_password_change_gate.sql esté aplicada
--             (define public.current_user_must_change_password()).
--
-- Objetivo: impedir que un usuario con `must_change_password = true` lea o escriba
-- objetos de Storage (buckets privados: avatars, documents, document-templates,
-- worker_documents). Se añade UNA política RLS RESTRICTIVA a `storage.objects`
-- para el rol `authenticated`: se combina con AND con las políticas existentes.
--
-- NO bloquea el cambio de contraseña (esa operación no usa Storage).
-- No modifica archivos almacenados ni las políticas de negocio existentes.
--
-- NOTA DE PROPIEDAD: `storage.objects` pertenece a `supabase_storage_admin`. En
-- Supabase, el rol `postgres` (el que aplica las migraciones) suele poder crear
-- políticas en `storage`; si no fuera posible, aplicar con un rol con privilegios
-- sobre el esquema `storage`. Verificar tras aplicar.
-- ============================================================================

BEGIN;

DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'password_change_gate'
  ) THEN
    CREATE POLICY password_change_gate ON storage.objects
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (NOT public.current_user_must_change_password())
      WITH CHECK (NOT public.current_user_must_change_password());
  END IF;
END
$gate$;

COMMIT;

-- ----------------------------------------------------------------------------
-- Reversión (si se aplicara):
--   DROP POLICY IF EXISTS password_change_gate ON storage.objects;
-- ----------------------------------------------------------------------------
