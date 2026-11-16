-- =============================================================================
-- MIGRACIÓN: 20261116000002_qa_round4c.sql
-- Ronda 4c de QA (SiteCorp):
--   1. Backfill de asignaciones y contratos que quedaron cerrados
--      (`is_current = false`) por cambios con fecha futura (`start_date >
--      public.cuba_current_date()`) ejecutados antes del despliegue de 0000.
--   2. Ampliar `public.apply_due_scheduled_separations` para que también active
--      asignaciones y contratos iniciales (`ALTA`/`REINCORPORACION`) con
--      `start_date <= cuba_current_date()` e `is_current = false`.
--   3. Bloque de comprobación `DO $$ ... RAISE EXCEPTION ... $$`.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Backfill de asignaciones y contratos futuros y reapertura de los vigentes
-- =============================================================================
DO $$
DECLARE
  v_today date := public.cuba_current_date();
  v_fut record;
  v_prev_asg_id uuid;
  v_ctr record;
  v_prev_ctr_id uuid;
  v_next_ctr_start date;
BEGIN
  -- 1A. Poner `is_current = false` en toda asignación futura (`start_date > v_today`)
  --     antes de reabrir ninguna asignación previa (índice único `wpa_current_per_worker_unique`).
  FOR v_fut IN
    SELECT a.id, a.worker_id, a.start_date, a.is_current
    FROM public.worker_position_assignments a
    WHERE a.start_date > v_today
    ORDER BY a.worker_id, a.start_date ASC, a.created_at ASC
  LOOP
    IF v_fut.is_current THEN
      UPDATE public.worker_position_assignments
      SET is_current = false,
          updated_at = now()
      WHERE id = v_fut.id;
    END IF;
  END LOOP;

  -- 1B. Para cada trabajador activo con al menos una asignación futura (`start_date > v_today`),
  --     reabrir su asignación anterior vigente hoy (`start_date <= v_today`) con
  --     `is_current = true` y `end_date = earliest_future_start - 1`, y devolver a ella
  --     los contratos vigentes y registros de vacaciones movidos por el RPC antiguo.
  FOR v_fut IN
    SELECT DISTINCT ON (a.worker_id)
      a.id AS future_assignment_id,
      a.worker_id,
      a.start_date AS future_start_date
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.start_date > v_today
      AND w.employment_status = 'active'
    ORDER BY a.worker_id, a.start_date ASC, a.created_at ASC
  LOOP
    v_prev_asg_id := NULL;

    -- Priorizar el vínculo explícito registrado en `worker_employment_movements` (`CAMBIO_PUESTO`).
    SELECT wem.previous_assignment_id INTO v_prev_asg_id
    FROM public.worker_employment_movements wem
    JOIN public.worker_position_assignments prev ON prev.id = wem.previous_assignment_id
    WHERE wem.worker_id = v_fut.worker_id
      AND wem.movement_type = 'CAMBIO_PUESTO'
      AND wem.new_assignment_id = v_fut.future_assignment_id
      AND prev.start_date <= v_today
    ORDER BY wem.created_at DESC
    LIMIT 1;

    -- Respaldo: última asignación del mismo trabajador ya iniciada (`start_date <= v_today`).
    IF v_prev_asg_id IS NULL THEN
      SELECT prev.id INTO v_prev_asg_id
      FROM public.worker_position_assignments prev
      WHERE prev.worker_id = v_fut.worker_id
        AND prev.id <> v_fut.future_assignment_id
        AND prev.start_date <= v_today
        AND (prev.scheduled_separation_date IS NULL OR prev.scheduled_separation_date > v_today)
      ORDER BY prev.start_date DESC, prev.created_at DESC
      LIMIT 1;
    END IF;

    IF v_prev_asg_id IS NOT NULL THEN
      UPDATE public.worker_position_assignments
      SET is_current = false,
          updated_at = now()
      WHERE worker_id = v_fut.worker_id
        AND id <> v_prev_asg_id
        AND is_current = true;

      UPDATE public.worker_position_assignments
      SET is_current = true,
          end_date = v_fut.future_start_date - 1,
          updated_at = now()
      WHERE id = v_prev_asg_id;

      -- Restaurar contratos ya iniciados, saldos y movimientos de vacaciones si el RPC antiguo
      -- los reasignó prematuramente a alguna asignación futura del mismo trabajador.
      UPDATE public.employment_contracts ec
      SET assignment_id = v_prev_asg_id,
          updated_at = now()
      WHERE ec.worker_id = v_fut.worker_id
        AND ec.start_date <= v_today
        AND EXISTS (
          SELECT 1
          FROM public.worker_position_assignments fa
          WHERE fa.id = ec.assignment_id
            AND fa.worker_id = v_fut.worker_id
            AND fa.start_date > v_today
        );

      UPDATE public.worker_vacations wv
      SET assignment_id = v_prev_asg_id,
          updated_at = now()
      WHERE wv.worker_id = v_fut.worker_id
        AND EXISTS (
          SELECT 1
          FROM public.worker_position_assignments fa
          WHERE fa.id = wv.assignment_id
            AND fa.worker_id = v_fut.worker_id
            AND fa.start_date > v_today
        );

      UPDATE public.worker_vacation_movements wvm
      SET assignment_id = v_prev_asg_id
      WHERE wvm.worker_id = v_fut.worker_id
        AND EXISTS (
          SELECT 1
          FROM public.worker_position_assignments fa
          WHERE fa.id = wvm.assignment_id
            AND fa.worker_id = v_fut.worker_id
            AND fa.start_date > v_today
        );
    END IF;
  END LOOP;

  -- 1C. Contratos con `start_date > v_today` que quedaron `is_current = true`:
  --     marcarlos `is_current = false` y reabrir el contrato previo ya iniciado (`start_date <= v_today`).
  FOR v_ctr IN
    SELECT c.id, c.worker_id, c.start_date, c.is_current
    FROM public.employment_contracts c
    WHERE c.start_date > v_today
      AND c.is_current = true
    ORDER BY c.worker_id, c.start_date ASC, c.created_at ASC
  LOOP
    UPDATE public.employment_contracts
    SET is_current = false,
        updated_at = now()
    WHERE id = v_ctr.id;
  END LOOP;

  FOR v_ctr IN
    SELECT DISTINCT ON (c.worker_id)
      c.id AS future_contract_id,
      c.worker_id,
      c.start_date AS future_start_date
    FROM public.employment_contracts c
    JOIN public.workers w ON w.id = c.worker_id
    WHERE c.start_date > v_today
      AND w.employment_status = 'active'
    ORDER BY c.worker_id, c.start_date ASC, c.created_at ASC
  LOOP
    v_prev_ctr_id := NULL;
    v_next_ctr_start := v_ctr.future_start_date;

    SELECT wem.previous_contract_id INTO v_prev_ctr_id
    FROM public.worker_employment_movements wem
    JOIN public.employment_contracts prev ON prev.id = wem.previous_contract_id
    WHERE wem.worker_id = v_ctr.worker_id
      AND wem.movement_type = 'CAMBIO_CONTRATO'
      AND wem.new_contract_id = v_ctr.future_contract_id
      AND prev.start_date <= v_today
    ORDER BY wem.created_at DESC
    LIMIT 1;

    IF v_prev_ctr_id IS NULL THEN
      SELECT prev.id INTO v_prev_ctr_id
      FROM public.employment_contracts prev
      WHERE prev.worker_id = v_ctr.worker_id
        AND prev.id <> v_ctr.future_contract_id
        AND prev.start_date <= v_today
      ORDER BY prev.start_date DESC, prev.created_at DESC
      LIMIT 1;
    END IF;

    IF v_prev_ctr_id IS NOT NULL THEN
      UPDATE public.employment_contracts
      SET is_current = false,
          updated_at = now()
      WHERE worker_id = v_ctr.worker_id
        AND id <> v_prev_ctr_id
        AND is_current = true;

      UPDATE public.employment_contracts
      SET is_current = true,
          actual_end_date = v_next_ctr_start - 1,
          updated_at = now()
      WHERE id = v_prev_ctr_id;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- 2. Ampliar `apply_due_scheduled_separations` para activar también asignaciones
--    y contratos iniciales cuya fecha futura (`start_date <= v_today`) ya llegó
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_due_scheduled_separations(
  p_entity_id uuid DEFAULT NULL,
  p_worker_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_today date := public.cuba_current_date();
  v_is_system_call boolean :=
    current_user IN ('postgres', 'supabase_admin')
    OR coalesce(current_setting('role', true), '') = 'service_role';
  v_asg record;
  v_ctr record;
  v_init record;
  v_row record;
  v_reason_name text;
  v_remaining integer;
  v_applied integer := 0;
BEGIN
  IF auth.uid() IS NULL AND NOT v_is_system_call THEN
    RETURN 0;
  END IF;

  -- 1. Activar asignaciones iniciales (p. ej. contratación con incorporación futura) cuya fecha ya llegó
  FOR v_init IN
    SELECT a.id AS assignment_id,
           a.worker_id,
           w.organization_entity_id
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.is_current = false
      AND a.start_date <= v_today
      AND (a.end_date IS NULL OR a.end_date >= v_today)
      AND w.employment_status = 'active'
      AND (w.hire_date IS NULL OR w.hire_date <= v_today)
      AND NOT EXISTS (
        SELECT 1
        FROM public.worker_position_assignments a_cur
        WHERE a_cur.worker_id = a.worker_id
          AND a_cur.is_current = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.worker_employment_movements wem
        WHERE wem.new_assignment_id = a.id
          AND wem.movement_type = 'CAMBIO_PUESTO'
      )
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY a.start_date ASC, a.created_at ASC
  LOOP
    UPDATE public.worker_position_assignments
    SET is_current = true,
        updated_at = now()
    WHERE id = v_init.assignment_id;

    v_applied := v_applied + 1;
  END LOOP;

  -- 2. Activar contratos iniciales cuya fecha efectiva ya llegó cuando no hay otro vigente
  FOR v_init IN
    SELECT c.id AS contract_id,
           c.worker_id,
           c.organization_entity_id
    FROM public.employment_contracts c
    JOIN public.workers w ON w.id = c.worker_id
    WHERE c.is_current = false
      AND c.start_date <= v_today
      AND (c.actual_end_date IS NULL OR c.actual_end_date >= v_today)
      AND w.employment_status = 'active'
      AND (w.hire_date IS NULL OR w.hire_date <= v_today)
      AND NOT EXISTS (
        SELECT 1
        FROM public.employment_contracts c_cur
        WHERE c_cur.worker_id = c.worker_id
          AND c_cur.is_current = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.worker_employment_movements wem
        WHERE wem.new_contract_id = c.id
          AND wem.movement_type = 'CAMBIO_CONTRATO'
      )
      AND (p_entity_id IS NULL OR c.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(c.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY c.start_date ASC, c.created_at ASC
  LOOP
    UPDATE public.employment_contracts
    SET is_current = true,
        updated_at = now()
    WHERE id = v_init.contract_id;

    v_applied := v_applied + 1;
  END LOOP;

  -- 3. Activar cambios de puesto programados cuya fecha de inicio ya llegó (`start_date <= v_today`)
  FOR v_asg IN
    SELECT wem.id AS movement_id,
           wem.worker_id,
           wem.previous_assignment_id,
           wem.new_assignment_id,
           a_new.start_date,
           w.organization_entity_id
    FROM public.worker_employment_movements wem
    JOIN public.worker_position_assignments a_new ON a_new.id = wem.new_assignment_id
    JOIN public.workers w ON w.id = wem.worker_id
    WHERE wem.movement_type = 'CAMBIO_PUESTO'
      AND a_new.is_current = false
      AND a_new.start_date <= v_today
      AND (a_new.end_date IS NULL OR a_new.end_date >= v_today)
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY a_new.start_date ASC
  LOOP
    IF v_asg.previous_assignment_id IS NOT NULL THEN
      UPDATE public.worker_position_assignments
      SET is_current = false,
          end_date = COALESCE(end_date, v_asg.start_date - 1),
          updated_at = now()
      WHERE id = v_asg.previous_assignment_id;

      UPDATE public.employment_contracts
      SET assignment_id = v_asg.new_assignment_id,
          updated_at = now()
      WHERE assignment_id = v_asg.previous_assignment_id
        AND is_current = true;

      UPDATE public.worker_vacations
      SET assignment_id = v_asg.new_assignment_id,
          updated_at = now()
      WHERE worker_id = v_asg.worker_id
        AND assignment_id = v_asg.previous_assignment_id;

      UPDATE public.worker_vacation_movements
      SET assignment_id = v_asg.new_assignment_id
      WHERE worker_id = v_asg.worker_id
        AND assignment_id = v_asg.previous_assignment_id;
    END IF;

    UPDATE public.worker_position_assignments
    SET is_current = true,
        updated_at = now()
    WHERE id = v_asg.new_assignment_id;

    v_applied := v_applied + 1;
  END LOOP;

  -- 4. Activar cambios de contrato programados cuya fecha de inicio ya llegó (`start_date <= v_today`)
  FOR v_ctr IN
    SELECT wem.id AS movement_id,
           wem.worker_id,
           wem.previous_contract_id,
           wem.new_contract_id,
           c_new.start_date,
           w.organization_entity_id
    FROM public.worker_employment_movements wem
    JOIN public.employment_contracts c_new ON c_new.id = wem.new_contract_id
    JOIN public.workers w ON w.id = wem.worker_id
    WHERE wem.movement_type = 'CAMBIO_CONTRATO'
      AND c_new.is_current = false
      AND c_new.start_date <= v_today
      AND (c_new.actual_end_date IS NULL OR c_new.actual_end_date >= v_today)
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY c_new.start_date ASC
  LOOP
    IF v_ctr.previous_contract_id IS NOT NULL THEN
      UPDATE public.employment_contracts
      SET is_current = false,
          actual_end_date = COALESCE(actual_end_date, v_ctr.start_date - 1),
          updated_at = now()
      WHERE id = v_ctr.previous_contract_id;
    END IF;

    UPDATE public.employment_contracts
    SET is_current = true,
        updated_at = now()
    WHERE id = v_ctr.new_contract_id;

    v_applied := v_applied + 1;
  END LOOP;

  -- 5. Aplicar bajas diferidas cuya fecha efectiva ya llegó (`scheduled_separation_date <= v_today`)
  FOR v_row IN
    SELECT a.id AS assignment_id,
           a.worker_id,
           a.position_id,
           a.scheduled_separation_date AS eff_date,
           a.scheduled_separation_reason_id AS reason_id,
           a.scheduled_separation_notes AS notes,
           w.organization_entity_id
    FROM public.worker_position_assignments a
    JOIN public.workers w ON w.id = a.worker_id
    WHERE a.is_current = true
      AND (a.end_date IS NULL OR a.end_date >= v_today)
      AND a.scheduled_separation_date IS NOT NULL
      AND a.scheduled_separation_date <= v_today
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        v_is_system_call
        OR public.can_access_entity(w.organization_entity_id, NULL)
        OR public.has_platform_permission('workers.view')
      )
    ORDER BY a.scheduled_separation_date ASC
    FOR UPDATE OF a
  LOOP
    SELECT name INTO v_reason_name
    FROM public.worker_separation_reasons
    WHERE id = v_row.reason_id;

    UPDATE public.worker_position_assignments
    SET end_date = v_row.eff_date,
        is_current = false,
        scheduled_separation_date = NULL,
        scheduled_separation_reason_id = NULL,
        scheduled_separation_notes = NULL,
        updated_at = now()
    WHERE id = v_row.assignment_id;

    UPDATE public.employment_contracts
    SET is_current = false,
        actual_end_date = v_row.eff_date,
        updated_at = now()
    WHERE assignment_id = v_row.assignment_id AND is_current = true;

    SELECT count(*) INTO v_remaining
    FROM public.worker_position_assignments a2
    WHERE a2.worker_id = v_row.worker_id
      AND a2.is_current = true
      AND (a2.end_date IS NULL OR a2.end_date >= v_today)
      AND a2.id <> v_row.assignment_id;

    IF v_remaining = 0 THEN
      UPDATE public.workers
      SET employment_status = 'inactive', updated_at = now()
      WHERE id = v_row.worker_id;

      UPDATE public.sst_onboarding_notifications
      SET status = 'DESCARTADA'
      WHERE worker_id = v_row.worker_id
        AND status IN ('PENDIENTE', 'EN_PROCESO');

      UPDATE public.training_initial_notifications
      SET status = 'DESCARTADA'
      WHERE worker_id = v_row.worker_id
        AND status = 'PENDIENTE';
    END IF;

    INSERT INTO public.worker_employment_movements (
      worker_id, movement_type, previous_assignment_id, new_assignment_id,
      effective_date, reason, notes, separation_reason_id, created_by
    ) VALUES (
      v_row.worker_id, 'BAJA', v_row.assignment_id, NULL,
      v_row.eff_date, v_reason_name, v_row.notes, v_row.reason_id, auth.uid()
    );

    PERFORM public.create_payroll_movement(
      v_row.worker_id, 'BAJA', v_row.eff_date,
      v_row.position_id, NULL, v_row.assignment_id, v_row.assignment_id
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN v_applied;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_due_scheduled_separations(uuid, uuid)
  TO authenticated, service_role;

-- =============================================================================
-- 3. VERIFICACIÓN FINAL
-- =============================================================================
DO $$
DECLARE
  v_today date := public.cuba_current_date();
  v_future_current_asg integer;
  v_future_current_ctr integer;
BEGIN
  SELECT count(*) INTO v_future_current_asg
  FROM public.worker_position_assignments
  WHERE start_date > v_today
    AND is_current = true;

  IF v_future_current_asg > 0 THEN
    RAISE EXCEPTION '[QA-Round4c] Quedan % asignaciones futuras con is_current = true', v_future_current_asg;
  END IF;

  SELECT count(*) INTO v_future_current_ctr
  FROM public.employment_contracts
  WHERE start_date > v_today
    AND is_current = true;

  IF v_future_current_ctr > 0 THEN
    RAISE EXCEPTION '[QA-Round4c] Quedan % contratos futuros con is_current = true', v_future_current_ctr;
  END IF;

  RAISE NOTICE '[QA-Round4c] Verificación completada: asignaciones y contratos futuros encolados con is_current = false y asignaciones previas reabiertas.';
END $$;

COMMIT;
