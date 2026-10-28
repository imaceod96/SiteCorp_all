-- ============================================================================
-- SiteCorp · BLOQUE 35.2C.3 — BARRERA DE SERVIDOR PARA RPC SECURITY DEFINER
--
-- PREPARADA, NO APLICADA. Requiere autorización expresa antes de aplicarse.
-- DEPENDENCIA: requiere que 20261028_02_password_change_gate.sql esté aplicada
--             (define public.current_user_must_change_password()).
-- ORDEN DE APLICACIÓN: 20261028_01 → _02 → _03 → _04.
--
-- MOTIVO
--   Las funciones SECURITY DEFINER se ejecutan como su propietario (`postgres`)
--   y, por tanto, ELUDEN las políticas RLS. La barrera de tablas (`_02`) no las
--   cubre. En Supabase gestionado NO existe un mecanismo central de pre-request
--   (PostgREST `db-pre-request` no es configurable: el rol `authenticator` no
--   admite `pgrst.*` y la configuración vive fuera de la BD; ver informe 11).
--
-- MECANISMO ELEGIDO — «envoltura con guarda» (centralizado, sin reescribir cuerpos)
--   Para cada función objetivo se hace, en una sola transacción:
--     1) ALTER FUNCTION <original> RENAME TO <original>__pcgate_<oid>   (interno)
--     2) CREATE FUNCTION <original>(...) que:
--          · llama a public.assert_password_change_allowed()  (la guarda), y
--          · delega en el interno con los MISMOS argumentos posicionales.
--     3) Privilegios: la guarda se concede a `authenticated`; el interno queda
--        REVOCADO de PUBLIC/anon/authenticated (no se puede saltar la guarda).
--   La firma (nombre, tipos, nombres de argumento) se PRESERVA, por lo que los
--   llamadores (frontend, PostgREST, otros RPC) siguen funcionando.
--
--   · La guarda NO se aplica a funciones de autorización (can_/is_/has_) para no
--     romper identidad/permisos.
--   · Para `service_role` y llamadas internas (triggers) `auth.uid()` es NULL ⇒
--     current_user_must_change_password() = false ⇒ la guarda es no-op.
--
-- ALCANCE / LÍMITES (honestos)
--   · Se envuelven SOLO las funciones que cumplen un filtro de seguridad:
--     proretset=false, proargmodes IS NULL, pronargdefaults=0, provariadic=0.
--     Con los datos actuales: 77 de las 157 SECURITY DEFINER expuestas.
--   · Quedan PENDIENTES (no cubiertas por esta migración, requieren revisión de
--     contrato individual): funciones que devuelven SETOF/TABLE, con argumentos
--     OUT/INOUT, con DEFAULT o VARIADIC, y las de autorización (por diseño).
--     Ver informe 11 para el inventario y el plan por grupos.
--   · NO modifica datos, usuarios ni contraseñas.
--   · Idempotente: un registro (`password_gate_wrapped_functions`) evita envolver
--     dos veces. Reversible (ver reversión al final).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Guarda central.
--    Lanza 42501 (insufficient_privilege) si el usuario autenticado tiene un
--    cambio de contraseña pendiente. No expone información adicional.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_password_change_allowed()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF public.current_user_must_change_password() THEN
    RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'El usuario debe cambiar la contraseña inicial antes de usar esta operación.';
  END IF;
END;
$function$;

-- La guarda la necesitan los envoltorios (SECURITY DEFINER, se ejecutan como el
-- propietario). Se revoca de todos y NO se concede a `authenticated` por sí sola.
REVOKE ALL ON FUNCTION public.assert_password_change_allowed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_password_change_allowed() FROM anon;
REVOKE ALL ON FUNCTION public.assert_password_change_allowed() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_password_change_allowed() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Registro de envolturas (idempotencia + auditoría). No expuesto por API.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_gate_wrapped_functions (
  function_oid        oid        PRIMARY KEY,
  function_signature  text       NOT NULL,
  internal_signature  text       NOT NULL,
  wrapped_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.password_gate_wrapped_functions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_gate_wrapped_functions FROM PUBLIC;
REVOKE ALL ON TABLE public.password_gate_wrapped_functions FROM anon;
REVOKE ALL ON TABLE public.password_gate_wrapped_functions FROM authenticated;

-- ----------------------------------------------------------------------------
-- 3. Envoltura por lotes (filtro de seguridad + exclusión de autorización).
-- ----------------------------------------------------------------------------
DO $gate$
DECLARE
  rec            record;
  v_internal     text;
  v_call         text;
  v_body         text;
  v_wrapper_oid  oid;
BEGIN
  FOR rec IN
    SELECT p.oid,
           p.proname,
           p.pronargs,
           pg_get_function_identity_arguments(p.oid) AS ident_args,
           pg_get_function_arguments(p.oid)          AS args,
           pg_get_function_result(p.oid)             AS ret
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef = true
      AND p.prorettype <> 'trigger'::regtype
      AND p.proretset = false
      AND p.proargmodes IS NULL
      AND p.pronargdefaults = 0
      AND p.provariadic = 0
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname NOT LIKE 'can\_%'
      AND p.proname NOT LIKE 'is\_%'
      AND p.proname NOT LIKE 'has\_%'
      AND p.proname NOT IN (
        'assert_password_change_allowed',
        'current_user_must_change_password'
      )
      AND p.proname NOT LIKE '%\_\_pcgate\_%'
      AND NOT EXISTS (
        SELECT 1 FROM public.password_gate_wrapped_functions w
        WHERE w.function_oid = p.oid
      )
    ORDER BY p.oid
  LOOP
    v_internal := rec.proname || '__pcgate_' || rec.oid::text;

    -- Llamada posicional: todos los argumentos son IN (filtro proargmodes IS NULL).
    SELECT string_agg('$' || g, ', ') INTO v_call
    FROM generate_series(1, rec.pronargs) AS g;
    v_call := COALESCE(v_call, '');

    IF rec.ret = 'void' THEN
      v_body := format(
        'BEGIN PERFORM public.assert_password_change_allowed(); PERFORM public.%I(%s); END;',
        v_internal, v_call
      );
    ELSE
      v_body := format(
        'BEGIN PERFORM public.assert_password_change_allowed(); RETURN public.%I(%s); END;',
        v_internal, v_call
      );
    END IF;

    -- 1) El original pasa a ser el interno (conserva su cuerpo exacto).
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) RENAME TO %I',
      rec.proname, rec.ident_args, v_internal
    );

    -- 2) Se crea el envoltorio con la MISMA firma.
    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '''' AS %L',
      rec.proname, rec.args, rec.ret, v_body
    );

    -- 3) Privilegios: interno inaccesible directamente; envoltorio a authenticated.
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', v_internal, rec.ident_args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', v_internal, rec.ident_args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', v_internal, rec.ident_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_internal, rec.ident_args);

    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', rec.proname, rec.ident_args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', rec.proname, rec.ident_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', rec.proname, rec.ident_args);

    v_wrapper_oid := to_regprocedure(format('public.%I(%s)', rec.proname, rec.ident_args));

    INSERT INTO public.password_gate_wrapped_functions (
      function_oid, function_signature, internal_signature
    ) VALUES (
      v_wrapper_oid,
      format('public.%I(%s)', rec.proname, rec.args),
      format('public.%I(%s)', v_internal, rec.args)
    );
  END LOOP;
END
$gate$;

COMMIT;

-- ----------------------------------------------------------------------------
-- Reversión (si se aplicara) — deshace las envolturas registradas:
--   DO $$
--   DECLARE rec record; v_internal text;
--   BEGIN
--     FOR rec IN SELECT * FROM public.password_gate_wrapped_functions ORDER BY wrapped_at DESC LOOP
--       v_internal := split_part(rec.internal_signature, '(', 1);
--       EXECUTE format('DROP FUNCTION IF EXISTS %s', rec.function_signature);
--       EXECUTE format(
--         'ALTER FUNCTION %s RENAME TO %I',
--         rec.internal_signature,
--         split_part(split_part(v_internal, '.', 2), '(', 1)
--       );
--     END LOOP;
--   END $$;
--   DROP TABLE IF EXISTS public.password_gate_wrapped_functions;
--   DROP FUNCTION IF EXISTS public.assert_password_change_allowed();
-- ----------------------------------------------------------------------------
