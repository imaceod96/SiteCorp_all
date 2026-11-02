-- ============================================================================
-- SiteCorp · AUTENTICACIÓN PROPIA EN BASE DE DATOS (FASE 1 + OPCIÓN 2 RPCs)
-- Archivo: src/db/migrations/20261110_01_custom_user_credentials_auth.sql
-- ============================================================================
-- PROPÓSITO
--   1. Crear `public.user_credentials` vinculada 1:1 con `public.profiles(id)`
--      para almacenar correo electrónico, hash bcrypt (`pgcrypto`), estado de
--      cambio obligatorio de contraseña y control de intentos fallidos.
--   2. Crear `public.user_sessions` para gestionar sesiones propias emitidas
--      y validadas desde PostgreSQL.
--   3. Migrar/sincronizar de forma transparente las credenciales actuales de
--      `auth.users` y `public.user_password_lifecycle` hacia `public.user_credentials`
--      conservando exactamente los mismos UUIDs y hashes bcrypt actuales.
--   4. Implementar las funciones RPC `SECURITY DEFINER` con `pgcrypto` (Opción 2)
--      que permiten:
--        · Iniciar sesión tanto por Correo Electrónico como por Nombre de Usuario (`username`).
--        · Verificar y hashear contraseñas directamente en PostgreSQL (`crypt` / `gen_salt('bf', 10)`).
--        · Emitir, validar y revocar sesiones en `public.user_sessions`.
--        · Mantener compatibilidad 100 % con RLS (`auth.uid()`), Storage y Edge Functions.
--
-- SEGURIDAD E IDEMPOTENCIA
--   · Transacción atómica (`BEGIN ... COMMIT`).
--   · `user_credentials` tiene RLS activo y ningún permiso de lectura directa
--     sobre `password_hash` para `anon` ni `authenticated`.
--   · Sincronización automática con `public.user_password_lifecycle` para no
--     romper ninguna política `password_change_gate` existente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Extensión pgcrypto para bcrypt y tokens criptográficos
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. Tabla 1:1 de credenciales de usuario: public.user_credentials
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  initial_password_generated_at timestamptz,
  password_changed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_credentials_email_not_blank CHECK (btrim(email) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credentials_email_lower
  ON public.user_credentials (lower(btrim(email)));

COMMENT ON TABLE public.user_credentials IS
  'Credenciales propias de SiteCorp vinculadas 1:1 con public.profiles(id). Almacena email, hash bcrypt (pgcrypto) y ciclo de vida de contraseña.';

COMMENT ON COLUMN public.user_credentials.password_hash IS
  'Hash bcrypt generado con extensions.crypt(password, extensions.gen_salt(''bf'', 10)). Nunca se expone a clientes.';

DROP TRIGGER IF EXISTS user_credentials_updated_at ON public.user_credentials;
CREATE TRIGGER user_credentials_updated_at
  BEFORE UPDATE ON public.user_credentials
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS estricta: ningún rol cliente puede leer directamente `user_credentials`
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_credentials FROM PUBLIC;
REVOKE ALL ON TABLE public.user_credentials FROM anon;
REVOKE ALL ON TABLE public.user_credentials FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_credentials TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Tabla de sesiones propias: public.user_sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_lookup
  ON public.user_sessions (token_hash)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.user_sessions IS
  'Sesiones emitidas por el motor de autenticación propio de SiteCorp en PostgreSQL.';

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.user_sessions FROM anon;
REVOKE ALL ON TABLE public.user_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_sessions TO service_role;

-- Permitir que el usuario autenticado consulte sus propias sesiones activas si se requiere auditoría
GRANT SELECT ON TABLE public.user_sessions TO authenticated;
DROP POLICY IF EXISTS user_sessions_select_self ON public.user_sessions;
CREATE POLICY user_sessions_select_self
  ON public.user_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. Backfill inicial desde auth.users + public.profiles + user_password_lifecycle
--    Copia el email y el hash bcrypt actual para que todos los usuarios
--    existentes conserven su contraseña e identidad sin interrupción.
-- ----------------------------------------------------------------------------
INSERT INTO public.user_credentials (
  user_id,
  email,
  password_hash,
  must_change_password,
  initial_password_generated_at,
  password_changed_at,
  last_login_at,
  created_at,
  updated_at
)
SELECT
  p.id AS user_id,
  lower(btrim(u.email)) AS email,
  COALESCE(
    NULLIF(u.encrypted_password, ''),
    extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf', 10))
  ) AS password_hash,
  COALESCE(upl.must_change_password, false) AS must_change_password,
  upl.initial_password_generated_at,
  upl.password_changed_at,
  u.last_sign_in_at AS last_login_at,
  COALESCE(u.created_at, now()) AS created_at,
  now() AS updated_at
FROM public.profiles AS p
INNER JOIN auth.users AS u
  ON u.id = p.id
LEFT JOIN public.user_password_lifecycle AS upl
  ON upl.user_id = p.id
WHERE u.email IS NOT NULL
  AND btrim(u.email) <> ''
ON CONFLICT (user_id) DO UPDATE
SET
  email = EXCLUDED.email,
  password_hash = CASE
    WHEN public.user_credentials.password_hash IS NULL OR btrim(public.user_credentials.password_hash) = ''
      THEN EXCLUDED.password_hash
    ELSE public.user_credentials.password_hash
  END,
  must_change_password = COALESCE(EXCLUDED.must_change_password, public.user_credentials.must_change_password),
  initial_password_generated_at = COALESCE(public.user_credentials.initial_password_generated_at, EXCLUDED.initial_password_generated_at),
  password_changed_at = COALESCE(public.user_credentials.password_changed_at, EXCLUDED.password_changed_at),
  updated_at = now();

-- ----------------------------------------------------------------------------
-- 4. Sincronización automática entre user_password_lifecycle y user_credentials
--    Garantiza que las políticas RLS `password_change_gate` y el flujo actual
--    de cambio de contraseña inicial funcionen sin ninguna regresión.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_lifecycle_to_user_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.user_credentials
  SET must_change_password = NEW.must_change_password,
      initial_password_generated_at = COALESCE(NEW.initial_password_generated_at, initial_password_generated_at),
      password_changed_at = COALESCE(NEW.password_changed_at, password_changed_at),
      updated_at = now()
  WHERE user_id = NEW.user_id
    AND (
      must_change_password IS DISTINCT FROM NEW.must_change_password
      OR password_changed_at IS DISTINCT FROM NEW.password_changed_at
    );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_lifecycle_to_user_credentials ON public.user_password_lifecycle;
CREATE TRIGGER trg_sync_lifecycle_to_user_credentials
  AFTER INSERT OR UPDATE ON public.user_password_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.sync_lifecycle_to_user_credentials();

-- Actualizar `current_user_must_change_password()` para consultar tanto
-- `user_credentials` como `user_password_lifecycle`
CREATE OR REPLACE FUNCTION public.current_user_must_change_password()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (
      SELECT uc.must_change_password
      FROM public.user_credentials AS uc
      WHERE uc.user_id = auth.uid()
    ),
    (
      SELECT lifecycle.must_change_password
      FROM public.user_password_lifecycle AS lifecycle
      WHERE lifecycle.user_id = auth.uid()
    ),
    false
  );
$function$;

-- ----------------------------------------------------------------------------
-- 5. RPC Opción 2: Autenticación directa en PostgreSQL por Email o Username
--    - Verifica identificador por `user_credentials.email` O `profiles.username`.
--    - Si el usuario aún no tenía fila en `user_credentials` pero existe en
--      `auth.users`, la sincroniza al vuelo (cero regresiones).
--    - Verifica contraseña con `extensions.crypt(p_password, uc.password_hash)`.
--    - Controla bloqueo temporal por intentos fallidos (5 intentos -> 15 min).
--    - Emite token de sesión propio en `public.user_sessions` y devuelve el
--      correo canónico para establecer simultáneamente la sesión JWT de PostgREST.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authenticate_user_credentials(
  p_identifier text,
  p_password text,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_clean_id text := lower(btrim(COALESCE(p_identifier, '')));
  v_user_id uuid;
  v_username text;
  v_full_name text;
  v_is_active boolean;
  v_cred public.user_credentials%ROWTYPE;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
BEGIN
  IF v_clean_id = '' OR COALESCE(p_password, '') = '' THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'invalid_credentials',
      'message', 'Credenciales inválidas.'
    );
  END IF;

  -- 1. Buscar usuario por username en profiles o por email en user_credentials / auth.users
  SELECT
    p.id,
    p.username,
    p.full_name,
    COALESCE(p.is_active, true)
  INTO
    v_user_id,
    v_username,
    v_full_name,
    v_is_active
  FROM public.profiles AS p
  LEFT JOIN public.user_credentials AS uc
    ON uc.user_id = p.id
  LEFT JOIN auth.users AS au
    ON au.id = p.id
  WHERE lower(btrim(p.username)) = v_clean_id
     OR lower(btrim(uc.email)) = v_clean_id
     OR lower(btrim(au.email)) = v_clean_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'invalid_credentials',
      'message', 'Credenciales inválidas.'
    );
  END IF;

  -- 2. Garantizar que exista su fila en public.user_credentials (auto-heal desde auth.users si faltaba)
  INSERT INTO public.user_credentials (
    user_id,
    email,
    password_hash,
    must_change_password,
    initial_password_generated_at,
    password_changed_at
  )
  SELECT
    au.id,
    lower(btrim(au.email)),
    au.encrypted_password,
    COALESCE(upl.must_change_password, false),
    upl.initial_password_generated_at,
    upl.password_changed_at
  FROM auth.users AS au
  LEFT JOIN public.user_password_lifecycle AS upl
    ON upl.user_id = au.id
  WHERE au.id = v_user_id
    AND au.email IS NOT NULL
    AND au.encrypted_password IS NOT NULL
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO v_cred
  FROM public.user_credentials
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'invalid_credentials',
      'message', 'Credenciales inválidas.'
    );
  END IF;

  -- 3. Comprobar bloqueo temporal por intentos fallidos
  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'account_locked',
      'message', 'Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta nuevamente en unos minutos.'
    );
  END IF;

  -- 4. Verificar hash bcrypt con pgcrypto (y sincronizar si cambió en auth.users)
  IF v_cred.password_hash IS NULL
     OR v_cred.password_hash <> extensions.crypt(p_password, v_cred.password_hash)
  THEN
    -- Comprobar si en auth.users hay un hash recién actualizado que coincida
    PERFORM 1
    FROM auth.users AS au
    WHERE au.id = v_user_id
      AND au.encrypted_password IS NOT NULL
      AND au.encrypted_password = extensions.crypt(p_password, au.encrypted_password);

    IF FOUND THEN
      UPDATE public.user_credentials AS uc
      SET password_hash = au.encrypted_password,
          updated_at = now()
      FROM auth.users AS au
      WHERE uc.user_id = v_user_id
        AND au.id = v_user_id
      RETURNING uc.* INTO v_cred;
    ELSE
      UPDATE public.user_credentials
      SET failed_attempts = failed_attempts + 1,
          locked_until = CASE
            WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
            ELSE NULL
          END,
          updated_at = now()
      WHERE user_id = v_user_id;

      RETURN jsonb_build_object(
        'authenticated', false,
        'reason', 'invalid_credentials',
        'message', 'Credenciales inválidas.'
      );
    END IF;
  END IF;

  -- 5. Verificar si el perfil está activo
  IF v_is_active = false THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'account_inactive',
      'message', 'Tu cuenta está desactivada. Contacta al administrador.'
    );
  END IF;

  -- 6. Éxito: reiniciar contador de fallos y emitir sesión en public.user_sessions
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '8 hours';

  UPDATE public.user_credentials
  SET failed_attempts = 0,
      locked_until = NULL,
      last_login_at = now(),
      updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_sessions (
    user_id,
    token_hash,
    expires_at,
    user_agent,
    ip_address
  )
  VALUES (
    v_user_id,
    v_token_hash,
    v_expires_at,
    left(p_user_agent, 512),
    left(p_ip_address, 128)
  );

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', v_user_id,
    'email', v_cred.email,
    'username', v_username,
    'full_name', v_full_name,
    'must_change_password', v_cred.must_change_password,
    'session_token', v_raw_token,
    'expires_at', v_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.authenticate_user_credentials(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticate_user_credentials(text, text, text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. RPC: Validar sesión propia en public.user_sessions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_user_session(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_token_hash text;
  v_session public.user_sessions%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_cred public.user_credentials%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_session_token), '') = '' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'missing_token');
  END IF;

  v_token_hash := encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex');

  SELECT *
  INTO v_session
  FROM public.user_sessions
  WHERE token_hash = v_token_hash
    AND revoked_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired_or_revoked');
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_session.user_id;

  IF NOT FOUND OR v_profile.is_active = false THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'user_inactive');
  END IF;

  SELECT *
  INTO v_cred
  FROM public.user_credentials
  WHERE user_id = v_session.user_id;

  UPDATE public.user_sessions
  SET last_seen_at = now()
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'valid', true,
    'user_id', v_profile.id,
    'email', v_cred.email,
    'username', v_profile.username,
    'full_name', v_profile.full_name,
    'is_active', COALESCE(v_profile.is_active, true),
    'must_change_password', COALESCE(v_cred.must_change_password, false),
    'expires_at', v_session.expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_user_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_user_session(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. RPC: Revocar sesión propia (Logout)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_user_session(p_session_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_token_hash text;
BEGIN
  IF COALESCE(btrim(p_session_token), '') = '' THEN
    RETURN;
  END IF;

  v_token_hash := encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex');

  UPDATE public.user_sessions
  SET revoked_at = now()
  WHERE token_hash = v_token_hash
    AND revoked_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_user_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_user_session(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. RPC de servidor: Registrar/inicializar credenciales en public.user_credentials
--    Usada al dar de alta usuarios desde `create-sitecorp-user` (SOLO service_role).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_user_credentials(
  p_user_id uuid,
  p_email text,
  p_plain_password text,
  p_must_change_password boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'upsert_user_credentials: operación reservada al servidor';
  END IF;

  IF p_user_id IS NULL OR COALESCE(btrim(p_email), '') = '' OR COALESCE(p_plain_password, '') = '' THEN
    RAISE EXCEPTION 'upsert_user_credentials: user_id, email y password son obligatorios';
  END IF;

  v_hash := extensions.crypt(p_plain_password, extensions.gen_salt('bf', 10));

  INSERT INTO public.user_credentials (
    user_id,
    email,
    password_hash,
    must_change_password,
    initial_password_generated_at,
    password_changed_at
  )
  VALUES (
    p_user_id,
    lower(btrim(p_email)),
    v_hash,
    COALESCE(p_must_change_password, true),
    CASE WHEN COALESCE(p_must_change_password, true) THEN now() ELSE NULL END,
    CASE WHEN COALESCE(p_must_change_password, true) THEN NULL ELSE now() END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    must_change_password = EXCLUDED.must_change_password,
    initial_password_generated_at = COALESCE(public.user_credentials.initial_password_generated_at, EXCLUDED.initial_password_generated_at),
    password_changed_at = EXCLUDED.password_changed_at,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now();

  -- Sincronizar también user_password_lifecycle para compatibilidad total
  INSERT INTO public.user_password_lifecycle (
    user_id,
    must_change_password,
    initial_password_generated_at,
    password_changed_at
  )
  VALUES (
    p_user_id,
    COALESCE(p_must_change_password, true),
    now(),
    CASE WHEN COALESCE(p_must_change_password, true) THEN NULL ELSE now() END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    must_change_password = EXCLUDED.must_change_password,
    password_changed_at = EXCLUDED.password_changed_at,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_user_credentials(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_user_credentials(uuid, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_user_credentials(uuid, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_user_credentials(uuid, text, text, boolean) TO service_role;

-- ----------------------------------------------------------------------------
-- 9. RPC: Actualizar contraseña en public.user_credentials con pgcrypto
--    Puede ser invocada por `service_role` (Edge Function) o por el propio
--    usuario autenticado (`auth.uid() = p_user_id`) para cambiar su contraseña.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_user_password_credentials(
  p_user_id uuid,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_role text := auth.role();
  v_caller_uid uuid := auth.uid();
  v_target_id uuid := COALESCE(p_user_id, v_caller_uid);
  v_hash text;
BEGIN
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'update_user_password_credentials: usuario no identificado';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'service_role' AND v_caller_uid IS DISTINCT FROM v_target_id THEN
    RAISE EXCEPTION 'update_user_password_credentials: no autorizado para modificar otro usuario';
  END IF;

  -- Validación de fortaleza en base de datos (mínimo 12 caracteres, mayúscula, minúscula, número y símbolo)
  IF char_length(COALESCE(p_new_password, '')) < 12
     OR p_new_password !~ '[A-Z]'
     OR p_new_password !~ '[a-z]'
     OR p_new_password !~ '[0-9]'
     OR p_new_password !~ '[^A-Za-z0-9\s]'
  THEN
    RAISE EXCEPTION 'La nueva contraseña no cumple con la política de seguridad (mínimo 12 caracteres, mayúscula, minúscula, número y símbolo).';
  END IF;

  v_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));

  UPDATE public.user_credentials
  SET password_hash = v_hash,
      must_change_password = false,
      password_changed_at = now(),
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE user_id = v_target_id;

  UPDATE public.user_password_lifecycle
  SET must_change_password = false,
      password_changed_at = now(),
      updated_at = now()
  WHERE user_id = v_target_id;

  -- Sincronizar también el hash en auth.users mientras PostgREST utilice JWT de Supabase
  UPDATE auth.users
  SET encrypted_password = v_hash,
      updated_at = now()
  WHERE id = v_target_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_user_password_credentials(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_password_credentials(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_user_password_credentials(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. RPC Nativa en PostgreSQL: Cambio de Contraseña Inicial (Sin Edge Functions)
--     Permite que la app local o desplegada confirme el cambio de contraseña
--     inicial directamente en PostgreSQL con `pgcrypto`, sin depender del
--     runtime de Edge Functions ni de `SUPABASE_SERVICE_ROLE_KEY`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_initial_password_change(
  p_new_password text,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_token_hash text;
  v_hash text;
  v_has_cred boolean := false;
  v_has_lifecycle boolean := false;
  v_must_change boolean := false;
BEGIN
  -- 1. Resolver identidad por sesión propia en PostgreSQL o por JWT
  IF v_user_id IS NULL AND COALESCE(btrim(p_session_token), '') <> '' THEN
    v_token_hash := encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex');
    SELECT s.user_id
    INTO v_user_id
    FROM public.user_sessions AS s
    WHERE s.token_hash = v_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sesión no válida o expirada. Inicia sesión nuevamente.'
    );
  END IF;

  -- 2. Verificar que exista usuario con cambio pendiente (o idempotencia si ya cambió)
  SELECT true, COALESCE(uc.must_change_password, false)
  INTO v_has_cred, v_must_change
  FROM public.user_credentials AS uc
  WHERE uc.user_id = v_user_id;

  SELECT true, (v_must_change OR COALESCE(upl.must_change_password, false))
  INTO v_has_lifecycle, v_must_change
  FROM public.user_password_lifecycle AS upl
  WHERE upl.user_id = v_user_id;

  IF NOT COALESCE(v_has_cred, false) AND NOT COALESCE(v_has_lifecycle, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No hay un cambio de contraseña pendiente.'
    );
  END IF;

  -- 3. Validar política de fortaleza en el motor PostgreSQL
  IF char_length(COALESCE(p_new_password, '')) < 12 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La contraseña debe tener al menos 12 caracteres.');
  END IF;
  IF p_new_password !~ '[a-z]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La contraseña debe incluir al menos una minúscula.');
  END IF;
  IF p_new_password !~ '[A-Z]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La contraseña debe incluir al menos una mayúscula.');
  END IF;
  IF p_new_password !~ '[0-9]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La contraseña debe incluir al menos un número.');
  END IF;
  IF p_new_password !~ '[^A-Za-z0-9\s]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La contraseña debe incluir al menos un símbolo.');
  END IF;

  -- 4. Hashear con bcrypt (pgcrypto) y actualizar en transacción atómica
  v_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));

  UPDATE public.user_credentials
  SET password_hash = v_hash,
      must_change_password = false,
      password_changed_at = now(),
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE user_id = v_user_id;

  UPDATE public.user_password_lifecycle
  SET must_change_password = false,
      password_changed_at = now(),
      updated_at = now()
  WHERE user_id = v_user_id;

  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = v_hash,
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_initial_password_change(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_initial_password_change(text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. RPC Nativa en PostgreSQL: Alta de Usuario con Credenciales y CSPRNG
--     Sustituye la dependencia obligatoria de `create-sitecorp-user` (Edge Function)
--     generando la contraseña inicial aleatoria de 24 caracteres directamente
--     en PostgreSQL con `extensions.gen_random_bytes` + `extensions.crypt`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_platform_user_with_credentials(
  p_full_name text,
  p_username text,
  p_email text,
  p_platform_role_id uuid,
  p_is_active boolean DEFAULT true,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_token_hash text;
  v_caller_active boolean;
  v_caller_must_change boolean;
  v_is_superadmin boolean := false;
  v_has_manage_all boolean := false;
  v_is_founder boolean := false;
  v_full_name text := btrim(COALESCE(p_full_name, ''));
  v_username text := btrim(COALESCE(p_username, ''));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_role record;
  v_new_user_id uuid := gen_random_uuid();
  v_upper text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_lower text := 'abcdefghijkmnopqrstuvwxyz';
  v_digits text := '23456789';
  v_symbols text := '!@#$%^&*-_=+?';
  v_all text;
  v_bytes bytea;
  v_chars text[] := ARRAY[]::text[];
  v_i int;
  v_j int;
  v_tmp text;
  v_initial_password text;
  v_password_hash text;
BEGIN
  -- 1. Resolver identidad del administrador llamante
  IF v_caller_id IS NULL AND COALESCE(btrim(p_session_token), '') <> '' THEN
    v_token_hash := encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex');
    SELECT s.user_id
    INTO v_caller_id
    FROM public.user_sessions AS s
    WHERE s.token_hash = v_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    LIMIT 1;
  END IF;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado: sesión de administrador requerida.';
  END IF;

  SELECT p.is_active
  INTO v_caller_active
  FROM public.profiles AS p
  WHERE p.id = v_caller_id;

  IF v_caller_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Acceso denegado: perfil de administrador inactivo.';
  END IF;

  SELECT COALESCE(
    (SELECT uc.must_change_password FROM public.user_credentials AS uc WHERE uc.user_id = v_caller_id),
    (SELECT upl.must_change_password FROM public.user_password_lifecycle AS upl WHERE upl.user_id = v_caller_id),
    false
  ) INTO v_caller_must_change;

  IF v_caller_must_change THEN
    RAISE EXCEPTION 'Acceso denegado: debes cambiar tu contraseña inicial antes de crear usuarios.';
  END IF;

  -- 2. Verificar permisos de plataforma del llamante
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = v_caller_id
      AND pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
  ) INTO v_is_superadmin;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_role_permissions AS prp ON prp.platform_role_id = pur.platform_role_id
    INNER JOIN public.platform_permissions AS pp ON pp.id = prp.platform_permission_id
    WHERE pur.user_id = v_caller_id
      AND pp.code = 'users.manage_all'
  ) INTO v_has_manage_all;

  IF NOT v_is_superadmin AND NOT v_has_manage_all THEN
    RAISE EXCEPTION 'Permisos insuficientes para dar de alta usuarios de plataforma.';
  END IF;

  -- 3. Validar datos de entrada y rol destino
  IF v_full_name = '' THEN
    RAISE EXCEPTION 'El nombre completo es obligatorio.';
  END IF;
  IF v_username = '' THEN
    RAISE EXCEPTION 'El nombre de usuario es obligatorio.';
  END IF;
  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'Introduce un correo electrónico válido.';
  END IF;
  IF p_platform_role_id IS NULL THEN
    RAISE EXCEPTION 'El rol de plataforma es obligatorio.';
  END IF;

  SELECT id, name, is_active, is_system_role
  INTO v_role
  FROM public.platform_roles
  WHERE id = p_platform_role_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rol de plataforma inválido.';
  END IF;
  IF NOT v_role.is_active THEN
    RAISE EXCEPTION 'El rol de plataforma seleccionado está inactivo.';
  END IF;

  IF v_role.name = 'SuperAdmin' AND v_role.is_system_role = true THEN
    SELECT EXISTS (
      SELECT 1 FROM public.platform_founder AS pf WHERE pf.user_id = v_caller_id
    ) INTO v_is_founder;

    IF NOT v_is_founder THEN
      RAISE EXCEPTION 'Solo la cuenta fundadora puede asignar el rol SuperAdmin.';
    END IF;
  END IF;

  -- 4. Verificar unicidad de username y correo
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(btrim(username)) = lower(v_username)) THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese nombre.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_credentials WHERE lower(btrim(email)) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un usuario con este correo.';
  END IF;

  -- 5. Generar contraseña inicial CSPRNG de 24 caracteres con extensions.gen_random_bytes
  v_all := v_upper || v_lower || v_digits || v_symbols;
  v_bytes := extensions.gen_random_bytes(64);

  v_chars := array_append(v_chars, substr(v_upper, (get_byte(v_bytes, 0) % length(v_upper)) + 1, 1));
  v_chars := array_append(v_chars, substr(v_lower, (get_byte(v_bytes, 1) % length(v_lower)) + 1, 1));
  v_chars := array_append(v_chars, substr(v_digits, (get_byte(v_bytes, 2) % length(v_digits)) + 1, 1));
  v_chars := array_append(v_chars, substr(v_symbols, (get_byte(v_bytes, 3) % length(v_symbols)) + 1, 1));

  FOR v_i IN 5..24 LOOP
    v_chars := array_append(
      v_chars,
      substr(v_all, (get_byte(v_bytes, v_i) % length(v_all)) + 1, 1)
    );
  END LOOP;

  -- Mezcla Fisher-Yates con bytes criptográficos
  FOR v_i IN REVERSE 24..2 LOOP
    v_j := (get_byte(v_bytes, 24 + v_i) % v_i) + 1;
    v_tmp := v_chars[v_i];
    v_chars[v_i] := v_chars[v_j];
    v_chars[v_j] := v_tmp;
  END LOOP;

  v_initial_password := array_to_string(v_chars, '');
  v_password_hash := extensions.crypt(v_initial_password, extensions.gen_salt('bf', 10));

  -- 6. Si existe auth.users en el entorno, sincronizar registro para compatibilidad JWT/FK
  IF to_regclass('auth.users') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM auth.users WHERE lower(btrim(email)) = v_email) THEN
      RAISE EXCEPTION 'Ya existe un usuario con este correo.';
    END IF;

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_new_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_password_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_full_name, 'username', v_username),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    IF to_regclass('auth.identities') IS NOT NULL THEN
      INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        v_new_user_id,
        v_new_user_id::text,
        jsonb_build_object(
          'sub', v_new_user_id::text,
          'email', v_email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        now(),
        now(),
        now()
      );
    END IF;
  END IF;

  -- 7. Persistir en public.profiles, public.user_credentials, public.user_password_lifecycle y public.platform_user_roles
  INSERT INTO public.profiles (id, full_name, username, is_active)
  VALUES (v_new_user_id, v_full_name, v_username, COALESCE(p_is_active, true))
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      username = EXCLUDED.username,
      is_active = EXCLUDED.is_active,
      updated_at = now();

  INSERT INTO public.user_credentials (
    user_id,
    email,
    password_hash,
    must_change_password,
    initial_password_generated_at
  )
  VALUES (
    v_new_user_id,
    v_email,
    v_password_hash,
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      must_change_password = true,
      initial_password_generated_at = now(),
      updated_at = now();

  INSERT INTO public.user_password_lifecycle (
    user_id,
    must_change_password,
    initial_password_generated_at
  )
  VALUES (
    v_new_user_id,
    true,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET must_change_password = true,
      initial_password_generated_at = now(),
      updated_at = now();

  INSERT INTO public.platform_user_roles (
    user_id,
    platform_role_id,
    assigned_by
  )
  VALUES (
    v_new_user_id,
    p_platform_role_id,
    v_caller_id
  );

  RETURN jsonb_build_object(
    'user_id', v_new_user_id,
    'email', v_email,
    'username', v_username,
    'full_name', v_full_name,
    'platform_role_id', p_platform_role_id,
    'platform_role_name', v_role.name,
    'initial_password', v_initial_password
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_platform_user_with_credentials(text, text, text, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_platform_user_with_credentials(text, text, text, uuid, boolean, text) TO authenticated, service_role;

COMMIT;
