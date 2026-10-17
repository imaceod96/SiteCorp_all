-- ============================================================================
-- SiteCorp · BLOQUE 35.2A — INFRAESTRUCTURA DEL CICLO DE VIDA DE CONTRASEÑAS
--
-- Prepara (NO aplica automáticamente) la tabla de metadatos del ciclo de vida de
-- la contraseña inicial, su RLS y las operaciones privilegiadas del servidor.
--
-- Alcance EXCLUSIVO de base de datos y seguridad. NO toca frontend, ni la Edge
-- Function create-sitecorp-user, ni usuarios, ni contraseñas, ni RLS de otras
-- tablas, ni schema-target.ts / initSchemaTarget().
--
-- DECISIÓN DE SEGURIDAD (ver docs/auditoria-hardcoding/09-*.md):
--   NO existe ninguna RPC ejecutable por `authenticated` que permita poner
--   `must_change_password = false`. La confirmación del cambio de contraseña es
--   SIEMPRE una operación del SERVIDOR (service_role), que además corrobora a
--   nivel de base de datos que el registro de `auth.users` fue actualizado
--   efectivamente después de la generación inicial.
--
-- Idempotente: puede re-ejecutarse sin efectos secundarios indeseados.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Tabla de ciclo de vida de la contraseña
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_password_lifecycle (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  must_change_password boolean NOT NULL DEFAULT false,
  initial_password_generated_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_password_lifecycle IS
  'Metadatos del ciclo de vida de la contraseña (Bloque 35.2A). NO almacena contraseñas, valores reversibles ni hashes: Supabase Auth sigue siendo el único responsable de las credenciales. Ausencia de fila = usuario legacy sin cambio inicial obligatorio.';

COMMENT ON COLUMN public.user_password_lifecycle.must_change_password IS
  'true si el usuario debe cambiar la contraseña en su primer acceso. Sólo lo actualiza el servidor.';
COMMENT ON COLUMN public.user_password_lifecycle.initial_password_generated_at IS
  'Instante en que el servidor generó la contraseña inicial aleatoria.';
COMMENT ON COLUMN public.user_password_lifecycle.password_changed_at IS
  'Instante en que se confirmó (en servidor) el cambio de contraseña. NULL mientras no se confirme.';

-- ----------------------------------------------------------------------------
-- 2. updated_at — reutiliza el trigger existente public.handle_updated_at()
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS user_password_lifecycle_updated_at ON public.user_password_lifecycle;
CREATE TRIGGER user_password_lifecycle_updated_at
  BEFORE UPDATE ON public.user_password_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS: lectura de metadatos; escritura SOLO del servidor
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_password_lifecycle ENABLE ROW LEVEL SECURITY;

-- Sin acceso anónimo.
REVOKE ALL ON TABLE public.user_password_lifecycle FROM anon;

-- El cliente autenticado SÓLO puede LEER (nunca INSERT/UPDATE/DELETE directos).
REVOKE ALL ON TABLE public.user_password_lifecycle FROM authenticated;
GRANT SELECT ON TABLE public.user_password_lifecycle TO authenticated;

-- El servidor (service_role) sí puede escribir: es el único autorizado.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_password_lifecycle TO service_role;

-- Política 1: el titular lee su propia fila.
DROP POLICY IF EXISTS user_password_lifecycle_select_self ON public.user_password_lifecycle;
CREATE POLICY user_password_lifecycle_select_self
  ON public.user_password_lifecycle
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Política 2: administradores autorizados (modelo de permisos existente, sin
-- nombres de usuario y sin recursividad: can_view_platform_user no lee esta tabla).
DROP POLICY IF EXISTS user_password_lifecycle_select_admin ON public.user_password_lifecycle;
CREATE POLICY user_password_lifecycle_select_admin
  ON public.user_password_lifecycle
  FOR SELECT TO authenticated
  USING (public.can_view_platform_user(user_id));

-- No se define NINGUNA política de INSERT/UPDATE/DELETE: con RLS activado y sin
-- política, esas operaciones quedan bloqueadas para `authenticated`.
-- Las mutaciones sólo ocurren por funciones SECURITY DEFINER (service_role).

-- ----------------------------------------------------------------------------
-- 4. Inicialización privilegiada e idempotente (SOLO service_role)
--    - Solo desde contexto privilegiado autorizado.
--    - Establece must_change_password = true e initial_password_generated_at = now().
--    - NO sobrescribe un estado existente (ON CONFLICT DO NOTHING).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_password_lifecycle(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Contexto privilegiado autorizado: sólo el servidor (service_role) puede ejecutarla.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'initialize_password_lifecycle: operación reservada al servidor';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'initialize_password_lifecycle: p_user_id es obligatorio';
  END IF;

  INSERT INTO public.user_password_lifecycle (
    user_id,
    must_change_password,
    initial_password_generated_at
  )
  VALUES (p_user_id, true, now())
  ON CONFLICT (user_id) DO NOTHING;  -- no sobrescribe un estado existente
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Confirmación del cambio (SOLO service_role)
--    No confía en el navegador ni únicamente en auth.uid(): sólo el servidor la
--    invoca, y además CORROBORA, a nivel de base de datos, que auth.users fue
--    actualizado DESPUÉS de la generación inicial de la contraseña.
--    Idempotente: si ya estaba confirmado, no hace nada.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_password_changed(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row public.user_password_lifecycle%ROWTYPE;
  v_auth_updated timestamptz;
BEGIN
  -- Contexto privilegiado autorizado: sólo el servidor (service_role).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'mark_password_changed: operación reservada al servidor';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'mark_password_changed: p_user_id es obligatorio';
  END IF;

  SELECT * INTO v_row
  FROM public.user_password_lifecycle
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_password_changed: no existe ciclo de vida para el usuario';
  END IF;

  -- Nada que hacer si ya está confirmado (idempotente).
  IF v_row.must_change_password = false THEN
    RETURN;
  END IF;

  -- Corroboración en base de datos: el registro de Auth debe haberse actualizado
  -- DESPUÉS de generar la contraseña inicial. Si no, NO se confirma.
  SELECT u.updated_at INTO v_auth_updated
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_password_changed: usuario inexistente en auth.users';
  END IF;

  IF v_row.initial_password_generated_at IS NOT NULL
     AND v_auth_updated IS NOT NULL
     AND v_auth_updated <= v_row.initial_password_generated_at THEN
    RAISE EXCEPTION 'mark_password_changed: Auth no registra un cambio de contraseña posterior a la generación inicial';
  END IF;

  UPDATE public.user_password_lifecycle
  SET must_change_password = false,
      password_changed_at = now()
  WHERE user_id = p_user_id
    AND must_change_password = true;
END;
$function$;

-- Privilegios de ejecución: EXCLUSIVAMENTE service_role.
REVOKE ALL ON FUNCTION public.initialize_password_lifecycle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_password_lifecycle(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.initialize_password_lifecycle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_password_lifecycle(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.mark_password_changed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_password_changed(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mark_password_changed(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_password_changed(uuid) TO service_role;

COMMIT;
