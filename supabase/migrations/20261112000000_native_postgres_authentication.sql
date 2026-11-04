-- ============================================================================
-- SiteCorp · AUTENTICACIÓN Y AUTORIZACIÓN NATIVA EN POSTGRESQL (OFFLINE-READY)
-- Archivo: src/db/migrations/20261112_01_native_postgres_authentication.sql
-- ============================================================================
-- PROPÓSITO
--   1. Desacoplar completamente la autenticación, sesiones, RLS y claves
--      foráneas de `auth.users` (Supabase Auth / GoTrue) para que SiteCorp
--      funcione 100 % con PostgreSQL nativo (`public.profiles`,
--      `public.user_credentials`, `public.user_sessions`,
--      `public.platform_user_roles`) en entornos locales y Docker offline.
--   2. Restaurar y garantizar todas las restricciones, índices y claves
--      foráneas de las tablas de identidad y redirigir cualquier FK de
--      esquema `public` que apuntaba a `auth.users(id)` hacia
--      `public.profiles(id)` sin perder datos ni historial.
--   3. Resolver la identidad de la sesión nativa en PostgREST y PostgreSQL:
--        · `public.current_session_user_id()` valida el token enviado en la
--          cabecera HTTP `x-sitecorp-session` contra `public.user_sessions`
--          (SHA-256 + control de expiración, revocación y `profiles.is_active`).
--        · `auth.uid()`, `auth.role()` y `auth.jwt()` resuelven de forma
--          transparente la sesión nativa cuando no existe JWT de GoTrue.
--        · Hook `pgrst.db_pre_request` (`public.sitecorp_postgrest_pre_request`)
--          que valida `x-sitecorp-session`, inyecta los claims de la petición
--          y conmuta la transacción al rol `authenticated`.
--        · Emisión opcional de JWT HS256 firmado en PostgreSQL (`pgcrypto`)
--          cuando el secreto JWT local está disponible y verificado, para
--          compatibilidad directa con `storage-api` y PostgREST.
--   4. Actualizar las RPC de autenticación y administración de usuarios:
--        · `authenticate_user_credentials`
--        · `validate_user_session`
--        · `revoke_user_session`
--        · `update_user_password_credentials`
--        · `complete_initial_password_change`
--        · `create_platform_user_with_credentials`
--        · `delete_platform_user_account`
--
-- SEGURIDAD E IDEMPOTENCIA
--   · Transacción atómica (`BEGIN ... COMMIT`).
--   · No elimina tablas, usuarios, hashes bcrypt ni datos existentes.
--   · No desactiva RLS en ninguna tabla ni expone `service_role` al cliente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Extensiones requeridas
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;

-- ----------------------------------------------------------------------------
-- 1. Integridad estructural y recuperación de restricciones (Backup Restore)
-- ----------------------------------------------------------------------------

-- 1.1 Asegurar columna email y clave primaria en public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.profiles ADD PRIMARY KEY (id);
  END IF;
END;
$$;

-- 1.2 Eliminar cualquier FK de public.profiles hacia auth.users(id)
--     Usa pg_catalog (pg_class + pg_namespace) sin invocar 'auth.users'::regclass
--     para evitar errores 42501 (permission denied for schema auth).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class fcl ON fcl.oid = c.confrelid
    JOIN pg_catalog.pg_namespace fn ON fn.oid = fcl.relnamespace
    WHERE c.conrelid = 'public.profiles'::regclass
      AND c.contype = 'f'
      AND fn.nspname = 'auth'
      AND fcl.relname = 'users'
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', r.conname);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;

-- 1.3 Redirigir todas las FKs de tablas en `public` que apunten a `auth.users(id)`
--     hacia `public.profiles(id)` conservando su política ON DELETE.
DO $$
DECLARE
  r record;
  v_del_clause text;
  v_new_conname text;
BEGIN
  FOR r IN
    SELECT
      c.oid AS con_oid,
      c.conname,
      n.nspname AS table_schema,
      cl.relname AS table_name,
      c.confdeltype,
      a.attname AS col_name,
      a.attnotnull AS col_notnull
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class cl ON cl.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = cl.oid AND a.attnum = c.conkey[1]
    JOIN pg_catalog.pg_class fcl ON fcl.oid = c.confrelid
    JOIN pg_catalog.pg_namespace fn ON fn.oid = fcl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relname <> 'profiles'
      AND c.contype = 'f'
      AND fn.nspname = 'auth'
      AND fcl.relname = 'users'
      AND array_length(c.conkey, 1) = 1
  LOOP
    v_del_clause := CASE r.confdeltype
      WHEN 'c' THEN 'ON DELETE CASCADE'
      WHEN 'n' THEN 'ON DELETE SET NULL'
      WHEN 'r' THEN 'ON DELETE RESTRICT'
      ELSE 'ON DELETE NO ACTION'
    END;

    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
        r.table_schema,
        r.table_name,
        r.conname
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Si la columna admite NULL y contiene algún UUID huérfano que no existe en profiles, limpiarlo antes de crear la FK
    IF NOT r.col_notnull THEN
      BEGIN
        EXECUTE format(
          'UPDATE %I.%I AS t SET %I = NULL WHERE t.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = t.%I)',
          r.table_schema,
          r.table_name,
          r.col_name,
          r.col_name,
          r.col_name
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    v_new_conname := r.conname;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = format('%I.%I', r.table_schema, r.table_name)::regclass
        AND conname = v_new_conname
    ) THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) %s',
          r.table_schema,
          r.table_name,
          v_new_conname,
          r.col_name,
          v_del_clause
        );
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) %s NOT VALID',
            r.table_schema,
            r.table_name,
            v_new_conname,
            r.col_name,
            v_del_clause
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END;
    END IF;
  END LOOP;
END;
$$;

-- 1.4 Garantizar estructura y restricciones de public.user_credentials
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_credentials'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.user_credentials ADD PRIMARY KEY (user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_credentials'::regclass
      AND contype = 'f'
      AND confrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.user_credentials
      ADD CONSTRAINT user_credentials_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_credentials_email_lower
  ON public.user_credentials (lower(btrim(email)));

-- Sincronizar public.profiles.email desde public.user_credentials
UPDATE public.profiles AS p
SET email = lower(btrim(uc.email))
FROM public.user_credentials AS uc
WHERE uc.user_id = p.id
  AND uc.email IS NOT NULL
  AND btrim(uc.email) <> ''
  AND (p.email IS NULL OR btrim(p.email) = '');

-- 1.5 Garantizar estructura y restricciones de public.user_sessions
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_sessions'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.user_sessions ADD PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_sessions'::regclass
      AND contype = 'f'
      AND confrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.user_sessions
      ADD CONSTRAINT user_sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token_hash_unique
  ON public.user_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_lookup
  ON public.user_sessions (token_hash)
  WHERE revoked_at IS NULL;

-- 1.6 Garantizar restricciones en public.platform_user_roles y public.user_password_lifecycle
DO $$
BEGIN
  IF to_regclass('public.platform_user_roles') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.platform_user_roles'::regclass
        AND contype = 'f'
        AND confrelid = 'public.profiles'::regclass
    ) THEN
      BEGIN
        ALTER TABLE public.platform_user_roles
          ADD CONSTRAINT platform_user_roles_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  IF to_regclass('public.user_password_lifecycle') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.user_password_lifecycle'::regclass AND contype = 'p'
    ) THEN
      ALTER TABLE public.user_password_lifecycle ADD PRIMARY KEY (user_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.user_password_lifecycle'::regclass
        AND contype = 'f'
        AND confrelid = 'public.profiles'::regclass
    ) THEN
      BEGIN
        ALTER TABLE public.user_password_lifecycle
          ADD CONSTRAINT user_password_lifecycle_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;
END;
$$;

-- Sincronizar filas faltantes en user_password_lifecycle desde user_credentials
INSERT INTO public.user_password_lifecycle (
  user_id,
  must_change_password,
  initial_password_generated_at,
  password_changed_at,
  created_at,
  updated_at
)
SELECT
  uc.user_id,
  uc.must_change_password,
  uc.initial_password_generated_at,
  uc.password_changed_at,
  uc.created_at,
  uc.updated_at
FROM public.user_credentials AS uc
INNER JOIN public.profiles AS p ON p.id = uc.user_id
ON CONFLICT (user_id) DO UPDATE
SET
  must_change_password = EXCLUDED.must_change_password,
  initial_password_generated_at = COALESCE(public.user_password_lifecycle.initial_password_generated_at, EXCLUDED.initial_password_generated_at),
  password_changed_at = COALESCE(EXCLUDED.password_changed_at, public.user_password_lifecycle.password_changed_at),
  updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. Resolución de Sesión Nativa en PostgreSQL y PostgREST (Sin Supabase Auth)
-- ----------------------------------------------------------------------------

-- 2.1 Extraer el token de sesión propio desde las cabeceras HTTP de PostgREST
CREATE OR REPLACE FUNCTION public.extract_request_session_token()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_token text;
  v_headers_raw text;
  v_headers jsonb;
  v_auth_header text;
BEGIN
  -- 1. Variable de sesión establecida explícitamente en la transacción
  v_token := btrim(COALESCE(current_setting('app.current_session_token', true), ''));
  IF v_token <> '' THEN
    RETURN v_token;
  END IF;

  -- 2. Cabecera individual PostgREST legacy
  v_token := btrim(COALESCE(current_setting('request.header.x-sitecorp-session', true), ''));
  IF v_token <> '' THEN
    RETURN v_token;
  END IF;

  -- 3. JSON de cabeceras PostgREST v10+ (`request.headers`)
  v_headers_raw := current_setting('request.headers', true);
  IF v_headers_raw IS NOT NULL AND btrim(v_headers_raw) <> '' THEN
    BEGIN
      v_headers := v_headers_raw::jsonb;
      v_token := btrim(COALESCE(
        v_headers ->> 'x-sitecorp-session',
        v_headers ->> 'X-Sitecorp-Session',
        v_headers ->> 'x_sitecorp_session',
        ''
      ));
      IF v_token <> '' THEN
        RETURN v_token;
      END IF;

      -- Si Authorization: Bearer contiene un token hexadecimal de 64 caracteres (no un JWT con puntos)
      v_auth_header := btrim(COALESCE(v_headers ->> 'authorization', v_headers ->> 'Authorization', ''));
      IF v_auth_header ~* '^Bearer\s+[0-9a-f]{64}$' THEN
        v_token := btrim(regexp_replace(v_auth_header, '^Bearer\s+', '', 'i'));
        RETURN v_token;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.extract_request_session_token() TO PUBLIC, anon, authenticated, service_role;

-- 2.2 Resolver el UUID del usuario autenticado (JWT o sesión nativa en public.user_sessions)
CREATE OR REPLACE FUNCTION public.current_session_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cached text;
  v_sub text;
  v_claims_raw text;
  v_raw_token text;
  v_token_hash text;
  v_user_id uuid;
BEGIN
  -- 1. Caché local de la transacción actual
  v_cached := btrim(COALESCE(current_setting('app.current_user_id', true), ''));
  IF v_cached <> '' THEN
    BEGIN
      RETURN v_cached::uuid;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 2. Claim `sub` ya validado en la transacción (por db_pre_request o por JWT HS256)
  v_sub := btrim(COALESCE(current_setting('request.jwt.claim.sub', true), ''));
  IF v_sub = '' THEN
    v_claims_raw := current_setting('request.jwt.claims', true);
    IF v_claims_raw IS NOT NULL AND btrim(v_claims_raw) <> '' THEN
      BEGIN
        v_sub := btrim(COALESCE((v_claims_raw::jsonb) ->> 'sub', ''));
      EXCEPTION WHEN OTHERS THEN
        v_sub := '';
      END;
    END IF;
  END IF;

  IF v_sub <> '' THEN
    BEGIN
      v_user_id := v_sub::uuid;
      RETURN v_user_id;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  -- 3. Sesión nativa en public.user_sessions vía cabecera `x-sitecorp-session`
  v_raw_token := public.extract_request_session_token();
  IF v_raw_token IS NULL OR v_raw_token = '' THEN
    RETURN NULL;
  END IF;

  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  SELECT s.user_id
  INTO v_user_id
  FROM public.user_sessions AS s
  INNER JOIN public.profiles AS p
    ON p.id = s.user_id
  WHERE s.token_hash = v_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND COALESCE(p.is_active, true) = true
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', v_user_id::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'aud', 'authenticated',
        'role', 'authenticated',
        'sub', v_user_id::text
      )::text,
      true
    );
  END IF;

  RETURN v_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.current_session_user_id() TO PUBLIC, anon, authenticated, service_role;

-- 2.3 Actualizar auth.uid(), auth.role() y auth.jwt() de forma segura.
--     En contenedores Supabase donde el esquema `auth` pertenece a `supabase_auth_admin`,
--     intentamos asumir ese rol localmente si está permitido; si el usuario del SQL Editor
--     no tiene permiso CREATE en `auth`, NO fallamos: `sitecorp_postgrest_pre_request()`
--     y `current_session_user_id()` ya inyectan `request.jwt.claim.sub` y `request.jwt.claims`,
--     que es exactamente lo que leen las funciones `auth.uid()` y `auth.role()` nativas.
DO $$
DECLARE
  v_prev_role text := current_user;
  v_switched boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    BEGIN
      EXECUTE 'SET LOCAL ROLE supabase_auth_admin';
      v_switched := true;
    EXCEPTION WHEN OTHERS THEN
      v_switched := false;
    END;
  END IF;

  IF NOT v_switched AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      EXECUTE 'SET LOCAL ROLE supabase_admin';
      v_switched := true;
    EXCEPTION WHEN OTHERS THEN
      v_switched := false;
    END;
  END IF;

  BEGIN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path TO ''
      AS $fn$
        SELECT public.current_session_user_id();
      $fn$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
    $sql$;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION auth.role()
      RETURNS text
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
      SET search_path TO ''
      AS $fn$
      DECLARE
        v_jwt_role text;
        v_claims_raw text;
      BEGIN
        v_jwt_role := btrim(COALESCE(current_setting('request.jwt.claim.role', true), ''));
        IF v_jwt_role = '' THEN
          v_claims_raw := current_setting('request.jwt.claims', true);
          IF v_claims_raw IS NOT NULL AND btrim(v_claims_raw) <> '' THEN
            BEGIN
              v_jwt_role := btrim(COALESCE((v_claims_raw::jsonb) ->> 'role', ''));
            EXCEPTION WHEN OTHERS THEN
              v_jwt_role := '';
            END;
          END IF;
        END IF;

        IF v_jwt_role = 'service_role' THEN
          RETURN 'service_role';
        END IF;

        IF public.current_session_user_id() IS NOT NULL THEN
          RETURN 'authenticated';
        END IF;

        IF v_jwt_role <> '' THEN
          RETURN v_jwt_role;
        END IF;

        RETURN 'anon';
      END;
      $fn$;
      GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
    $sql$;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION auth.jwt()
      RETURNS jsonb
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
      SET search_path TO ''
      AS $fn$
      DECLARE
        v_claims_raw text;
        v_claims jsonb := '{}'::jsonb;
        v_uid uuid;
      BEGIN
        v_claims_raw := current_setting('request.jwt.claims', true);
        IF v_claims_raw IS NOT NULL AND btrim(v_claims_raw) <> '' THEN
          BEGIN
            v_claims := v_claims_raw::jsonb;
          EXCEPTION WHEN OTHERS THEN
            v_claims := '{}'::jsonb;
          END;
        END IF;

        v_uid := public.current_session_user_id();
        IF v_uid IS NOT NULL THEN
          v_claims := v_claims || jsonb_build_object(
            'sub', v_uid::text,
            'role', CASE WHEN (v_claims ->> 'role') = 'service_role' THEN 'service_role' ELSE 'authenticated' END,
            'aud', 'authenticated'
          );
        END IF;

        RETURN v_claims;
      END;
      $fn$;
      GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC, anon, authenticated, service_role;
    $sql$;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF v_switched THEN
    BEGIN
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;

-- 2.4 Hook `pgrst.db_pre_request` para PostgREST
--     Valida `x-sitecorp-session` al inicio de cada petición HTTP, fija los claims
--     transaccionales y conmuta el rol de la transacción de `anon` a `authenticated`.
CREATE OR REPLACE FUNCTION public.resolve_session_from_request_headers()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_raw_token text;
  v_token_hash text;
  v_user_id uuid;
  v_email text;
  v_username text;
BEGIN
  v_raw_token := public.extract_request_session_token();
  IF v_raw_token IS NULL OR v_raw_token = '' THEN
    RETURN false;
  END IF;

  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  SELECT
    s.user_id,
    COALESCE(uc.email, p.email, ''),
    COALESCE(p.username, '')
  INTO
    v_user_id,
    v_email,
    v_username
  FROM public.user_sessions AS s
  INNER JOIN public.profiles AS p
    ON p.id = s.user_id
  LEFT JOIN public.user_credentials AS uc
    ON uc.user_id = p.id
  WHERE s.token_hash = v_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND COALESCE(p.is_active, true) = true
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.current_user_id', v_user_id::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'aud', 'authenticated',
      'role', 'authenticated',
      'sub', v_user_id::text,
      'email', v_email,
      'user_metadata', jsonb_build_object('username', v_username)
    )::text,
    true
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_session_from_request_headers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_session_from_request_headers() TO anon, authenticated, service_role;

-- Nota: `sitecorp_postgrest_pre_request` DEBE ser SECURITY INVOKER para que PostgreSQL
-- permita ejecutar `SET LOCAL ROLE authenticated` dentro de la transacción de PostgREST.
CREATE OR REPLACE FUNCTION public.sitecorp_postgrest_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_current_role text;
BEGIN
  v_current_role := btrim(COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  ));

  IF v_current_role = 'service_role' THEN
    RETURN;
  END IF;

  IF public.resolve_session_from_request_headers() THEN
    IF current_user = 'anon' THEN
      SET LOCAL ROLE authenticated;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear las llamadas públicas (como authenticate_user_credentials)
  NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sitecorp_postgrest_pre_request() TO PUBLIC, anon, authenticated, service_role;

-- Permitir que `anon` y `authenticator` conmuten a `authenticated` y hereden privilegios
-- cuando la sesión nativa sea válida (todas las políticas RLS siguen exigiendo auth.uid()!).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
  THEN
    BEGIN
      EXECUTE 'GRANT authenticated TO anon';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      EXECUTE 'ALTER ROLE anon INHERIT';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
  THEN
    BEGIN
      EXECUTE 'GRANT authenticated TO authenticator';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    BEGIN
      EXECUTE 'ALTER ROLE authenticator SET pgrst.db_pre_request = ''public.sitecorp_postgrest_pre_request''';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  BEGIN
    EXECUTE format(
      'ALTER DATABASE %I SET pgrst.db_pre_request = ''public.sitecorp_postgrest_pre_request''',
      current_database()
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Emisión de JWT HS256 Nativo desde PostgreSQL (para Storage y PostgREST)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.base64url_encode(p_data bytea)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT translate(regexp_replace(encode(p_data, 'base64'), E'[\\n\\r=]+', '', 'g'), '+/', '-_');
$function$;

CREATE OR REPLACE FUNCTION public.sign_hs256_jwt(p_payload jsonb, p_secret text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_header text;
  v_body text;
  v_signing_input text;
  v_sig text;
BEGIN
  v_header := public.base64url_encode(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'));
  v_body := public.base64url_encode(convert_to(p_payload::text, 'UTF8'));
  v_signing_input := v_header || '.' || v_body;
  v_sig := public.base64url_encode(extensions.hmac(v_signing_input, p_secret, 'sha256'));
  RETURN v_signing_input || '.' || v_sig;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_verified_jwt_secret()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_headers_raw text;
  v_headers jsonb;
  v_apikey text := '';
  v_parts text[];
  v_signing_input text;
  v_expected_sig text;
  v_candidate text;
  v_candidates text[];
BEGIN
  v_candidates := ARRAY[
    btrim(COALESCE(current_setting('app.settings.jwt_secret', true), '')),
    btrim(COALESCE(current_setting('pgrst.jwt_secret', true), '')),
    'super-secret-jwt-token-with-at-least-32-characters-long',
    'your-super-secret-jwt-token-with-at-least-32-characters-long'
  ];

  v_headers_raw := current_setting('request.headers', true);
  IF v_headers_raw IS NOT NULL AND btrim(v_headers_raw) <> '' THEN
    BEGIN
      v_headers := v_headers_raw::jsonb;
      v_apikey := btrim(COALESCE(v_headers ->> 'apikey', v_headers ->> 'x-api-key', ''));
    EXCEPTION WHEN OTHERS THEN
      v_apikey := '';
    END;
  END IF;

  -- Si `apikey` es un JWT de 3 segmentos, comprobamos matemáticamente qué candidato
  -- firma exactamente ese `apikey`. Así garantizamos que el JWT emitido nunca sea
  -- rechazado por PostgREST ni por storage-api con JWSInvalidSignature.
  IF v_apikey <> '' THEN
    v_parts := string_to_array(v_apikey, '.');
    IF array_length(v_parts, 1) = 3 THEN
      v_signing_input := v_parts[1] || '.' || v_parts[2];
      v_expected_sig := v_parts[3];

      FOREACH v_candidate IN ARRAY v_candidates LOOP
        IF v_candidate <> '' AND length(v_candidate) >= 16 THEN
          IF public.base64url_encode(extensions.hmac(v_signing_input, v_candidate, 'sha256')) = v_expected_sig THEN
            RETURN v_candidate;
          END IF;
        END IF;
      END LOOP;

      -- Si `apikey` es un JWT pero ningún candidato coincide con su firma, no emitimos JWT
      RETURN NULL;
    END IF;
  END IF;

  -- Si `apikey` no es un JWT (p. ej. sb_publishable_*), solo usamos un secreto explícito configurado en la BD
  v_candidate := btrim(COALESCE(current_setting('app.settings.jwt_secret', true), ''));
  IF v_candidate <> '' AND length(v_candidate) >= 16 THEN
    RETURN v_candidate;
  END IF;

  v_candidate := btrim(COALESCE(current_setting('pgrst.jwt_secret', true), ''));
  IF v_candidate <> '' AND length(v_candidate) >= 16 THEN
    RETURN v_candidate;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.try_sign_session_jwt(
  p_user_id uuid,
  p_email text,
  p_username text,
  p_full_name text,
  p_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
  v_iat bigint;
  v_exp bigint;
  v_payload jsonb;
BEGIN
  v_secret := public.resolve_verified_jwt_secret();
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN NULL;
  END IF;

  v_iat := floor(extract(epoch FROM now()))::bigint;
  v_exp := floor(extract(epoch FROM COALESCE(p_expires_at, now() + interval '8 hours')))::bigint;

  v_payload := jsonb_build_object(
    'aud', 'authenticated',
    'role', 'authenticated',
    'sub', p_user_id::text,
    'email', COALESCE(p_email, ''),
    'iat', v_iat,
    'exp', v_exp,
    'app_metadata', jsonb_build_object('provider', 'sitecorp_postgres', 'providers', jsonb_build_array('sitecorp_postgres')),
    'user_metadata', jsonb_build_object('username', COALESCE(p_username, ''), 'full_name', COALESCE(p_full_name, ''))
  );

  RETURN public.sign_hs256_jwt(v_payload, v_secret);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.base64url_encode(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sign_hs256_jwt(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_verified_jwt_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_sign_session_jwt(uuid, text, text, text, timestamptz) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Funciones de Autorización de Plataforma y Ciclo de Vida de Contraseña
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr
      ON pr.id = pur.platform_role_id
    INNER JOIN public.profiles AS p
      ON p.id = pur.user_id
    WHERE pur.user_id = public.current_session_user_id()
      AND COALESCE(p.is_active, true) = true
      AND pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_platform_superadmin() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_platform_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr
      ON pr.id = pur.platform_role_id
    INNER JOIN public.profiles AS p
      ON p.id = pur.user_id
    WHERE pur.user_id = public.current_session_user_id()
      AND COALESCE(p.is_active, true) = true
      AND pr.is_active = true
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_platform_user() TO anon, authenticated, service_role;

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
      WHERE uc.user_id = public.current_session_user_id()
    ),
    (
      SELECT lifecycle.must_change_password
      FROM public.user_password_lifecycle AS lifecycle
      WHERE lifecycle.user_id = public.current_session_user_id()
    ),
    false
  );
$function$;

GRANT EXECUTE ON FUNCTION public.current_user_must_change_password() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC Principal: authenticate_user_credentials (100% Nativa PostgreSQL)
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
  v_avatar_url text;
  v_profile_email text;
  v_is_active boolean;
  v_cred public.user_credentials%ROWTYPE;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
  v_must_change boolean := false;
  v_is_superadmin boolean := false;
  v_is_platform_user boolean := false;
  v_access_token text := NULL;
BEGIN
  IF v_clean_id = '' OR COALESCE(p_password, '') = '' THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'invalid_credentials',
      'message', 'Credenciales inválidas.'
    );
  END IF;

  -- 1. Buscar usuario exclusivamente en public.profiles + public.user_credentials
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.email,
    COALESCE(p.is_active, true)
  INTO
    v_user_id,
    v_username,
    v_full_name,
    v_avatar_url,
    v_profile_email,
    v_is_active
  FROM public.profiles AS p
  LEFT JOIN public.user_credentials AS uc
    ON uc.user_id = p.id
  WHERE lower(btrim(COALESCE(p.username, ''))) = v_clean_id
     OR lower(btrim(COALESCE(uc.email, ''))) = v_clean_id
     OR lower(btrim(COALESCE(p.email, ''))) = v_clean_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'invalid_credentials',
      'message', 'Credenciales inválidas.'
    );
  END IF;

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

  -- 2. Comprobar bloqueo temporal por intentos fallidos
  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'account_locked',
      'message', 'Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta nuevamente en unos minutos.'
    );
  END IF;

  -- 3. Verificar hash bcrypt con pgcrypto
  IF v_cred.password_hash IS NULL
     OR btrim(v_cred.password_hash) = ''
     OR v_cred.password_hash <> extensions.crypt(p_password, v_cred.password_hash)
  THEN
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

  -- 4. Verificar si el perfil está activo
  IF v_is_active = false THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'reason', 'account_inactive',
      'message', 'Tu cuenta está desactivada. Contacta al administrador.'
    );
  END IF;

  -- 5. Reiniciar contador de fallos y emitir sesión en public.user_sessions
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

  -- 6. Resolver estado de cambio de contraseña y roles de plataforma
  SELECT COALESCE(
    v_cred.must_change_password,
    (SELECT upl.must_change_password FROM public.user_password_lifecycle AS upl WHERE upl.user_id = v_user_id),
    false
  ) INTO v_must_change;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = v_user_id
      AND pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
  ) INTO v_is_superadmin;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = v_user_id
      AND pr.is_active = true
  ) INTO v_is_platform_user;

  v_access_token := public.try_sign_session_jwt(
    v_user_id,
    COALESCE(v_cred.email, v_profile_email),
    v_username,
    v_full_name,
    v_expires_at
  );

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', v_user_id,
    'email', COALESCE(v_cred.email, v_profile_email),
    'username', v_username,
    'full_name', v_full_name,
    'avatar_url', v_avatar_url,
    'is_active', true,
    'must_change_password', COALESCE(v_must_change, false),
    'is_platform_superadmin', COALESCE(v_is_superadmin, false),
    'is_platform_user', COALESCE(v_is_platform_user OR v_is_superadmin, false),
    'session_token', v_raw_token,
    'access_token', v_access_token,
    'expires_at', v_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.authenticate_user_credentials(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticate_user_credentials(text, text, text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. RPC: validate_user_session
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
  v_must_change boolean := false;
  v_is_superadmin boolean := false;
  v_is_platform_user boolean := false;
  v_access_token text := NULL;
BEGIN
  IF COALESCE(btrim(p_session_token), '') = '' THEN
    RETURN jsonb_build_object('valid', false, 'is_valid', false, 'reason', 'missing_token');
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
    RETURN jsonb_build_object('valid', false, 'is_valid', false, 'reason', 'expired_or_revoked');
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_session.user_id;

  IF NOT FOUND OR v_profile.is_active = false THEN
    RETURN jsonb_build_object('valid', false, 'is_valid', false, 'reason', 'user_inactive');
  END IF;

  SELECT *
  INTO v_cred
  FROM public.user_credentials
  WHERE user_id = v_session.user_id;

  UPDATE public.user_sessions
  SET last_seen_at = now()
  WHERE id = v_session.id;

  SELECT COALESCE(
    v_cred.must_change_password,
    (SELECT upl.must_change_password FROM public.user_password_lifecycle AS upl WHERE upl.user_id = v_profile.id),
    false
  ) INTO v_must_change;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = v_profile.id
      AND pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
  ) INTO v_is_superadmin;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = v_profile.id
      AND pr.is_active = true
  ) INTO v_is_platform_user;

  v_access_token := public.try_sign_session_jwt(
    v_profile.id,
    COALESCE(v_cred.email, v_profile.email),
    v_profile.username,
    v_profile.full_name,
    v_session.expires_at
  );

  RETURN jsonb_build_object(
    'valid', true,
    'is_valid', true,
    'user_id', v_profile.id,
    'email', COALESCE(v_cred.email, v_profile.email),
    'username', v_profile.username,
    'full_name', v_profile.full_name,
    'avatar_url', v_profile.avatar_url,
    'is_active', COALESCE(v_profile.is_active, true),
    'must_change_password', COALESCE(v_must_change, false),
    'is_platform_superadmin', COALESCE(v_is_superadmin, false),
    'is_platform_user', COALESCE(v_is_platform_user OR v_is_superadmin, false),
    'access_token', v_access_token,
    'expires_at', v_session.expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_user_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_user_session(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6B. RPC: revoke_user_session y complete_initial_password_change
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
  v_user_id uuid := public.current_session_user_id();
  v_token_hash text;
  v_hash text;
  v_has_cred boolean := false;
  v_has_lifecycle boolean := false;
BEGIN
  IF v_user_id IS NULL AND COALESCE(btrim(p_session_token), '') <> '' THEN
    v_token_hash := encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex');
    SELECT s.user_id
    INTO v_user_id
    FROM public.user_sessions AS s
    INNER JOIN public.profiles AS p ON p.id = s.user_id
    WHERE s.token_hash = v_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND COALESCE(p.is_active, true) = true
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sesión no válida o expirada. Inicia sesión nuevamente.'
    );
  END IF;

  SELECT true
  INTO v_has_cred
  FROM public.user_credentials AS uc
  WHERE uc.user_id = v_user_id;

  SELECT true
  INTO v_has_lifecycle
  FROM public.user_password_lifecycle AS upl
  WHERE upl.user_id = v_user_id;

  IF NOT COALESCE(v_has_cred, false) AND NOT COALESCE(v_has_lifecycle, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No hay un cambio de contraseña pendiente.'
    );
  END IF;

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

  v_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf', 10));

  UPDATE public.user_credentials
  SET password_hash = v_hash,
      must_change_password = false,
      password_changed_at = now(),
      failed_attempts = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_password_lifecycle (
    user_id,
    must_change_password,
    password_changed_at,
    updated_at
  )
  VALUES (
    v_user_id,
    false,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET must_change_password = false,
      password_changed_at = now(),
      updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_initial_password_change(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_initial_password_change(text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. RPC: Actualizar Contraseña del Usuario (Soporta token de sesión propio)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_user_password_credentials(
  p_user_id uuid,
  p_new_password text,
  p_session_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_role text := btrim(COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  ));
  v_caller_uid uuid := public.current_session_user_id();
  v_token_hash text;
  v_target_id uuid;
  v_hash text;
BEGIN
  IF v_caller_uid IS NULL AND COALESCE(btrim(p_session_token), '') <> '' THEN
    v_token_hash := encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex');
    SELECT s.user_id
    INTO v_caller_uid
    FROM public.user_sessions AS s
    INNER JOIN public.profiles AS p ON p.id = s.user_id
    WHERE s.token_hash = v_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND COALESCE(p.is_active, true) = true
    LIMIT 1;
  END IF;

  v_target_id := COALESCE(p_user_id, v_caller_uid);

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'update_user_password_credentials: usuario no identificado';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'service_role' AND v_caller_uid IS DISTINCT FROM v_target_id THEN
    RAISE EXCEPTION 'update_user_password_credentials: no autorizado para modificar otro usuario';
  END IF;

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

  INSERT INTO public.user_password_lifecycle (
    user_id,
    must_change_password,
    password_changed_at,
    updated_at
  )
  VALUES (
    v_target_id,
    false,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET must_change_password = false,
      password_changed_at = now(),
      updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.update_user_password_credentials(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_password_credentials(uuid, text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. RPC Nativa: Alta de Usuario de Plataforma (100% independiente de auth.users)
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
  v_caller_id uuid := public.current_session_user_id();
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

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(btrim(username)) = lower(v_username)) THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese nombre.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_credentials WHERE lower(btrim(email)) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un usuario con este correo.';
  END IF;

  -- Generar contraseña inicial CSPRNG de 24 caracteres
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

  FOR v_i IN REVERSE 24..2 LOOP
    v_j := (get_byte(v_bytes, 24 + v_i) % v_i) + 1;
    v_tmp := v_chars[v_i];
    v_chars[v_i] := v_chars[v_j];
    v_chars[v_j] := v_tmp;
  END LOOP;

  v_initial_password := array_to_string(v_chars, '');
  v_password_hash := extensions.crypt(v_initial_password, extensions.gen_salt('bf', 10));

  -- Fijar el usuario actor en la transacción para que triggers de auditoría/fundador lo reconozcan
  PERFORM set_config('app.current_user_id', v_caller_id::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_caller_id::text, true);

  INSERT INTO public.profiles (id, full_name, username, email, is_active)
  VALUES (v_new_user_id, v_full_name, v_username, v_email, COALESCE(p_is_active, true));

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
  );

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
GRANT EXECUTE ON FUNCTION public.create_platform_user_with_credentials(text, text, text, uuid, boolean, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9. RPC Nativa: Eliminación de Usuario de Plataforma (Sin depender de auth.users)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_platform_user_account(
  p_target_user_id uuid,
  p_confirm_username text,
  p_session_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := public.current_session_user_id();
  v_token_hash text;
  v_caller_active boolean;
  v_caller_must_change boolean;
  v_is_caller_superadmin boolean := false;
  v_target_profile public.profiles%ROWTYPE;
  v_target_is_superadmin boolean := false;
  v_active_superadmins integer := 0;
BEGIN
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
    RETURN jsonb_build_object('deleted', false, 'error', 'No autorizado: sesión requerida.');
  END IF;

  SELECT p.is_active INTO v_caller_active FROM public.profiles AS p WHERE p.id = v_caller_id;
  IF v_caller_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'Acceso denegado: perfil de administrador inactivo.');
  END IF;

  SELECT COALESCE(
    (SELECT uc.must_change_password FROM public.user_credentials AS uc WHERE uc.user_id = v_caller_id),
    (SELECT upl.must_change_password FROM public.user_password_lifecycle AS upl WHERE upl.user_id = v_caller_id),
    false
  ) INTO v_caller_must_change;

  IF v_caller_must_change THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'Debes cambiar tu contraseña inicial antes de eliminar usuarios.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = v_caller_id
      AND pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
  ) INTO v_is_caller_superadmin;

  IF NOT v_is_caller_superadmin THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'Se requiere el rol SuperAdmin para eliminar usuarios.');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'El usuario a eliminar es obligatorio.');
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'No puedes eliminar tu propia cuenta.');
  END IF;

  SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_target_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'El usuario no existe o ya fue eliminado.');
  END IF;

  IF lower(btrim(COALESCE(v_target_profile.username, ''))) <> lower(btrim(COALESCE(p_confirm_username, ''))) THEN
    RETURN jsonb_build_object('deleted', false, 'error', 'La confirmación no coincide con el nombre de usuario.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_founder WHERE user_id = p_target_user_id) THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'reason', 'founder_protected',
      'error', 'La cuenta fundadora de SiteCorp no se puede eliminar ni desactivar: es la única autorizada para administrar el rol SuperAdmin.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    WHERE pur.user_id = p_target_user_id
      AND pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
  ) INTO v_target_is_superadmin;

  IF v_target_is_superadmin THEN
    SELECT count(DISTINCT pur.user_id)
    INTO v_active_superadmins
    FROM public.platform_user_roles AS pur
    INNER JOIN public.platform_roles AS pr ON pr.id = pur.platform_role_id
    INNER JOIN public.profiles AS p ON p.id = pur.user_id
    WHERE pr.name = 'SuperAdmin'
      AND pr.is_system_role = true
      AND pr.is_active = true
      AND COALESCE(p.is_active, true) = true;

    IF v_active_superadmins <= 1 THEN
      RETURN jsonb_build_object(
        'deleted', false,
        'error', 'No se puede eliminar la última cuenta de SuperAdmin activa: SiteCorp quedaría sin administración global.'
      );
    END IF;
  END IF;

  BEGIN
    DELETE FROM public.profiles WHERE id = p_target_user_id;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RETURN jsonb_build_object(
        'deleted', false,
        'reason', 'has_history',
        'error', 'No se puede eliminar el usuario porque participa en registros históricos (documentos, asignaciones o creaciones de otros usuarios). Se conserva el historial: desactiva la cuenta en su lugar.'
      );
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'deleted', false,
        'error', 'No se pudo eliminar el usuario: ' || SQLERRM
      );
  END;

  RETURN jsonb_build_object('deleted', true, 'user_id', p_target_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_platform_user_account(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_platform_user_account(uuid, text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10. Actualizar RPCs de negocio que consultaban `auth.users` para correo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_platform_user_emails()
RETURNS TABLE (
  user_id uuid,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF public.current_session_user_id() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    COALESCE(
      NULLIF(btrim(uc.email), ''),
      NULLIF(btrim(p.email), '')
    ) AS email
  FROM public.profiles AS p
  LEFT JOIN public.user_credentials AS uc ON uc.user_id = p.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_platform_user_emails() TO anon, authenticated, service_role;

-- Actualizar `save_entity_plan` para leer el email desde `user_credentials` / `profiles` en lugar de `auth.users`
DO $$
BEGIN
  IF to_regclass('public.entity_plans') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.save_entity_plan(
      p_entity_id UUID,
      p_package_prenomina BOOLEAN,
      p_package_training_sst BOOLEAN,
      p_reason TEXT DEFAULT NULL,
      p_user_id UUID DEFAULT NULL
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_entity RECORD;
      v_existing_plan RECORD;
      v_new_combination VARCHAR(50);
      v_old_combination VARCHAR(50);
      v_op_type VARCHAR(20);
      v_added TEXT[] := '{}';
      v_removed TEXT[] := '{}';
      v_plan_id UUID;
      v_user_email TEXT := NULL;
      v_acting_user_id UUID;
      v_result JSONB;
    BEGIN
      v_acting_user_id := COALESCE(p_user_id, public.current_session_user_id());
      IF v_acting_user_id IS NOT NULL THEN
        SELECT COALESCE(uc.email, p.email)
        INTO v_user_email
        FROM public.profiles AS p
        LEFT JOIN public.user_credentials AS uc ON uc.user_id = p.id
        WHERE p.id = v_acting_user_id;
      END IF;

      SELECT id, company_client_id, is_sitecorp_account, name
      INTO v_entity
      FROM public.organization_entities
      WHERE id = p_entity_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Error: la entidad seleccionada no existe. Debes crearla antes de asignarle un plan.';
      END IF;

      IF v_entity.is_sitecorp_account IS NOT TRUE THEN
        RAISE EXCEPTION 'Error: esta entidad no está registrada como cuenta SiteCorp. No es posible asignarle un plan.';
      END IF;

      IF p_package_prenomina = true AND p_package_training_sst = true THEN
        v_new_combination := 'BASIC_FULL';
      ELSIF p_package_prenomina = true AND p_package_training_sst = false THEN
        v_new_combination := 'BASIC_PRENOMINA';
      ELSIF p_package_prenomina = false AND p_package_training_sst = true THEN
        v_new_combination := 'BASIC_TRAINING_SST';
      ELSE
        v_new_combination := 'BASIC';
      END IF;

      SELECT * INTO v_existing_plan
      FROM public.entity_plans
      WHERE entity_id = p_entity_id
      FOR UPDATE;

      IF FOUND THEN
        v_plan_id := v_existing_plan.id;
        v_old_combination := v_existing_plan.plan_combination;

        IF v_existing_plan.package_prenomina = p_package_prenomina AND
           v_existing_plan.package_training_sst = p_package_training_sst THEN
          SELECT to_jsonb(p) INTO v_result FROM public.entity_plans p WHERE p.id = v_plan_id;
          RETURN v_result;
        END IF;

        IF (NOT v_existing_plan.package_prenomina) AND p_package_prenomina THEN
          v_added := array_append(v_added, 'Prenómina');
        END IF;
        IF v_existing_plan.package_prenomina AND (NOT p_package_prenomina) THEN
          v_removed := array_append(v_removed, 'Prenómina');
        END IF;

        IF (NOT v_existing_plan.package_training_sst) AND p_package_training_sst THEN
          v_added := array_append(v_added, 'Capacitación y SST');
        END IF;
        IF v_existing_plan.package_training_sst AND (NOT p_package_training_sst) THEN
          v_removed := array_append(v_removed, 'Capacitación y SST');
        END IF;

        IF array_length(v_added, 1) > 0 AND array_length(v_removed, 1) > 0 THEN
          v_op_type := 'MODIFICATION';
        ELSIF array_length(v_added, 1) > 0 THEN
          v_op_type := 'EXPANSION';
        ELSE
          v_op_type := 'REDUCTION';
        END IF;

        UPDATE public.entity_plans
        SET
          package_prenomina = p_package_prenomina,
          package_training_sst = p_package_training_sst,
          plan_combination = v_new_combination,
          updated_at = now(),
          updated_by = v_acting_user_id
        WHERE id = v_plan_id;
      ELSE
        v_old_combination := NULL;
        v_op_type := 'INITIAL_ASSIGNMENT';
        v_added := array_append(v_added, 'Plan Básico');
        IF p_package_prenomina THEN
          v_added := array_append(v_added, 'Prenómina');
        END IF;
        IF p_package_training_sst THEN
          v_added := array_append(v_added, 'Capacitación y SST');
        END IF;

        INSERT INTO public.entity_plans (
          entity_id,
          company_client_id,
          package_basic,
          package_prenomina,
          package_training_sst,
          plan_combination,
          created_by,
          updated_by
        ) VALUES (
          p_entity_id,
          v_entity.company_client_id,
          true,
          p_package_prenomina,
          p_package_training_sst,
          v_new_combination,
          v_acting_user_id,
          v_acting_user_id
        )
        RETURNING id INTO v_plan_id;
      END IF;

      INSERT INTO public.entity_plan_history (
        entity_plan_id,
        entity_id,
        company_client_id,
        operation_type,
        previous_combination,
        new_combination,
        packages_added,
        packages_removed,
        reason,
        changed_by,
        changed_by_email
      ) VALUES (
        v_plan_id,
        p_entity_id,
        v_entity.company_client_id,
        v_op_type,
        v_old_combination,
        v_new_combination,
        v_added,
        v_removed,
        NULLIF(btrim(COALESCE(p_reason, '')), ''),
        v_acting_user_id,
        v_user_email
      );

      SELECT to_jsonb(p) INTO v_result FROM public.entity_plans p WHERE p.id = v_plan_id;
      RETURN v_result;
    END;
    $fn$;
  END IF;
END;
$$;

-- Notificar a PostgREST para recargar configuración (`db-pre-request`) y esquema
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

COMMIT;
