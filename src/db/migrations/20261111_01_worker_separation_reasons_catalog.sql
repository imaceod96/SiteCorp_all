-- ============================================================================
-- SiteCorp · Actualización del catálogo de motivos de baja laboral
-- Archivo: 20261111_01_worker_separation_reasons_catalog.sql
--
-- OBJETIVO
--   1. Sustituir las opciones activas de `public.worker_separation_reasons` por
--      el catálogo oficial de 11 motivos de baja:
--        1. Salarial
--        2. Jubilación
--        3. Fallecimiento
--        4. Invalidez Total
--        5. Invalidez Parcial
--        6. Privación de Libertad
--        7. Paso a formas no estatales
--        8. Proceso de disponibilidad
--        9. Sanción Administrativa
--       10. Salida del País
--       11. Otras
--   2. Desactivar (`is_active = false`) los motivos anteriores que ya no forman
--      parte del listado activo, preservando intactas las referencias históricas
--      en `worker_employment_movements`.
--   3. Permitir registrar el texto específico (`p_custom_reason`) en
--      `public.register_worker_separation` cuando la opción seleccionada es
--      «Otras» (o cuando se envía el motivo nominal seleccionado).
-- ============================================================================

BEGIN;

-- 1. Asegurar columnas de orden y estado en `public.worker_separation_reasons`
ALTER TABLE public.worker_separation_reasons
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Sincronizar los 11 motivos de baja oficiales y desactivar el resto
DO $$
DECLARE
  v_item record;
  v_existing_id uuid;
  v_has_code boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'worker_separation_reasons'
      AND column_name = 'code'
  ) INTO v_has_code;

  -- Desactivar todos los motivos actuales antes de activar los 11 oficiales
  UPDATE public.worker_separation_reasons
  SET is_active = false;

  FOR v_item IN
    SELECT *
    FROM (
      VALUES
        (10,  'SALARIAL',                 'Salarial'),
        (20,  'JUBILACION',               'Jubilación'),
        (30,  'FALLECIMIENTO',            'Fallecimiento'),
        (40,  'INVALIDEZ_TOTAL',          'Invalidez Total'),
        (50,  'INVALIDEZ_PARCIAL',        'Invalidez Parcial'),
        (60,  'PRIVACION_LIBERTAD',       'Privación de Libertad'),
        (70,  'PASO_FORMAS_NO_ESTATALES', 'Paso a formas no estatales'),
        (80,  'PROCESO_DISPONIBILIDAD',   'Proceso de disponibilidad'),
        (90,  'SANCION_ADMINISTRATIVA',   'Sanción Administrativa'),
        (100, 'SALIDA_PAIS',              'Salida del País'),
        (110, 'OTRAS',                    'Otras')
    ) AS t(sort_order, code, name)
  LOOP
    SELECT id INTO v_existing_id
    FROM public.worker_separation_reasons
    WHERE lower(btrim(name)) = lower(btrim(v_item.name))
    ORDER BY is_active DESC, id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      IF v_has_code THEN
        EXECUTE
          'UPDATE public.worker_separation_reasons
              SET name = $1,
                  code = COALESCE(code, $2),
                  sort_order = $3,
                  is_active = true
            WHERE id = $4'
        USING v_item.name, v_item.code, v_item.sort_order, v_existing_id;
      ELSE
        UPDATE public.worker_separation_reasons
        SET name = v_item.name,
            sort_order = v_item.sort_order,
            is_active = true
        WHERE id = v_existing_id;
      END IF;
    ELSE
      IF v_has_code THEN
        EXECUTE
          'INSERT INTO public.worker_separation_reasons (code, name, sort_order, is_active)
           VALUES ($1, $2, $3, true)'
        USING v_item.code, v_item.name, v_item.sort_order;
      ELSE
        INSERT INTO public.worker_separation_reasons (name, sort_order, is_active)
        VALUES (v_item.name, v_item.sort_order, true);
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 3. Actualizar `public.register_worker_separation` con soporte para motivo personalizado («Otras»)
DROP FUNCTION IF EXISTS public.register_worker_separation(uuid, date, uuid, text);
DROP FUNCTION IF EXISTS public.register_worker_separation(uuid, date, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.register_worker_separation(uuid, date, uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.register_worker_separation(
  p_worker_id uuid,
  p_effective_date date,
  p_separation_reason_id uuid,
  p_notes text default null,
  p_target_assignment_id uuid default null,
  p_custom_reason text default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_reason public.worker_separation_reasons%rowtype;
  v_remaining integer;
  v_custom_reason text;
  v_effective_reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'La fecha efectiva de baja es obligatoria';
  END IF;

  IF p_separation_reason_id IS NULL THEN
    RAISE EXCEPTION 'El motivo de baja es obligatorio';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
  END IF;

  IF v_worker.employment_status <> 'active' THEN
    RAISE EXCEPTION 'El trabajador no está activo';
  END IF;

  SELECT * INTO v_reason FROM public.worker_separation_reasons
  WHERE id = p_separation_reason_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El motivo de baja seleccionado no es válido';
  END IF;

  v_custom_reason := nullif(btrim(coalesce(p_custom_reason, '')), '');

  IF lower(btrim(v_reason.name)) = 'otras' AND v_custom_reason IS NULL THEN
    RAISE EXCEPTION 'Debe especificar el motivo de baja cuando selecciona «Otras»';
  END IF;

  v_effective_reason := coalesce(v_custom_reason, v_reason.name);

  -- Asignación OBJETIVO (explícita o única vigente; si hay 2 sin identificar → error).
  SELECT * INTO v_current FROM public.worker_position_assignments
  WHERE id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  FOR UPDATE;

  IF p_effective_date < v_current.start_date THEN
    RAISE EXCEPTION 'La fecha de baja no puede ser anterior al inicio del puesto actual';
  END IF;

  -- Cerrar SÓLO la asignación objetivo.
  UPDATE public.worker_position_assignments
  SET end_date = p_effective_date,
      is_current = false,
      updated_at = now()
  WHERE id = v_current.id;

  -- Cerrar SÓLO los contratos vigentes de esa asignación.
  UPDATE public.employment_contracts
  SET is_current = false,
      actual_end_date = p_effective_date,
      updated_at = now()
  WHERE assignment_id = v_current.id AND is_current = true;

  -- El trabajador sigue activo mientras conserve OTRO contrato vigente.
  SELECT count(*) INTO v_remaining
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND a.is_current = true
    AND a.end_date IS NULL
    AND a.id <> v_current.id;

  IF v_remaining = 0 THEN
    UPDATE public.workers
    SET employment_status = 'inactive', updated_at = now()
    WHERE id = p_worker_id;
  END IF;

  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, separation_reason_id, created_by
  ) VALUES (
    p_worker_id, 'BAJA', v_current.id, null,
    p_effective_date, v_effective_reason,
    nullif(btrim(coalesce(p_notes, '')), ''), v_reason.id, auth.uid()
  );

  -- Movimiento de Nómina: BAJA de ESTE contrato.
  PERFORM public.create_payroll_movement(
    p_worker_id, 'BAJA', p_effective_date,
    v_current.position_id, null, v_current.id, v_current.id
  );

  RETURN jsonb_build_object(
    'assignment_id', v_current.id,
    'effective_date', p_effective_date,
    'separation_reason_id', v_reason.id,
    'reason', v_effective_reason,
    'remaining_active_assignments', v_remaining
  );
END $$;

REVOKE ALL ON FUNCTION public.register_worker_separation(uuid, date, uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_worker_separation(uuid, date, uuid, text, uuid, text) TO authenticated;

COMMIT;
