-- ============================================================================
-- SiteCorp · Módulo de Altas y Bajas (Registro Histórico de Períodos Laborales)
-- SCRIPT DE REVERSIÓN (ROLLBACK) — 20261110_90_employment_registry_rollback.sql
--
-- Revierte limpiamente los objetos creados en 20261110_01 y 20261110_02 sin
-- afectar tablas operativas, funciones existentes ni autenticación.
-- ============================================================================

BEGIN;

-- 1. Eliminar triggers nuevos sobre tablas operativas
DROP TRIGGER IF EXISTS trg_sync_employment_period_on_movement ON public.worker_employment_movements;
DROP TRIGGER IF EXISTS trg_validate_movement_separation_other_reason ON public.worker_employment_movements;
DROP TRIGGER IF EXISTS trg_refresh_period_snapshot_on_assignment ON public.worker_position_assignments;
DROP TRIGGER IF EXISTS trg_sync_initial_employment_period_from_worker ON public.workers;

-- 2. Eliminar funciones de reconciliación y RPCs del módulo Altas y Bajas
DROP FUNCTION IF EXISTS public.update_worker_employment_period_source_origin(uuid, text);
DROP FUNCTION IF EXISTS public.validate_worker_employment_period_separation_reason(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.reconcile_all_employment_periods();
DROP FUNCTION IF EXISTS public.sync_entity_employment_periods(uuid);
DROP FUNCTION IF EXISTS public.sync_worker_employment_periods(uuid);
DROP FUNCTION IF EXISTS public.update_worker_employment_period_separation_number(uuid, text);
DROP FUNCTION IF EXISTS public.update_worker_employment_period_hire_number(uuid, text);

-- 3. Eliminar funciones de triggers y helpers del módulo Altas y Bajas
DROP FUNCTION IF EXISTS public.trg_fn_sync_employment_period_on_movement();
DROP FUNCTION IF EXISTS public.trg_fn_refresh_period_snapshot_on_assignment();
DROP FUNCTION IF EXISTS public.trg_fn_sync_initial_employment_period_from_worker();
DROP FUNCTION IF EXISTS public.get_worker_assignment_snapshot(uuid, uuid);
DROP FUNCTION IF EXISTS public.trg_fn_validate_movement_separation_other_reason();

-- 4. Eliminar tabla worker_employment_periods
DROP TABLE IF EXISTS public.worker_employment_periods;

-- 5. Eliminar columnas adicionales en worker_employment_movements
ALTER TABLE public.worker_employment_movements
  DROP COLUMN IF EXISTS separation_number,
  DROP COLUMN IF EXISTS separation_other_reason;

-- 6. Eliminar únicamente los 8 motivos añadidos si no están referenciados en movimientos
DELETE FROM public.worker_separation_reasons r
WHERE r.code IN (
  'SALARIAL',
  'INVALIDEZ_TOTAL',
  'INVALIDEZ_PARCIAL',
  'PRIVACION_LIBERTAD',
  'PASO_FORMAS_NO_ESTATALES',
  'PROCESO_DISPONIBILIDAD',
  'SANCION_ADMINISTRATIVA',
  'SALIDA_PAIS'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.worker_employment_movements m
  WHERE m.separation_reason_id = r.id
);

COMMIT;
