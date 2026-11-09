-- ============================================================================
-- SiteCorp · Módulo de Altas y Bajas (Registro Histórico de Períodos Laborales)
-- SCRIPT 1: MIGRACIÓN ESTRUCTURAL (20261110_01_employment_registry_schema.sql)
--
-- IMPORTANTE:
--   1. NO modifica ni toca auth.uid(), auth.jwt(), auth.role(),
--      is_platform_superadmin(), is_platform_user_active() ni can_access_entity().
--   2. NO elimina ni reemplaza register_worker_separation, reincorporate_worker,
--      hire_candidate ni create_worker_with_position.
--   3. Conserva intactas las 7 filas existentes de public.worker_separation_reasons
--      (Opción 1A) y añade las 8 causas oficiales faltantes del Registro de Altas y Bajas.
--   4. NO ejecuta ningún backfill ni reconstrucción histórica automática.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Ampliación no destructiva de public.worker_separation_reasons (Opción 1A)
--    Conserva intactos los 7 motivos actuales y añade las 8 causas oficiales faltantes.
-- ----------------------------------------------------------------------------
INSERT INTO public.worker_separation_reasons (code, name, is_active, sort_order)
SELECT v.code, v.name, true, v.sort_order
FROM (
  VALUES
    ('SALARIAL',                 'Salarial',                  80),
    ('INVALIDEZ_TOTAL',          'Invalidez total',           90),
    ('INVALIDEZ_PARCIAL',        'Invalidez parcial',        100),
    ('PRIVACION_LIBERTAD',       'Privación de libertad',    110),
    ('PASO_FORMAS_NO_ESTATALES', 'Paso a formas no estatales', 120),
    ('PROCESO_DISPONIBILIDAD',   'Proceso de disponibilidad', 130),
    ('SANCION_ADMINISTRATIVA',   'Sanción administrativa',   140),
    ('SALIDA_PAIS',              'Salida del país',          150)
) AS v(code, name, sort_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.worker_separation_reasons r
  WHERE r.code = v.code
     OR lower(btrim(r.name)) = lower(btrim(v.name))
);

-- ----------------------------------------------------------------------------
-- 2. Columnas complementarias en public.worker_employment_movements
-- ----------------------------------------------------------------------------
ALTER TABLE public.worker_employment_movements
  ADD COLUMN IF NOT EXISTS separation_number text NULL,
  ADD COLUMN IF NOT EXISTS separation_other_reason text NULL;

-- ----------------------------------------------------------------------------
-- 3. Trigger de validación y compatibilidad para el motivo "Otro" en movimientos BAJA
--    Compatible con register_worker_separation (que envía el detalle en notes).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_validate_movement_separation_other_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_reason_code text;
  v_reason_name text;
  v_effective_other text;
BEGIN
  IF NEW.movement_type = 'BAJA' AND NEW.separation_reason_id IS NOT NULL THEN
    SELECT r.code, r.name
      INTO v_reason_code, v_reason_name
    FROM public.worker_separation_reasons r
    WHERE r.id = NEW.separation_reason_id;

    IF v_reason_code = 'OTRO' OR lower(btrim(coalesce(v_reason_name, ''))) = 'otro' THEN
      v_effective_other := coalesce(
        nullif(btrim(coalesce(NEW.separation_other_reason, '')), ''),
        nullif(btrim(coalesce(NEW.notes, '')), '')
      );

      IF v_effective_other IS NULL THEN
        RAISE EXCEPTION 'Debe especificar el motivo de baja cuando selecciona la causa "Otro".';
      END IF;

      NEW.separation_other_reason := v_effective_other;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_fn_validate_movement_separation_other_reason() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_movement_separation_other_reason ON public.worker_employment_movements;
CREATE TRIGGER trg_validate_movement_separation_other_reason
  BEFORE INSERT OR UPDATE ON public.worker_employment_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_validate_movement_separation_other_reason();

-- ----------------------------------------------------------------------------
-- 4. Tabla principal: public.worker_employment_periods
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_employment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_client_id uuid NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
  organization_entity_id uuid NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  period_sequence integer NOT NULL CHECK (period_sequence >= 1),
  origin_type text NOT NULL CHECK (origin_type IN ('INITIAL_HIRE', 'MIGRATION', 'REINCORPORATION', 'BACKFILL')),
  reincorporation_movement_id uuid NULL REFERENCES public.worker_employment_movements(id) ON DELETE SET NULL,
  hire_date date NOT NULL,
  hire_number text NULL,
  position_name_snapshot text NULL,
  area_name_snapshot text NULL,
  occupational_category_snapshot text NULL,
  separation_movement_id uuid NULL REFERENCES public.worker_employment_movements(id) ON DELETE SET NULL,
  separation_date date NULL,
  separation_number text NULL,
  separation_reason_id uuid NULL REFERENCES public.worker_separation_reasons(id) ON DELETE SET NULL,
  separation_reason_catalog_snapshot text NULL,
  separation_reason_movement_snapshot text NULL,
  separation_other_reason text NULL,
  separation_notes text NULL,
  reason_validation_status text NULL CHECK (
    reason_validation_status IS NULL
    OR reason_validation_status IN ('AUTO_MATCHED', 'PENDING_VALIDATION', 'VERIFIED')
  ),
  inconsistency_code text NULL,
  inconsistency_details text NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_wep_worker_sequence UNIQUE (worker_id, period_sequence),
  CONSTRAINT chk_wep_dates_consistency CHECK (
    separation_date IS NULL OR separation_date >= hire_date
  ),
  CONSTRAINT chk_wep_status_consistency CHECK (
    (
      status = 'ACTIVE'
      AND separation_date IS NULL
      AND separation_movement_id IS NULL
      AND separation_reason_id IS NULL
      AND separation_number IS NULL
      AND separation_other_reason IS NULL
    )
    OR
    (
      status = 'CLOSED'
      AND separation_date IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_wep_entity_hire_date
  ON public.worker_employment_periods (organization_entity_id, hire_date DESC, period_sequence DESC);

CREATE INDEX IF NOT EXISTS idx_wep_entity_separation_date
  ON public.worker_employment_periods (organization_entity_id, separation_date DESC)
  WHERE separation_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wep_worker_id
  ON public.worker_employment_periods (worker_id, period_sequence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wep_one_active_per_worker
  ON public.worker_employment_periods (worker_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_wep_unique_reincorporation_movement
  ON public.worker_employment_periods (reincorporation_movement_id)
  WHERE reincorporation_movement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wep_unique_separation_movement
  ON public.worker_employment_periods (separation_movement_id)
  WHERE separation_movement_id IS NOT NULL;

DROP TRIGGER IF EXISTS worker_employment_periods_updated_at ON public.worker_employment_periods;
CREATE TRIGGER worker_employment_periods_updated_at
  BEFORE UPDATE ON public.worker_employment_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Seguridad RLS y Privilegios sobre public.worker_employment_periods
--    Solo lectura directa para authenticated; mutaciones exclusivamente por
--    triggers internos o RPCs con validación de permisos.
-- ----------------------------------------------------------------------------
ALTER TABLE public.worker_employment_periods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.worker_employment_periods FROM PUBLIC;
REVOKE ALL ON TABLE public.worker_employment_periods FROM anon;
REVOKE ALL ON TABLE public.worker_employment_periods FROM authenticated;
GRANT SELECT ON TABLE public.worker_employment_periods TO authenticated;
GRANT ALL ON TABLE public.worker_employment_periods TO service_role;

DROP POLICY IF EXISTS wep_select_policy ON public.worker_employment_periods;
CREATE POLICY wep_select_policy
  ON public.worker_employment_periods
  FOR SELECT
  TO authenticated
  USING (
    public.can_access_entity(organization_entity_id, 'workers.view')
    OR public.can_access_entity(organization_entity_id, 'workers.manage')
  );

DO $gate$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'current_user_must_change_password'
  ) THEN
    DROP POLICY IF EXISTS password_change_gate ON public.worker_employment_periods;
    CREATE POLICY password_change_gate
      ON public.worker_employment_periods
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (NOT public.current_user_must_change_password())
      WITH CHECK (NOT public.current_user_must_change_password());
  END IF;
END
$gate$;

-- ----------------------------------------------------------------------------
-- 6. Helper interno para obtener instantánea de cargo, área y categoría ocupacional
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_worker_assignment_snapshot(
  p_worker_id uuid,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS TABLE (
  position_name text,
  area_name text,
  occupational_category_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    j.name AS position_name,
    a.name AS area_name,
    oc.name AS occupational_category_name
  FROM public.worker_position_assignments wpa
  JOIN public.organization_positions p ON p.id = wpa.position_id
  LEFT JOIN public.organization_jobs j ON j.id = p.job_id
  LEFT JOIN public.organization_areas a ON a.id = j.area_id
  LEFT JOIN public.occupational_categories oc ON oc.id = j.occupational_category_id
  WHERE wpa.worker_id = p_worker_id
    AND (p_assignment_id IS NULL OR wpa.id = p_assignment_id)
  ORDER BY
    CASE WHEN p_assignment_id IS NOT NULL AND wpa.id = p_assignment_id THEN 0 ELSE 1 END,
    wpa.is_current DESC,
    wpa.start_date DESC,
    wpa.created_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_worker_assignment_snapshot(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Trigger en public.workers: creación automática del período inicial (seq = 1)
--    Cubre contratación desde candidato, alta directa, carga inicial por migración
--    y flujos donde la fecha de alta se complete posteriormente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_sync_initial_employment_period_from_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_effective_hire_date date;
  v_origin_type text;
  v_pos text;
  v_area text;
  v_cat text;
BEGIN
  v_effective_hire_date := coalesce(NEW.employment_start_date, NEW.hire_date);
  IF v_effective_hire_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_origin_type := CASE
    WHEN NEW.origin = 'MIGRATION' THEN 'MIGRATION'
    ELSE 'INITIAL_HIRE'
  END;

  SELECT s.position_name, s.area_name, s.occupational_category_name
    INTO v_pos, v_area, v_cat
  FROM public.get_worker_assignment_snapshot(NEW.id, NULL) s;

  IF NOT EXISTS (
    SELECT 1
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.id
      AND wep.period_sequence = 1
  ) THEN
    INSERT INTO public.worker_employment_periods (
      company_client_id,
      organization_entity_id,
      worker_id,
      period_sequence,
      origin_type,
      hire_date,
      position_name_snapshot,
      area_name_snapshot,
      occupational_category_snapshot,
      status
    ) VALUES (
      NEW.company_client_id,
      NEW.organization_entity_id,
      NEW.id,
      1,
      v_origin_type,
      v_effective_hire_date,
      v_pos,
      v_area,
      v_cat,
      'ACTIVE'
    );
  ELSE
    -- Si el período 1 existe y no tiene baja anterior a la nueva fecha, sincroniza metadatos e instantánea si faltaban
    UPDATE public.worker_employment_periods wep
    SET
      hire_date = CASE
        WHEN wep.separation_date IS NULL OR wep.separation_date >= v_effective_hire_date
          THEN v_effective_hire_date
        ELSE wep.hire_date
      END,
      position_name_snapshot = coalesce(wep.position_name_snapshot, v_pos),
      area_name_snapshot = coalesce(wep.area_name_snapshot, v_area),
      occupational_category_snapshot = coalesce(wep.occupational_category_snapshot, v_cat),
      updated_at = now()
    WHERE wep.worker_id = NEW.id
      AND wep.period_sequence = 1;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_fn_sync_initial_employment_period_from_worker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_initial_employment_period_from_worker ON public.workers;
CREATE TRIGGER trg_sync_initial_employment_period_from_worker
  AFTER INSERT OR UPDATE OF hire_date, employment_start_date, origin ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_sync_initial_employment_period_from_worker();

-- ----------------------------------------------------------------------------
-- 8. Trigger en public.worker_position_assignments: completa snapshot del período activo
--    cuando el assignment inicial se inserta después del INSERT en public.workers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_refresh_period_snapshot_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_pos text;
  v_area text;
  v_cat text;
BEGIN
  SELECT s.position_name, s.area_name, s.occupational_category_name
    INTO v_pos, v_area, v_cat
  FROM public.get_worker_assignment_snapshot(NEW.worker_id, NEW.id) s;

  UPDATE public.worker_employment_periods wep
  SET
    position_name_snapshot = coalesce(v_pos, wep.position_name_snapshot),
    area_name_snapshot = coalesce(v_area, wep.area_name_snapshot),
    occupational_category_snapshot = coalesce(v_cat, wep.occupational_category_snapshot),
    updated_at = now()
  WHERE wep.worker_id = NEW.worker_id
    AND wep.status = 'ACTIVE'
    AND (
      wep.position_name_snapshot IS NULL
      OR wep.area_name_snapshot IS NULL
      OR wep.occupational_category_snapshot IS NULL
    );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_fn_refresh_period_snapshot_on_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refresh_period_snapshot_on_assignment ON public.worker_position_assignments;
CREATE TRIGGER trg_refresh_period_snapshot_on_assignment
  AFTER INSERT ON public.worker_position_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_refresh_period_snapshot_on_assignment();

-- ----------------------------------------------------------------------------
-- 9. Trigger en public.worker_employment_movements:
--    Sincroniza BAJA definitiva (ignorando bajas parciales de pluriempleo)
--    y REINCORPORACION (creando un nuevo período vinculado a reincorporation_movement_id).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_sync_employment_period_on_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_active_period public.worker_employment_periods%ROWTYPE;
  v_remaining_assignments integer;
  v_reason_name text;
  v_reason_code text;
  v_validation_status text;
  v_other_reason text;
  v_next_seq integer;
  v_pos text;
  v_area text;
  v_cat text;
  v_prior_baja record;
  v_last_closed_assignment_end date;
BEGIN
  SELECT * INTO v_worker
  FROM public.workers
  WHERE id = NEW.worker_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Asegurar que exista al menos el período inicial (seq = 1)
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_employment_periods WHERE worker_id = NEW.worker_id
  ) THEN
    SELECT s.position_name, s.area_name, s.occupational_category_name
      INTO v_pos, v_area, v_cat
    FROM public.get_worker_assignment_snapshot(NEW.worker_id, coalesce(NEW.previous_assignment_id, NEW.new_assignment_id)) s;

    INSERT INTO public.worker_employment_periods (
      company_client_id,
      organization_entity_id,
      worker_id,
      period_sequence,
      origin_type,
      hire_date,
      position_name_snapshot,
      area_name_snapshot,
      occupational_category_snapshot,
      status
    ) VALUES (
      v_worker.company_client_id,
      v_worker.organization_entity_id,
      v_worker.id,
      1,
      CASE WHEN v_worker.origin = 'MIGRATION' THEN 'MIGRATION' ELSE 'INITIAL_HIRE' END,
      coalesce(v_worker.employment_start_date, v_worker.hire_date, NEW.effective_date),
      v_pos,
      v_area,
      v_cat,
      'ACTIVE'
    );
  END IF;

  -- ==========================================================================
  -- CASO A: Movimiento de BAJA
  -- ==========================================================================
  IF NEW.movement_type = 'BAJA' THEN
    -- Comprobar cuántos puestos activos restantes tiene el trabajador en la entidad
    -- (independientemente del orden en que se actualice workers.employment_status).
    SELECT count(*)
      INTO v_remaining_assignments
    FROM public.worker_position_assignments a
    WHERE a.worker_id = NEW.worker_id
      AND a.is_current = true
      AND a.end_date IS NULL
      AND (NEW.previous_assignment_id IS NULL OR a.id <> NEW.previous_assignment_id);

    -- Si aún conserva otra plaza activa (baja parcial en pluriempleo), NO cierra el período laboral
    IF v_remaining_assignments > 0 AND v_worker.employment_status = 'active' THEN
      RETURN NEW;
    END IF;

    SELECT *
      INTO v_active_period
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.worker_id
      AND wep.status = 'ACTIVE'
    ORDER BY wep.period_sequence DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    IF NEW.separation_reason_id IS NOT NULL THEN
      SELECT r.name, r.code
        INTO v_reason_name, v_reason_code
      FROM public.worker_separation_reasons r
      WHERE r.id = NEW.separation_reason_id;
    END IF;

    v_other_reason := CASE
      WHEN v_reason_code = 'OTRO' OR lower(btrim(coalesce(v_reason_name, ''))) = 'otro'
        THEN coalesce(
          nullif(btrim(coalesce(NEW.separation_other_reason, '')), ''),
          nullif(btrim(coalesce(NEW.notes, '')), '')
        )
      ELSE nullif(btrim(coalesce(NEW.separation_other_reason, '')), '')
    END;

    v_validation_status := CASE
      WHEN NEW.separation_reason_id IS NULL THEN 'PENDING_VALIDATION'
      WHEN v_reason_name IS NOT NULL
           AND NEW.reason IS NOT NULL
           AND lower(btrim(v_reason_name)) = lower(btrim(NEW.reason))
        THEN 'AUTO_MATCHED'
      ELSE 'PENDING_VALIDATION'
    END;

    SELECT s.position_name, s.area_name, s.occupational_category_name
      INTO v_pos, v_area, v_cat
    FROM public.get_worker_assignment_snapshot(NEW.worker_id, NEW.previous_assignment_id) s;

    UPDATE public.worker_employment_periods wep
    SET
      separation_movement_id = NEW.id,
      separation_date = greatest(NEW.effective_date, wep.hire_date),
      separation_number = nullif(btrim(coalesce(NEW.separation_number, '')), ''),
      separation_reason_id = NEW.separation_reason_id,
      separation_reason_catalog_snapshot = v_reason_name,
      separation_reason_movement_snapshot = NEW.reason,
      separation_other_reason = v_other_reason,
      separation_notes = NEW.notes,
      reason_validation_status = v_validation_status,
      inconsistency_code = CASE
        WHEN NEW.effective_date < wep.hire_date THEN 'SEPARATION_BEFORE_HIRE_ADJUSTED'
        WHEN v_validation_status = 'PENDING_VALIDATION' THEN 'REASON_TEXT_MISMATCH'
        ELSE wep.inconsistency_code
      END,
      inconsistency_details = CASE
        WHEN NEW.effective_date < wep.hire_date
          THEN format('La fecha del movimiento de baja (%s) era anterior al alta (%s).', NEW.effective_date, wep.hire_date)
        WHEN v_validation_status = 'PENDING_VALIDATION'
          THEN format('Motivo catálogo: "%s" vs texto movimiento: "%s".', coalesce(v_reason_name, 'N/A'), coalesce(NEW.reason, 'N/A'))
        ELSE wep.inconsistency_details
      END,
      position_name_snapshot = coalesce(wep.position_name_snapshot, v_pos),
      area_name_snapshot = coalesce(wep.area_name_snapshot, v_area),
      occupational_category_snapshot = coalesce(wep.occupational_category_snapshot, v_cat),
      status = 'CLOSED',
      updated_at = now()
    WHERE wep.id = v_active_period.id;

    RETURN NEW;
  END IF;

  -- ==========================================================================
  -- CASO B: Movimiento de REINCORPORACION
  -- ==========================================================================
  IF NEW.movement_type = 'REINCORPORACION' THEN
    -- Idempotencia: si ya existe un período asociado a este movimiento de reincorporación, actualizarlo
    IF EXISTS (
      SELECT 1
      FROM public.worker_employment_periods wep
      WHERE wep.reincorporation_movement_id = NEW.id
    ) THEN
      RETURN NEW;
    END IF;

    -- Verificar si quedó un período previo ACTIVE sin cerrar (por ejemplo, datos previos no sincronizados)
    SELECT *
      INTO v_active_period
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.worker_id
      AND wep.status = 'ACTIVE'
    ORDER BY wep.period_sequence DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      -- Buscar si existe un movimiento de BAJA no vinculado aún para cerrar el período previo
      SELECT m.*, r.name AS catalog_name, r.code AS catalog_code
        INTO v_prior_baja
      FROM public.worker_employment_movements m
      LEFT JOIN public.worker_separation_reasons r ON r.id = m.separation_reason_id
      WHERE m.worker_id = NEW.worker_id
        AND m.movement_type = 'BAJA'
        AND m.effective_date >= v_active_period.hire_date
        AND m.effective_date <= NEW.effective_date
        AND NOT EXISTS (
          SELECT 1
          FROM public.worker_employment_periods p2
          WHERE p2.separation_movement_id = m.id
        )
      ORDER BY m.effective_date DESC, m.created_at DESC
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.worker_employment_periods wep
        SET
          separation_movement_id = v_prior_baja.id,
          separation_date = greatest(v_prior_baja.effective_date, wep.hire_date),
          separation_number = nullif(btrim(coalesce(v_prior_baja.separation_number, '')), ''),
          separation_reason_id = v_prior_baja.separation_reason_id,
          separation_reason_catalog_snapshot = v_prior_baja.catalog_name,
          separation_reason_movement_snapshot = v_prior_baja.reason,
          separation_other_reason = CASE
            WHEN v_prior_baja.catalog_code = 'OTRO' OR lower(btrim(coalesce(v_prior_baja.catalog_name, ''))) = 'otro'
              THEN coalesce(nullif(btrim(coalesce(v_prior_baja.separation_other_reason, '')), ''), nullif(btrim(coalesce(v_prior_baja.notes, '')), ''))
            ELSE nullif(btrim(coalesce(v_prior_baja.separation_other_reason, '')), '')
          END,
          separation_notes = v_prior_baja.notes,
          reason_validation_status = CASE
            WHEN v_prior_baja.catalog_name = 'Fallecimiento' THEN 'PENDING_VALIDATION'
            WHEN v_prior_baja.catalog_name IS NOT NULL
                 AND v_prior_baja.reason IS NOT NULL
                 AND lower(btrim(v_prior_baja.catalog_name)) = lower(btrim(v_prior_baja.reason))
              THEN 'AUTO_MATCHED'
            ELSE 'PENDING_VALIDATION'
          END,
          inconsistency_code = CASE
            WHEN v_prior_baja.catalog_name = 'Fallecimiento' THEN ' CONTRADICTION_DECEASED_REINCORPORATED'
            WHEN v_prior_baja.catalog_name IS DISTINCT FROM v_prior_baja.reason THEN 'REASON_TEXT_MISMATCH'
            ELSE wep.inconsistency_code
          END,
          inconsistency_details = CASE
            WHEN v_prior_baja.catalog_name = 'Fallecimiento'
              THEN 'Contradicción material: baja por Fallecimiento seguida de reincorporación posterior.'
            WHEN v_prior_baja.catalog_name IS DISTINCT FROM v_prior_baja.reason
              THEN format('Motivo catálogo: "%s" vs texto movimiento: "%s".', coalesce(v_prior_baja.catalog_name, 'N/A'), coalesce(v_prior_baja.reason, 'N/A'))
            ELSE wep.inconsistency_details
          END,
          status = 'CLOSED',
          updated_at = now()
        WHERE wep.id = v_active_period.id;
      ELSE
        -- No bloquear reincorporate_worker: cerrar el período previo usando el fin de asignación anterior y marcar para revisión
        SELECT max(wpa.end_date)
          INTO v_last_closed_assignment_end
        FROM public.worker_position_assignments wpa
        WHERE wpa.worker_id = NEW.worker_id
          AND (NEW.new_assignment_id IS NULL OR wpa.id <> NEW.new_assignment_id)
          AND wpa.end_date IS NOT NULL
          AND wpa.end_date <= NEW.effective_date;

        UPDATE public.worker_employment_periods wep
        SET
          separation_date = greatest(coalesce(v_last_closed_assignment_end, NEW.effective_date), wep.hire_date),
          reason_validation_status = 'PENDING_VALIDATION',
          inconsistency_code = 'REENTRY_WITHOUT_PRIOR_BAJA_MOVEMENT',
          inconsistency_details = 'Se registró una reincorporación sin movimiento de BAJA previo sincronizado; cerrado preventivamente para revisión.',
          status = 'CLOSED',
          updated_at = now()
        WHERE wep.id = v_active_period.id;
      END IF;
    END IF;

    -- Si la baja del período inmediatamente anterior fue "Fallecimiento", marcar contradicción material en ese período
    UPDATE public.worker_employment_periods wep
    SET
      reason_validation_status = 'PENDING_VALIDATION',
      inconsistency_code = 'CONTRADICTION_DECEASED_REINCORPORATED',
      inconsistency_details = 'Contradicción material: baja registrada como Fallecimiento seguida de reincorporación.',
      updated_at = now()
    WHERE wep.worker_id = NEW.worker_id
      AND wep.status = 'CLOSED'
      AND wep.separation_reason_catalog_snapshot = 'Fallecimiento';

    SELECT coalesce(max(wep.period_sequence), 0) + 1
      INTO v_next_seq
    FROM public.worker_employment_periods wep
    WHERE wep.worker_id = NEW.worker_id;

    SELECT s.position_name, s.area_name, s.occupational_category_name
      INTO v_pos, v_area, v_cat
    FROM public.get_worker_assignment_snapshot(NEW.worker_id, NEW.new_assignment_id) s;

    INSERT INTO public.worker_employment_periods (
      company_client_id,
      organization_entity_id,
      worker_id,
      period_sequence,
      origin_type,
      reincorporation_movement_id,
      hire_date,
      position_name_snapshot,
      area_name_snapshot,
      occupational_category_snapshot,
      status
    ) VALUES (
      v_worker.company_client_id,
      v_worker.organization_entity_id,
      v_worker.id,
      v_next_seq,
      'REINCORPORATION',
      NEW.id,
      NEW.effective_date,
      v_pos,
      v_area,
      v_cat,
      'ACTIVE'
    );

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_fn_sync_employment_period_on_movement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_employment_period_on_movement ON public.worker_employment_movements;
CREATE TRIGGER trg_sync_employment_period_on_movement
  AFTER INSERT ON public.worker_employment_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_sync_employment_period_on_movement();

-- ----------------------------------------------------------------------------
-- 10. RPC protegida para editar el Número de Alta (hire_number)
--     Requiere permiso workers.manage sobre la entidad del período.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_worker_employment_period_hire_number(
  p_period_id uuid,
  p_hire_number text DEFAULT NULL
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

  v_clean := nullif(btrim(coalesce(p_hire_number, '')), '');

  UPDATE public.worker_employment_periods
  SET
    hire_number = v_clean,
    updated_at = now()
  WHERE id = p_period_id
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'id', v_period.id,
    'worker_id', v_period.worker_id,
    'period_sequence', v_period.period_sequence,
    'hire_number', v_period.hire_number,
    'updated_at', v_period.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_worker_employment_period_hire_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_worker_employment_period_hire_number(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. RPC protegida para editar el Número de Baja (separation_number)
--     Requiere permiso workers.manage sobre la entidad del período.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_worker_employment_period_separation_number(
  p_period_id uuid,
  p_separation_number text DEFAULT NULL
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

  IF v_period.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Solo se puede asignar número de baja a un período cerrado';
  END IF;

  IF NOT public.can_access_entity(v_period.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para modificar el registro de altas y bajas en esta entidad';
  END IF;

  v_clean := nullif(btrim(coalesce(p_separation_number, '')), '');

  UPDATE public.worker_employment_periods
  SET
    separation_number = v_clean,
    updated_at = now()
  WHERE id = p_period_id
  RETURNING * INTO v_period;

  IF v_period.separation_movement_id IS NOT NULL THEN
    UPDATE public.worker_employment_movements
    SET separation_number = v_clean
    WHERE id = v_period.separation_movement_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_period.id,
    'worker_id', v_period.worker_id,
    'period_sequence', v_period.period_sequence,
    'separation_number', v_period.separation_number,
    'updated_at', v_period.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_worker_employment_period_separation_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_worker_employment_period_separation_number(uuid, text) TO authenticated, service_role;

COMMIT;
