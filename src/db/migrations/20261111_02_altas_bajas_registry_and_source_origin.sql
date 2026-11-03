-- ============================================================================
-- SiteCorp · Registro de Altas y Bajas + Fuente de Procedencia + 11 Motivos Oficiales
-- Archivo: 20261111_02_altas_bajas_registry_and_source_origin.sql
--
-- OBJETIVO
--   1. Garantizar que `public.worker_separation_reasons` contenga como únicos
--      motivos activos los 11 motivos oficiales del modelo «b) Registro de Altas y Bajas»
--      (columnas 7 a 17):
--        7.  Salarial
--        8.  Jubilación
--        9.  Fallecimiento
--       10.  Invalidez Total
--       11.  Invalidez Parcial
--       12.  Privación de Libertad
--       13.  Paso a formas no estatales
--       14.  Proceso de disponibilidad
--       15.  Sanción Administrativa
--       16.  Salida del País
--       17.  Otras
--   2. Añadir la columna `source_of_origin` (Fuente de procedencia - Columna 5)
--      en `public.worker_position_assignments` y `public.worker_employment_movements`.
--   3. Proveer la función RPC `public.save_worker_source_of_origin` para registrar
--      la fuente de procedencia al contratar o reincorporar a un trabajador.
-- ============================================================================

BEGIN;

-- 1. Asegurar columnas de orden y estado en `public.worker_separation_reasons`
ALTER TABLE public.worker_separation_reasons
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Sincronizar los 11 motivos oficiales de baja y desactivar los anteriores
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

-- 3. Añadir columnas `source_of_origin` (Columna 5) y `alta_number` (Columna 4: No. de alta)
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS source_of_origin text,
  ADD COLUMN IF NOT EXISTS alta_number text;

ALTER TABLE public.worker_position_assignments
  ADD COLUMN IF NOT EXISTS source_of_origin text,
  ADD COLUMN IF NOT EXISTS alta_number text;

ALTER TABLE public.worker_employment_movements
  ADD COLUMN IF NOT EXISTS source_of_origin text,
  ADD COLUMN IF NOT EXISTS alta_number text;

-- 4. RPC auxiliar para guardar la Fuente de procedencia en el alta, migración inicial o reingreso
CREATE OR REPLACE FUNCTION public.save_worker_source_of_origin(
  p_worker_id uuid,
  p_effective_date date default null,
  p_source_of_origin text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_worker public.workers%rowtype;
  v_assignment_id uuid;
  v_clean_source text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_clean_source := nullif(btrim(coalesce(p_source_of_origin, '')), '');
  IF v_clean_source IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
  END IF;

  -- Actualizar también en la fila del trabajador (útil para trabajadores de migración inicial sin puesto aún)
  UPDATE public.workers
  SET source_of_origin = v_clean_source,
      updated_at = now()
  WHERE id = p_worker_id;

  -- Actualizar la asignación vigente (o la que coincide con la fecha efectiva de alta/reingreso)
  SELECT a.id INTO v_assignment_id
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND (p_effective_date IS NULL OR a.start_date = p_effective_date OR a.is_current = true)
  ORDER BY
    CASE WHEN p_effective_date IS NOT NULL AND a.start_date = p_effective_date THEN 0 ELSE 1 END,
    a.is_current DESC,
    a.start_date DESC,
    a.created_at DESC
  LIMIT 1;

  IF v_assignment_id IS NOT NULL THEN
    UPDATE public.worker_position_assignments
    SET source_of_origin = v_clean_source,
        updated_at = now()
    WHERE id = v_assignment_id;
  END IF;

  -- Actualizar también el movimiento de ALTA o REINGRESO correspondiente si existe
  UPDATE public.worker_employment_movements
  SET source_of_origin = v_clean_source
  WHERE worker_id = p_worker_id
    AND movement_type IN ('ALTA', 'REINGRESO', 'REINCORPORACION')
    AND (p_effective_date IS NULL OR effective_date = p_effective_date);
END;
$$;

REVOKE ALL ON FUNCTION public.save_worker_source_of_origin(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_worker_source_of_origin(uuid, date, text) TO authenticated;

-- 5. RPC auxiliar para guardar o editar el Número de alta (Columna 4: Fecha y No. de alta)
CREATE OR REPLACE FUNCTION public.save_worker_alta_number(
  p_worker_id uuid,
  p_effective_date date default null,
  p_alta_number text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_worker public.workers%rowtype;
  v_assignment_id uuid;
  v_clean_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_clean_number := nullif(btrim(coalesce(p_alta_number, '')), '');

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
  END IF;

  -- Actualizar en la tabla `workers` si corresponde al alta inicial / migración inicial
  IF p_effective_date IS NULL
     OR p_effective_date = coalesce(v_worker.employment_start_date, v_worker.hire_date)
     OR v_worker.origin = 'MIGRATION' THEN
    UPDATE public.workers
    SET alta_number = v_clean_number,
        updated_at = now()
    WHERE id = p_worker_id;
  END IF;

  -- Actualizar la asignación del período correspondiente si existe
  SELECT a.id INTO v_assignment_id
  FROM public.worker_position_assignments a
  WHERE a.worker_id = p_worker_id
    AND (p_effective_date IS NULL OR a.start_date = p_effective_date OR a.is_current = true)
  ORDER BY
    CASE WHEN p_effective_date IS NOT NULL AND a.start_date = p_effective_date THEN 0 ELSE 1 END,
    a.start_date ASC,
    a.created_at ASC
  LIMIT 1;

  IF v_assignment_id IS NOT NULL THEN
    UPDATE public.worker_position_assignments
    SET alta_number = v_clean_number,
        updated_at = now()
    WHERE id = v_assignment_id;
  END IF;

  -- Actualizar también en movimientos de ALTA / REINGRESO si existe
  UPDATE public.worker_employment_movements
  SET alta_number = v_clean_number
  WHERE worker_id = p_worker_id
    AND movement_type IN ('ALTA', 'REINGRESO', 'REINCORPORACION')
    AND (p_effective_date IS NULL OR effective_date = p_effective_date);
END;
$$;

REVOKE ALL ON FUNCTION public.save_worker_alta_number(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_worker_alta_number(uuid, date, text) TO authenticated;

COMMIT;
