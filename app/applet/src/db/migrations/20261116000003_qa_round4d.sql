-- =============================================================================
-- MIGRACIÓN: 20261116000003_qa_round4d.sql
-- Correcciones QA:
--   1. Añadir columna `certificate_number` a `public.worker_medical_certificates` para
--      garantizar que la generación de documentos (SC-4-04) no falle.
--   2. Actualizar `public.resolve_vacation_assignment` para admitir asignaciones vigentes
--      con `end_date >= cuba_current_date()` o asignaciones activas actuales.
-- =============================================================================

BEGIN;

-- 1. Columna certificate_number en worker_medical_certificates
ALTER TABLE public.worker_medical_certificates
  ADD COLUMN IF NOT EXISTS certificate_number text;

-- 2. Mejorar resolve_vacation_assignment para no fallar en asignaciones vigentes con end_date futuro
CREATE OR REPLACE FUNCTION public.resolve_vacation_assignment(
  p_worker_id uuid,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_today date := public.cuba_current_date();
  v_count integer;
  v_target uuid;
BEGIN
  IF p_assignment_id IS NOT NULL THEN
    SELECT a.id INTO v_target
    FROM public.worker_position_assignments a
    WHERE a.id = p_assignment_id
      AND a.worker_id = p_worker_id
      AND (
        a.is_current = true
        OR (a.start_date <= v_today AND (a.end_date IS NULL OR a.end_date >= v_today))
      );
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    END IF;
    RETURN v_target;
  END IF;

  -- Sin assignment_id explícito: buscar asignación actual vigente
  SELECT count(*) INTO v_count
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND (a.end_date IS NULL OR a.end_date >= v_today);

  IF v_count = 0 THEN
    SELECT count(*) INTO v_count
    FROM public.worker_position_assignments a
    WHERE a.worker_id = p_worker_id
      AND a.start_date <= v_today
      AND (a.end_date IS NULL OR a.end_date >= v_today);
    IF v_count = 0 THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_count > 1 THEN
    SELECT a.id INTO v_target
    FROM public.worker_position_assignments a
    WHERE a.worker_id = p_worker_id
      AND a.is_current = true
      AND (a.end_date IS NULL OR a.end_date >= v_today)
    ORDER BY a.start_date DESC LIMIT 1;
    IF v_target IS NOT NULL THEN
      RETURN v_target;
    END IF;
    RAISE EXCEPTION 'El trabajador tiene % contratos activos: identifique el contrato para operar las vacaciones', v_count;
  END IF;

  SELECT a.id INTO v_target
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND (a.is_current = true OR a.start_date <= v_today)
    AND (a.end_date IS NULL OR a.end_date >= v_today)
  ORDER BY a.start_date DESC LIMIT 1;

  RETURN v_target;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_vacation_assignment(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_vacation_assignment(uuid, uuid) FROM public, anon;

COMMIT;
