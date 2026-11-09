-- ============================================================================
-- SiteCorp · Módulo de Altas y Bajas (Registro Histórico de Períodos Laborales)
-- MIGRACIÓN MÍNIMA: PROCEDENCIA ADMINISTRATIVA EDITABLE
-- (20261110_03_employment_registry_origin_source.sql)
--
-- PREPARADA, NO EJECUTADA. Requiere autorización expresa antes de aplicarse.
--
-- Objetivo:
--   1. Añadir la columna `source_origin text NULL` en `public.worker_employment_periods`
--      para almacenar la procedencia administrativa real del trabajador en cada período,
--      manteniendo intacto e independiente `origin_type` ('INITIAL_HIRE', 'MIGRATION',
--      'REINCORPORATION', 'BACKFILL') y `period_sequence`.
--   2. Crear la RPC protegida `public.update_worker_employment_period_source_origin`
--      que exige usuario autenticado y permiso `workers.manage` sobre la entidad.
--   3. No modifica fechas, estados, movimientos laborales, contratos, autenticación
--      ni políticas RLS existentes.
-- ============================================================================

BEGIN;

-- 1. Columna para la procedencia administrativa editable del período laboral
ALTER TABLE public.worker_employment_periods
  ADD COLUMN IF NOT EXISTS source_origin text NULL;

-- 2. RPC protegida para editar la Procedencia administrativa (source_origin)
--    Conserva intacto origin_type (tipo de período calculado automáticamente).
CREATE OR REPLACE FUNCTION public.update_worker_employment_period_source_origin(
  p_period_id uuid,
  p_source_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_period public.worker_employment_periods%ROWTYPE;
  v_clean text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_user_must_change_password'
  ) THEN
    IF public.current_user_must_change_password() THEN
      RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_period
  FROM public.worker_employment_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Período laboral no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_period.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para modificar el registro de altas y bajas en esta entidad';
  END IF;

  v_clean := nullif(btrim(coalesce(p_source_origin, '')), '');

  UPDATE public.worker_employment_periods
  SET
    source_origin = v_clean,
    updated_at = now()
  WHERE id = p_period_id
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'id', v_period.id,
    'worker_id', v_period.worker_id,
    'period_sequence', v_period.period_sequence,
    'origin_type', v_period.origin_type,
    'source_origin', v_period.source_origin,
    'updated_at', v_period.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_worker_employment_period_source_origin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_worker_employment_period_source_origin(uuid, text) TO authenticated, service_role;

COMMIT;
