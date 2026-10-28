-- ============================================================================
-- PLURIEMPLEO — BLOQUE 5.1: CORRECCIONES DE INTEGRACIÓN
-- Estado: PREPARADA · NO EJECUTADA (pendiente de autorización explícita).
-- Requiere: 20261029_03 (resolvers de objetivo) y 20261029_04 (alertas).
-- Orden: 03 → 04 → … → 07. La dependencia es de UN SOLO SENTIDO (este archivo
-- consume los resolutores publicados por 03), por lo que el orden numérico es un
-- orden topológico válido y ningún archivo necesita al siguiente.
--
-- Motivo: estas funciones identifican el contrato/asignación afectados por su
-- cuenta. Sus cuerpos vivos resuelven el objetivo con `ORDER BY ... LIMIT 1`, de modo
-- que con DOS contratos vigentes devolvían las condiciones formalizadas o el
-- vencimiento de un contrato distinto al seleccionado.
--
-- Aquí se les añade un ÚLTIMO parámetro opcional (`p_target_*`) que identifica el
-- objetivo. Al ser opcional y estar al final de la firma, la llamada anterior de un
-- trabajador de UN SOLO contrato sigue siendo válida y resuelve por sí misma.
--
-- Cada función se elimina antes de recrearla porque cambia su FIRMA (no se puede
-- `create or replace` un cambio de argumentos ni de tipo de retorno); por eso se
-- restauran explícitamente sus privilegios EXECUTE (patrón de la base de datos:
-- `authenticated` y `service_role` sí, PUBLIC y `anon` no).
--
-- Ninguna de las funciones duplica lógica: la resolución del objetivo se delega en
-- `resolve_worker_target_contract` / `resolve_worker_target_assignment` (Bloque 3) y
-- las fórmulas (salario, componentes, totales, clasificación temporal) no se tocan.
--
-- CORRECCIÓN DE DEPENDENCIA (Bloque 6)
--   `position_change_preview` YA NO SE DEFINE AQUÍ: se trasladó a `20261029_03`,
--   justo antes de su único consumidor interno (`change_worker_position`), porque su
--   firma de 4 argumentos sólo la invoca ese procedimiento. Definirla aquí mientras
--   03 la invocaba creaba una dependencia CIRCULAR (03 → 07 para la vista previa y
--   07 → 03 para los resolutores) que rompía el cambio de puesto en el intervalo
--   entre ambos archivos, y también para trabajadores con un solo contrato.
--   Este archivo queda así con DOS correcciones: `worker_formalized_conditions`
--   (§1) y `contract_expiry_alerts` (§2). No se utiliza DROP CASCADE.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. CONDICIONES FORMALIZADAS POR CONTRATO (`worker_formalized_conditions`)
--    Las condiciones mostradas corresponden EXCLUSIVAMENTE al contrato objetivo.
-- ---------------------------------------------------------------------------
drop function if exists public.worker_formalized_conditions(uuid);

create or replace function public.worker_formalized_conditions(
  p_worker_id uuid,
  p_target_contract_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_contract public.employment_contracts%ROWTYPE;
  v_pending jsonb := '[]'::jsonb;
  v_pending_difference numeric := 0;
  v_current_contracts integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT (public.can_access_entity(v_worker.organization_entity_id, 'workers.view')
          OR public.can_access_entity(v_worker.organization_entity_id, 'workers.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar trabajadores de esta entidad';
  END IF;

  -- Contrato OBJETIVO: explícito o único vigente. Con dos contratos y ninguno
  -- identificado NO se elige uno arbitrariamente: se exige la identificación.
  SELECT count(*) INTO v_current_contracts
  FROM public.employment_contracts c
  WHERE c.worker_id = p_worker_id AND c.is_current = true;

  -- Compatibilidad: sin contrato vigente se conserva la respuesta actual.
  IF v_current_contracts = 0 THEN
    RETURN jsonb_build_object(
      'worker_id', p_worker_id,
      'has_contract', false,
      'formalized', NULL,
      'pending_addendums', '[]'::jsonb,
      'pending_difference', NULL
    );
  END IF;

  SELECT * INTO v_contract FROM public.employment_contracts
  WHERE id = public.resolve_worker_target_contract(p_worker_id, p_target_contract_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'addendum_id', a.id,
           'addendum_number', a.addendum_number,
           'reason_code', a.reason_code,
           'reason', a.reason,
           'effective_date', a.effective_date,
           'status', a.status,
           'total_before', a.total_before,
           'total_after', a.total_after,
           'salary_history_id', a.salary_history_id,
           'changes', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'field_code', c.field_code,
                      'old_display_value', c.old_display_value,
                      'new_display_value', c.new_display_value,
                      'display_order', c.display_order
                    ) ORDER BY c.display_order)
             FROM public.employment_contract_addendum_changes c
             WHERE c.addendum_id = a.id
           ), '[]'::jsonb)
         ) ORDER BY a.effective_date, a.addendum_number NULLS FIRST), '[]'::jsonb)
  INTO v_pending
  FROM public.contract_addendums a
  WHERE a.employment_contract_id = v_contract.id
    AND a.status IN ('PENDING_TEMPLATE', 'READY_TO_GENERATE', 'GENERATION_ERROR');

  SELECT COALESCE(SUM(COALESCE(a.total_after, 0) - COALESCE(a.total_before, 0)), 0) INTO v_pending_difference
  FROM public.contract_addendums a
  WHERE a.employment_contract_id = v_contract.id
    AND a.status IN ('PENDING_TEMPLATE', 'READY_TO_GENERATE', 'GENERATION_ERROR');

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'has_contract', true,
    'employment_contract_id', v_contract.id,
    'formalized', public.contract_formalized_conditions(v_contract.id),
    'pending_addendums', v_pending,
    'pending_difference', v_pending_difference
  );
END;
$$;

grant execute on function public.worker_formalized_conditions(uuid, uuid) to authenticated, service_role;
revoke execute on function public.worker_formalized_conditions(uuid, uuid) from public, anon;


-- ---------------------------------------------------------------------------
-- 2. ALERTAS DE VENCIMIENTO (`contract_expiry_alerts`)
--    Se amplía la respuesta con la ASIGNACIÓN del propio contrato para que una baja
--    desde los vencimientos identifique inequívocamente contrato y asignación (y no
--    finalice nunca los dos contratos por una baja individual).
--    El tipo de retorno cambia (una columna más), por eso se elimina antes.
-- ---------------------------------------------------------------------------
drop function if exists public.contract_expiry_alerts(uuid, integer, uuid);

create or replace function public.contract_expiry_alerts(
  target_entity_id uuid,
  horizon_days integer default 30,
  target_worker_id uuid default null
)
returns TABLE(worker_id uuid, worker_code text, worker_name text, identification text, area_name text, job_name text, position_name text, position_code text, contract_id uuid, contract_type_name text, contract_type_code text, contract_start_date date, contract_end_date date, salary_group_id uuid, salary_scale_id uuid, salary_group_sequence_number integer, days_remaining integer, alert_state text, assignment_id uuid)
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT (public.can_access_entity(target_entity_id, 'contract_alerts.view')
          OR public.can_access_entity(target_entity_id, 'workers.view')
          OR public.can_access_entity(target_entity_id, 'workers.manage')
          OR public.can_access_entity(target_entity_id, 'contracts.view')
          OR public.can_access_entity(target_entity_id, 'contracts.manage')) THEN
    RAISE EXCEPTION 'No tiene permiso para consultar los vencimientos contractuales de esta entidad';
  END IF;

  RETURN QUERY
  WITH horizon AS (
    SELECT GREATEST(COALESCE(horizon_days, 30), 0) AS days
  )
  SELECT
    w.id AS worker_id,
    w.code AS worker_code,
    concat_ws(' ', w.first_name, w.first_surname, w.second_surname) AS worker_name,
    w.identification::text AS identification,
    ar.name AS area_name,
    j.name AS job_name,
    p.name AS position_name,
    p.code AS position_code,
    c.id AS contract_id,
    ct.name AS contract_type_name,
    ct.code AS contract_type_code,
    c.start_date AS contract_start_date,
    c.end_date AS contract_end_date,
    sg.id AS salary_group_id,
    sg.salary_scale_id AS salary_scale_id,
    sg.sequence_number AS salary_group_sequence_number,
    (c.end_date - CURRENT_DATE)::integer AS days_remaining,
    CASE
      WHEN c.end_date IS NULL THEN 'NO_END_DATE'
      WHEN c.end_date < CURRENT_DATE THEN 'OVERDUE'
      WHEN c.end_date = CURRENT_DATE THEN 'DUE_TODAY'
      WHEN c.end_date <= CURRENT_DATE + 7 THEN 'DUE_IN_7'
      WHEN c.end_date <= CURRENT_DATE + 15 THEN 'DUE_IN_15'
      WHEN c.end_date <= CURRENT_DATE + 30 THEN 'DUE_IN_30'
      ELSE 'DUE_AFTER_30'
    END AS alert_state,
    -- Asignación DEL CONTRATO de la fila: identifica la operación de baja.
    c.assignment_id AS assignment_id
  FROM public.employment_contracts c
  JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
  JOIN public.workers w ON w.id = c.worker_id
  -- Puesto del PROPIO contrato (su asignación), nunca la posición "vigente" genérica.
  LEFT JOIN public.worker_position_assignments a ON a.id = c.assignment_id
  LEFT JOIN public.organization_positions p ON p.id = a.position_id
  LEFT JOIN public.organization_jobs j ON j.id = p.job_id
  LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
  LEFT JOIN public.salary_groups sg ON sg.id = j.salary_group_id
  CROSS JOIN horizon h
  WHERE c.is_current = true
    AND c.actual_end_date IS NULL
    AND ct.code = 'DETERMINADO'
    AND w.employment_status = 'active'
    AND w.organization_entity_id = target_entity_id
    AND (target_worker_id IS NULL OR w.id = target_worker_id)
    AND (c.end_date IS NULL OR c.end_date <= CURRENT_DATE + h.days)
  ORDER BY c.end_date ASC NULLS LAST, w.first_surname ASC, w.first_name ASC;
END;
$function$;

grant execute on function public.contract_expiry_alerts(uuid, integer, uuid) to authenticated, service_role;
revoke execute on function public.contract_expiry_alerts(uuid, integer, uuid) from public, anon;


-- ============================================================================
-- FIN DEL BLOQUE 5.1 — NO EJECUTADO.
-- ============================================================================
