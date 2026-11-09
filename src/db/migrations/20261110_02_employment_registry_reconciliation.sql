-- ============================================================================
-- SiteCorp · Módulo de Altas y Bajas (Registro Histórico de Períodos Laborales)
-- SCRIPT 2: FUNCIONES DE RECONCILIACIÓN HISTÓRICA CONTROLADA E IDEMPOTENTE
-- (20261110_02_employment_registry_reconciliation.sql)
--
-- IMPORTANTE:
--   1. Define las funciones de reconciliación individual, por entidad y global,
--      pero NO ejecuta automáticamente el backfill global al aplicar el archivo.
--   2. Vincula cada período de reingreso con su reincorporation_movement_id real
--      mediante la variable explícita v_reentry_movement_id.
--   3. Conserva snapshots de catálogo y movimiento, y distingue AUTO_MATCHED,
--      PENDING_VALIDATION y VERIFIED (nunca asigna VERIFIED automáticamente).
--   4. Es 100 % idempotente: no duplica períodos ni sobrescribe hire_number,
--      separation_number ni validaciones manuales (VERIFIED).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Reconciliación idempotente de un trabajador individual (uso interno / admin)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_worker_employment_periods(
  p_worker_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_initial_hire_date date;
  v_origin_type text;
  v_seq integer := 1;
  v_current_hire_date date;
  v_reentry_movement_id uuid := NULL;
  v_current_assignment_id uuid := NULL;
  v_period_id uuid;
  v_existing public.worker_employment_periods%ROWTYPE;
  v_pos text;
  v_area text;
  v_cat text;
  v_mov record;
  v_has_subsequent_reentry boolean;
  v_other_active_assignments integer;
  v_validation_status text;
  v_inconsistency_code text;
  v_inconsistency_details text;
  v_other_reason text;
  v_created_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  SELECT * INTO v_worker
  FROM public.workers
  WHERE id = p_worker_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador % no encontrado', p_worker_id;
  END IF;

  v_initial_hire_date := coalesce(v_worker.employment_start_date, v_worker.hire_date);
  IF v_initial_hire_date IS NULL THEN
    RETURN jsonb_build_object(
      'worker_id', p_worker_id,
      'status', 'SKIPPED_NO_HIRE_DATE',
      'periods_created', 0,
      'periods_updated', 0
    );
  END IF;

  v_origin_type := CASE
    WHEN v_worker.origin = 'MIGRATION' THEN 'MIGRATION'
    ELSE 'INITIAL_HIRE'
  END;

  v_current_hire_date := v_initial_hire_date;
  v_reentry_movement_id := NULL;

  -- Asignación más antigua como referencia inicial
  SELECT wpa.id INTO v_current_assignment_id
  FROM public.worker_position_assignments wpa
  WHERE wpa.worker_id = p_worker_id
  ORDER BY wpa.start_date ASC, wpa.created_at ASC
  LIMIT 1;

  SELECT s.position_name, s.area_name, s.occupational_category_name
    INTO v_pos, v_area, v_cat
  FROM public.get_worker_assignment_snapshot(p_worker_id, v_current_assignment_id) s;

  -- Asegurar la existencia del período inicial (period_sequence = 1)
  SELECT * INTO v_existing
  FROM public.worker_employment_periods wep
  WHERE wep.worker_id = p_worker_id
    AND wep.period_sequence = 1
  FOR UPDATE;

  IF NOT FOUND THEN
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
      1,
      v_origin_type,
      NULL,
      v_current_hire_date,
      v_pos,
      v_area,
      v_cat,
      'ACTIVE'
    ) RETURNING id INTO v_period_id;
    v_created_count := v_created_count + 1;
  ELSE
    v_period_id := v_existing.id;
    UPDATE public.worker_employment_periods wep
    SET
      hire_date = CASE
        WHEN wep.separation_date IS NULL OR wep.separation_date >= v_current_hire_date
          THEN v_current_hire_date
        ELSE wep.hire_date
      END,
      position_name_snapshot = coalesce(wep.position_name_snapshot, v_pos),
      area_name_snapshot = coalesce(wep.area_name_snapshot, v_area),
      occupational_category_snapshot = coalesce(wep.occupational_category_snapshot, v_cat),
      updated_at = now()
    WHERE wep.id = v_period_id;
    v_updated_count := v_updated_count + 1;
  END IF;

  -- Recorrer cronológicamente los movimientos de BAJA y REINCORPORACION del trabajador
  FOR v_mov IN
    SELECT
      m.id,
      m.movement_type,
      m.previous_assignment_id,
      m.new_assignment_id,
      m.effective_date,
      m.reason,
      m.notes,
      m.separation_reason_id,
      m.separation_number,
      m.separation_other_reason,
      m.created_at,
      r.name AS catalog_reason_name,
      r.code AS catalog_reason_code
    FROM public.worker_employment_movements m
    LEFT JOIN public.worker_separation_reasons r ON r.id = m.separation_reason_id
    WHERE m.worker_id = p_worker_id
      AND m.movement_type IN ('BAJA', 'REINCORPORACION')
    ORDER BY
      m.effective_date ASC,
      CASE WHEN m.movement_type = 'BAJA' THEN 0 ELSE 1 END ASC,
      m.created_at ASC,
      m.id ASC
  LOOP
    IF v_mov.movement_type = 'BAJA' THEN
      -- Verificar si es una baja parcial de pluriempleo (existe otra asignación que seguía activa tras esta baja
      -- sin reincorporación posterior que explique esa plaza)
      SELECT EXISTS (
        SELECT 1
        FROM public.worker_employment_movements m2
        WHERE m2.worker_id = p_worker_id
          AND m2.movement_type = 'REINCORPORACION'
          AND (
            m2.effective_date > v_mov.effective_date
            OR (m2.effective_date = v_mov.effective_date AND m2.created_at >= v_mov.created_at)
          )
      ) INTO v_has_subsequent_reentry;

      SELECT count(*)
        INTO v_other_active_assignments
      FROM public.worker_position_assignments wpa
      WHERE wpa.worker_id = p_worker_id
        AND (v_mov.previous_assignment_id IS NULL OR wpa.id <> v_mov.previous_assignment_id)
        AND wpa.start_date <= v_mov.effective_date
        AND (wpa.end_date IS NULL OR wpa.end_date > v_mov.effective_date);

      -- Si el trabajador sigue activo hoy, no hubo reincorporación posterior y tenía otra plaza activa en esa fecha,
      -- se trata de una baja parcial de pluriempleo (ej. TRB-792380) y NO cierra el período laboral de la entidad.
      IF v_other_active_assignments > 0 AND NOT v_has_subsequent_reentry AND v_worker.employment_status = 'active' THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_existing
      FROM public.worker_employment_periods wep
      WHERE wep.id = v_period_id
      FOR UPDATE;

      v_other_reason := CASE
        WHEN v_mov.catalog_reason_code = 'OTRO' OR lower(btrim(coalesce(v_mov.catalog_reason_name, ''))) = 'otro'
          THEN coalesce(
            nullif(btrim(coalesce(v_existing.separation_other_reason, '')), ''),
            nullif(btrim(coalesce(v_mov.separation_other_reason, '')), ''),
            nullif(btrim(coalesce(v_mov.notes, '')), '')
          )
        ELSE coalesce(
          nullif(btrim(coalesce(v_existing.separation_other_reason, '')), ''),
          nullif(btrim(coalesce(v_mov.separation_other_reason, '')), '')
        )
      END;

      -- Determinar estado de validación respetando si ya fue VERIFIED manualmente
      IF v_existing.reason_validation_status = 'VERIFIED' THEN
        v_validation_status := 'VERIFIED';
        v_inconsistency_code := v_existing.inconsistency_code;
        v_inconsistency_details := v_existing.inconsistency_details;
      ELSIF v_mov.catalog_reason_name = 'Fallecimiento' AND v_has_subsequent_reentry THEN
        v_validation_status := 'PENDING_VALIDATION';
        v_inconsistency_code := 'CONTRADICTION_DECEASED_REINCORPORATED';
        v_inconsistency_details := format(
          'Contradicción material: baja registrada con motivo de catálogo "Fallecimiento" (texto: "%s") seguida de reincorporación posterior.',
          coalesce(v_mov.reason, 'N/A')
        );
      ELSIF v_mov.separation_reason_id IS NULL THEN
        v_validation_status := 'PENDING_VALIDATION';
        v_inconsistency_code := 'MISSING_SEPARATION_REASON_ID';
        v_inconsistency_details := 'El movimiento de baja no tiene motivo del catálogo asociado.';
      ELSIF v_mov.catalog_reason_name IS NOT NULL
            AND v_mov.reason IS NOT NULL
            AND lower(btrim(v_mov.catalog_reason_name)) = lower(btrim(v_mov.reason)) THEN
        v_validation_status := 'AUTO_MATCHED';
        v_inconsistency_code := NULL;
        v_inconsistency_details := NULL;
      ELSE
        v_validation_status := 'PENDING_VALIDATION';
        v_inconsistency_code := 'REASON_TEXT_MISMATCH';
        v_inconsistency_details := format(
          'Discrepancia histórica entre motivo del catálogo ("%s") y descripción del movimiento ("%s").',
          coalesce(v_mov.catalog_reason_name, 'N/A'),
          coalesce(v_mov.reason, 'N/A')
        );
      END IF;

      IF v_mov.previous_assignment_id IS NOT NULL THEN
        SELECT s.position_name, s.area_name, s.occupational_category_name
          INTO v_pos, v_area, v_cat
        FROM public.get_worker_assignment_snapshot(p_worker_id, v_mov.previous_assignment_id) s;
      END IF;

      UPDATE public.worker_employment_periods wep
      SET
        separation_movement_id = v_mov.id,
        separation_date = v_mov.effective_date,
        separation_number = coalesce(wep.separation_number, nullif(btrim(coalesce(v_mov.separation_number, '')), '')),
        separation_reason_id = CASE
          WHEN wep.reason_validation_status = 'VERIFIED' THEN coalesce(wep.separation_reason_id, v_mov.separation_reason_id)
          ELSE v_mov.separation_reason_id
        END,
        separation_reason_catalog_snapshot = CASE
          WHEN wep.reason_validation_status = 'VERIFIED' THEN coalesce(wep.separation_reason_catalog_snapshot, v_mov.catalog_reason_name)
          ELSE v_mov.catalog_reason_name
        END,
        separation_reason_movement_snapshot = v_mov.reason,
        separation_other_reason = v_other_reason,
        separation_notes = coalesce(wep.separation_notes, v_mov.notes),
        reason_validation_status = v_validation_status,
        inconsistency_code = v_inconsistency_code,
        inconsistency_details = v_inconsistency_details,
        position_name_snapshot = coalesce(wep.position_name_snapshot, v_pos),
        area_name_snapshot = coalesce(wep.area_name_snapshot, v_area),
        occupational_category_snapshot = coalesce(wep.occupational_category_snapshot, v_cat),
        status = 'CLOSED',
        updated_at = now()
      WHERE wep.id = v_period_id;

      v_updated_count := v_updated_count + 1;

    ELSIF v_mov.movement_type = 'REINCORPORACION' THEN
      -- Verificar que el período actual esté cerrado antes de abrir el período de reingreso
      SELECT * INTO v_existing
      FROM public.worker_employment_periods wep
      WHERE wep.id = v_period_id
      FOR UPDATE;

      IF v_existing.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'Inconsistencia en trabajador %: movimiento de REINCORPORACION (%) en fecha % sin movimiento de BAJA previo demostrado.',
          p_worker_id, v_mov.id, v_mov.effective_date;
      END IF;

      v_seq := v_seq + 1;
      v_current_hire_date := v_mov.effective_date;
      v_reentry_movement_id := v_mov.id;
      v_current_assignment_id := v_mov.new_assignment_id;

      SELECT s.position_name, s.area_name, s.occupational_category_name
        INTO v_pos, v_area, v_cat
      FROM public.get_worker_assignment_snapshot(p_worker_id, v_current_assignment_id) s;

      -- Buscar si ya existe el período por reincorporation_movement_id o por (worker_id, period_sequence)
      SELECT * INTO v_existing
      FROM public.worker_employment_periods wep
      WHERE wep.reincorporation_movement_id = v_reentry_movement_id
         OR (wep.worker_id = p_worker_id AND wep.period_sequence = v_seq)
      ORDER BY CASE WHEN wep.reincorporation_movement_id = v_reentry_movement_id THEN 0 ELSE 1 END
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
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
          v_seq,
          'REINCORPORATION',
          v_reentry_movement_id,
          v_current_hire_date,
          v_pos,
          v_area,
          v_cat,
          'ACTIVE'
        ) RETURNING id INTO v_period_id;
        v_created_count := v_created_count + 1;
      ELSE
        v_period_id := v_existing.id;
        UPDATE public.worker_employment_periods wep
        SET
          period_sequence = v_seq,
          origin_type = 'REINCORPORATION',
          reincorporation_movement_id = v_reentry_movement_id,
          hire_date = CASE
            WHEN wep.separation_date IS NULL OR wep.separation_date >= v_current_hire_date
              THEN v_current_hire_date
            ELSE wep.hire_date
          END,
          position_name_snapshot = coalesce(wep.position_name_snapshot, v_pos),
          area_name_snapshot = coalesce(wep.area_name_snapshot, v_area),
          occupational_category_snapshot = coalesce(wep.occupational_category_snapshot, v_cat),
          updated_at = now()
        WHERE wep.id = v_period_id;
        v_updated_count := v_updated_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'status', 'OK',
    'total_periods_for_worker', v_seq,
    'periods_created', v_created_count,
    'periods_updated', v_updated_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_worker_employment_periods(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_worker_employment_periods(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Reconciliación administrativa acotada a una entidad organizativa
--    Requiere usuario autenticado con permiso workers.manage sobre la entidad.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_entity_employment_periods(
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker_id uuid;
  v_res jsonb;
  v_workers_count integer := 0;
  v_created_total integer := 0;
  v_updated_total integer := 0;
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

  IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para sincronizar el registro de altas y bajas de esta entidad';
  END IF;

  FOR v_worker_id IN
    SELECT w.id
    FROM public.workers w
    WHERE w.organization_entity_id = p_entity_id
    ORDER BY w.created_at ASC, w.id ASC
  LOOP
    v_res := public.sync_worker_employment_periods(v_worker_id);
    v_workers_count := v_workers_count + 1;
    v_created_total := v_created_total + coalesce((v_res->>'periods_created')::integer, 0);
    v_updated_total := v_updated_total + coalesce((v_res->>'periods_updated')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'entity_id', p_entity_id,
    'workers_processed', v_workers_count,
    'periods_created', v_created_total,
    'periods_updated', v_updated_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_entity_employment_periods(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_entity_employment_periods(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Reconciliación histórica global controlada (SOLO service_role / admin DB)
--    Inaccesible desde anon y authenticated.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_all_employment_periods()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker_id uuid;
  v_res jsonb;
  v_workers_processed integer := 0;
  v_created_total integer := 0;
  v_updated_total integer := 0;
  v_total_periods integer := 0;
  v_initial_periods integer := 0;
  v_reentry_periods integer := 0;
  v_active_periods integer := 0;
  v_closed_periods integer := 0;
  v_auto_matched integer := 0;
  v_pending_validation integer := 0;
  v_verified integer := 0;
BEGIN
  FOR v_worker_id IN
    SELECT w.id
    FROM public.workers w
    ORDER BY w.created_at ASC, w.id ASC
  LOOP
    v_res := public.sync_worker_employment_periods(v_worker_id);
    v_workers_processed := v_workers_processed + 1;
    v_created_total := v_created_total + coalesce((v_res->>'periods_created')::integer, 0);
    v_updated_total := v_updated_total + coalesce((v_res->>'periods_updated')::integer, 0);
  END LOOP;

  SELECT
    count(*),
    count(*) FILTER (WHERE period_sequence = 1),
    count(*) FILTER (WHERE period_sequence > 1),
    count(*) FILTER (WHERE status = 'ACTIVE'),
    count(*) FILTER (WHERE status = 'CLOSED'),
    count(*) FILTER (WHERE reason_validation_status = 'AUTO_MATCHED'),
    count(*) FILTER (WHERE reason_validation_status = 'PENDING_VALIDATION'),
    count(*) FILTER (WHERE reason_validation_status = 'VERIFIED')
  INTO
    v_total_periods,
    v_initial_periods,
    v_reentry_periods,
    v_active_periods,
    v_closed_periods,
    v_auto_matched,
    v_pending_validation,
    v_verified
  FROM public.worker_employment_periods;

  RETURN jsonb_build_object(
    'workers_processed', v_workers_processed,
    'periods_created', v_created_total,
    'periods_updated', v_updated_total,
    'total_periods', v_total_periods,
    'initial_periods', v_initial_periods,
    'reentry_periods', v_reentry_periods,
    'active_periods', v_active_periods,
    'closed_periods', v_closed_periods,
    'auto_matched_reasons', v_auto_matched,
    'pending_validation_reasons', v_pending_validation,
    'verified_reasons', v_verified
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_all_employment_periods() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_all_employment_periods() TO service_role;

-- ----------------------------------------------------------------------------
-- 4. RPC protegida para validar o corregir documentalmente un motivo de baja
--    (Permite resolver casos en PENDING_VALIDATION desde la interfaz con workers.manage)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_worker_employment_period_separation_reason(
  p_period_id uuid,
  p_separation_reason_id uuid,
  p_separation_other_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_period public.worker_employment_periods%ROWTYPE;
  v_reason public.worker_separation_reasons%ROWTYPE;
  v_clean_other text;
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
    RAISE EXCEPTION 'Solo se puede validar el motivo de baja de un período cerrado';
  END IF;

  IF NOT public.can_access_entity(v_period.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para validar motivos de baja en esta entidad';
  END IF;

  SELECT * INTO v_reason
  FROM public.worker_separation_reasons
  WHERE id = p_separation_reason_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El motivo de baja seleccionado no es válido';
  END IF;

  v_clean_other := nullif(btrim(coalesce(p_separation_other_reason, '')), '');

  IF (v_reason.code = 'OTRO' OR lower(btrim(v_reason.name)) = 'otro') AND v_clean_other IS NULL THEN
    RAISE EXCEPTION 'Debe especificar el motivo de baja cuando selecciona la causa "Otro".';
  END IF;

  UPDATE public.worker_employment_periods
  SET
    separation_reason_id = v_reason.id,
    separation_reason_catalog_snapshot = v_reason.name,
    separation_other_reason = CASE
      WHEN v_reason.code = 'OTRO' OR lower(btrim(v_reason.name)) = 'otro' THEN v_clean_other
      ELSE NULL
    END,
    reason_validation_status = 'VERIFIED',
    updated_at = now()
  WHERE id = p_period_id
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'id', v_period.id,
    'worker_id', v_period.worker_id,
    'period_sequence', v_period.period_sequence,
    'separation_reason_id', v_period.separation_reason_id,
    'separation_reason_catalog_snapshot', v_period.separation_reason_catalog_snapshot,
    'separation_other_reason', v_period.separation_other_reason,
    'reason_validation_status', v_period.reason_validation_status,
    'updated_at', v_period.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_worker_employment_period_separation_reason(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_worker_employment_period_separation_reason(uuid, uuid, text) TO authenticated, service_role;

COMMIT;
