-- ============================================================================
-- SiteCorp · BLOQUE 35.2C — BARRERA DE SERVIDOR PARA EL CAMBIO OBLIGATORIO
--
-- PREPARADA, NO APLICADA. Requiere autorización expresa antes de aplicarse.
--
-- Objetivo: impedir que un usuario con `must_change_password = true` opere con
-- normalidad por PostgREST. Se hace con UN helper central y políticas RLS
-- RESTRICTIVAS (se combinan con AND sobre las políticas permisivas existentes),
-- sin reescribir cada política y sin tocar los datos.
--
-- ALCANCE DE ESTA MIGRACIÓN:
--   · Cubre las TABLAS de `public` que hoy exponen políticas a `authenticated`
--     (se añade una política restrictiva `password_change_gate` a cada una),
--     EXCEPTO una lista blanca mínima necesaria para poder detectar el requisito
--     y cerrar sesión: `profiles`, `user_password_lifecycle`,
--     `company_client_memberships`.
--   · NO cubre las funciones SECURITY DEFINER (RPC) ni el esquema `storage`:
--     esas superficies requieren un bloque posterior (ver informe 35.2C).
--
-- Invariante: para un usuario normal (sin fila o con must_change_password=false)
-- el helper devuelve false y la política restrictiva NO cambia nada.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Helper central: ¿el usuario autenticado debe cambiar su contraseña?
--    - SECURITY DEFINER: lee el ciclo de vida sin depender de RLS (evita recursión).
--    - search_path vacío: referencias totalmente cualificadas.
--    - Legacy sin fila → false. No expone nada más que un booleano propio.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_must_change_password()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (
      SELECT lifecycle.must_change_password
      FROM public.user_password_lifecycle AS lifecycle
      WHERE lifecycle.user_id = auth.uid()
    ),
    false
  );
$function$;

-- Privilegios mínimos: `authenticated` necesita poder invocarlo desde RLS; nadie más.
REVOKE ALL ON FUNCTION public.current_user_must_change_password() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_must_change_password() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_must_change_password() TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Política RLS RESTRICTIVA en cada tabla que expone `authenticated`.
--    Restrictiva ⇒ se combina con AND: bloquea toda operación del usuario con
--    cambio pendiente salvo en la lista blanca mínima (detección + identidad).
--    Idempotente: no se recrea si ya existe.
-- ----------------------------------------------------------------------------
DO $gate$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT p.tablename
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND 'authenticated'::name = ANY (p.roles)
      AND p.tablename NOT IN ('profiles', 'user_password_lifecycle', 'company_client_memberships')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = rec.tablename
        AND policyname = 'password_change_gate'
    ) THEN
      EXECUTE format(
        'CREATE POLICY password_change_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (NOT public.current_user_must_change_password()) '
        || 'WITH CHECK (NOT public.current_user_must_change_password())',
        rec.tablename
      );
    END IF;
  END LOOP;
END
$gate$;

COMMIT;

-- ----------------------------------------------------------------------------
-- Reversión (si se aplicara):
--   DO $$
--   DECLARE rec record;
--   BEGIN
--     FOR rec IN SELECT tablename FROM pg_policies
--       WHERE schemaname='public' AND policyname='password_change_gate' LOOP
--       EXECUTE format('DROP POLICY password_change_gate ON public.%I', rec.tablename);
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS public.current_user_must_change_password();
-- ----------------------------------------------------------------------------
