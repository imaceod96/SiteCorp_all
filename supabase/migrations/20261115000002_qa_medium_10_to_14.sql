-- ============================================================================
-- QA Medios #10–#14
--   #11: Excluir contratos con start_date > p_effective_date de anexos/movimientos
--        de cambio salarial y actualizar su snapshot inicial si inician después.
--   #12: Bajas con fecha futura (p_effective_date > CURRENT_DATE) se programan
--        sin cerrar puesto/contrato ni inactivar hasta que llegue la fecha.
--   #13: Cancelación automática de anexos pendientes al finalizar contrato / baja
--        + bloqueo de formalización/creación sobre contratos finalizados.
--   #14: Mensaje descriptivo de fecha anterior en reincorporate_worker.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- #11: salary_change_impact + apply_salary_group_value_change + finalize_salary_change_event
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salary_change_impact(
  p_salary_group_id uuid,
  p_new_amount numeric,
  p_effective_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  worker_id uuid,
  worker_code text,
  worker_name text,
  identification text,
  area_name text,
  job_name text,
  position_name text,
  group_sequence_number integer,
  previous_amount numeric,
  currency_code text,
  contract_id uuid,
  contract_start_date date,
  contract_type_name text,
  assignment_id uuid,
  position_id uuid,
  job_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  WITH ctx AS (
    SELECT COALESCE(p_effective_date, CURRENT_DATE) AS ref_date
  ),
  base AS (
    SELECT
      w.id AS wid,
      w.code AS wcode,
      btrim(concat_ws(' ', w.first_name, w.first_surname, w.second_surname)) AS wname,
      w.identification AS wci,
      ar.name AS aname,
      j.name AS jname,
      p.name AS pname,
      g.sequence_number AS gseq,
      COALESCE(prev.amount, public.worker_last_recorded_salary(w.id, ctx.ref_date)) AS prev_amount,
      COALESCE(prev.currency_code, s.currency_code, 'CUP') AS cur_code,
      c.id AS cid,
      c.start_date AS cstart,
      ct.name AS ctname,
      a.id AS aid,
      p.id AS pid,
      j.id AS jid
    FROM public.workers w
    CROSS JOIN ctx
    JOIN public.worker_position_assignments a
      ON a.worker_id = w.id AND a.is_current = true AND a.end_date IS NULL
    JOIN public.organization_positions p ON p.id = a.position_id
    JOIN public.organization_jobs j ON j.id = p.job_id
    JOIN public.salary_groups g ON g.id = j.salary_group_id
    JOIN public.salary_scales s ON s.id = g.salary_scale_id
    LEFT JOIN public.organization_areas ar ON ar.id = j.area_id
    LEFT JOIN public.employment_contracts c
      ON c.worker_id = w.id AND c.assignment_id = a.id AND c.is_current = true
    LEFT JOIN public.employment_contract_types ct ON ct.id = c.contract_type_id
    LEFT JOIN LATERAL public.resolve_salary_group_value(g.id, ctx.ref_date - 1) prev ON true
    WHERE w.employment_status = 'active'
      AND g.id = p_salary_group_id
      -- Solo trabajadores cuyo contrato/asignación vigente ya comenzó en o antes de la fecha efectiva
      AND COALESCE(c.start_date, a.start_date) <= ctx.ref_date
      AND public.resolve_salary_scale_for_entity(w.organization_entity_id) = g.salary_scale_id
      AND public.can_manage_salary_scale(g.salary_scale_id)
  )
  SELECT wid, wcode, wname, wci, aname, jname, pname, gseq, prev_amount, cur_code,
         cid, cstart, ctname, aid, pid, jid
  FROM base
  WHERE prev_amount IS NOT NULL
    AND prev_amount <> p_new_amount
  ORDER BY wname;
$function$;

CREATE OR REPLACE FUNCTION public.apply_salary_group_value_change(
  p_salary_group_id uuid,
  p_new_amount numeric,
  p_currency_code text DEFAULT NULL::text,
  p_effective_from date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_group public.salary_groups%ROWTYPE;
  v_scale public.salary_scales%ROWTYPE;
  v_existing public.salary_group_values%ROWTYPE;
  v_currency text;
  v_effective date;
  v_prev_amount numeric;
  v_prev_from date;
  v_value_id uuid;
  v_worker record;
  v_future_contract record;
  v_components_total numeric;
  v_entity_id uuid;
  v_has_contract_access boolean := false;
  v_history_id uuid;
  v_addendum_id uuid;
  v_number integer;
  v_totals jsonb;
  v_total_before numeric;
  v_total_after numeric;
  v_history_count integer := 0;
  v_addendum_count integer := 0;
  v_affected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RAISE EXCEPTION 'El nuevo importe debe ser mayor que cero';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'La fecha efectiva es obligatoria';
  END IF;

  v_effective := p_effective_from;

  SELECT * INTO v_group FROM public.salary_groups WHERE id = p_salary_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El grupo salarial no existe';
  END IF;
  IF COALESCE(v_group.is_active, false) = false THEN
    RAISE EXCEPTION 'El grupo salarial no está activo';
  END IF;

  SELECT * INTO v_scale FROM public.salary_scales WHERE id = v_group.salary_scale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La escala salarial no existe';
  END IF;
  PERFORM 1 FROM public.salary_groups WHERE id = p_salary_group_id FOR UPDATE;

  IF NOT public.can_manage_salary_scale(v_scale.id) THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar la escala salarial';
  END IF;
  IF COALESCE(v_scale.is_active, false) = false THEN
    RAISE EXCEPTION 'La escala salarial no está activa';
  END IF;

  v_currency := COALESCE(nullif(btrim(coalesce(p_currency_code, '')), ''), v_scale.currency_code, 'CUP');

  -- Idempotencia: mismo grupo y misma fecha de vigencia
  SELECT * INTO v_existing FROM public.salary_group_values
  WHERE salary_group_id = p_salary_group_id AND effective_from = v_effective;
  IF FOUND THEN
    IF v_existing.amount = p_new_amount AND v_existing.currency_code = v_currency THEN
      RETURN jsonb_build_object(
        'status', 'UNCHANGED',
        'salary_group_value_id', v_existing.id,
        'salary_group_id', p_salary_group_id,
        'previous_amount', v_existing.amount,
        'new_amount', v_existing.amount,
        'currency_code', v_existing.currency_code,
        'effective_date', v_effective,
        'workers_affected', 0,
        'salary_history_created', 0,
        'addendums_created', 0
      );
    END IF;
    RAISE EXCEPTION 'Ya existe un valor salarial para este grupo con esa fecha de vigencia';
  END IF;

  SELECT r.amount, r.effective_from INTO v_prev_amount, v_prev_from
  FROM public.resolve_salary_group_value(p_salary_group_id, v_effective - 1) r;

  INSERT INTO public.salary_group_values (
    salary_group_id, amount, currency_code, effective_from, effective_to, is_active, created_by
  ) VALUES (
    p_salary_group_id, p_new_amount, v_currency, v_effective, NULL, false, auth.uid()
  ) RETURNING id INTO v_value_id;

  PERFORM public.recompute_salary_group_value_chain(p_salary_group_id);

  -- Contratos vigentes que INICIAN DESPUÉS de la fecha efectiva (c.start_date > v_effective):
  -- no reciben anexo salarial ni movimiento REUBICACION; si su fecha de inicio queda cubierta
  -- por esta nueva vigencia salarial, su salario inicial contratado adopta el nuevo importe.
  FOR v_future_contract IN
    SELECT c.id AS contract_id, c.worker_id, c.start_date
    FROM public.employment_contracts c
    JOIN public.worker_position_assignments a ON a.id = c.assignment_id
    JOIN public.organization_positions p ON p.id = a.position_id
    JOIN public.organization_jobs j ON j.id = p.job_id
    JOIN public.workers w ON w.id = c.worker_id
    CROSS JOIN LATERAL public.resolve_salary_group_value(j.salary_group_id, c.start_date) r
    WHERE c.is_current = true
      AND c.actual_end_date IS NULL
      AND c.start_date > v_effective
      AND w.employment_status = 'active'
      AND j.salary_group_id = p_salary_group_id
      AND public.resolve_salary_scale_for_entity(w.organization_entity_id) = v_scale.id
      AND r.salary_group_value_id = v_value_id
  LOOP
    SELECT COALESCE(SUM(comp.amount), 0) INTO v_components_total
    FROM public.employment_contract_compensation_components comp
    WHERE comp.employment_contract_id = v_future_contract.contract_id
      AND comp.addendum_id IS NULL;

    UPDATE public.employment_contracts
    SET salary_group_value_id = v_value_id,
        salary_amount = p_new_amount,
        salary_currency_code = v_currency,
        total_compensation_snapshot = p_new_amount + COALESCE(v_components_total, 0),
        updated_at = now()
    WHERE id = v_future_contract.contract_id;

    UPDATE public.worker_salary_history
    SET salary_group_value_id = v_value_id,
        new_amount = p_new_amount,
        currency_code = v_currency
    WHERE employment_contract_id = v_future_contract.contract_id
      AND change_type IN ('INITIAL_CONTRACT', 'REINCORPORATION', 'CONTRACT_CHANGE')
      AND effective_date = v_future_contract.start_date;
  END LOOP;

  -- Histórico salarial y anexos pendientes solo para contratos ya vigentes en v_effective
  IF v_prev_amount IS NOT NULL AND v_prev_amount <> p_new_amount THEN
    FOR v_worker IN
      SELECT * FROM public.salary_change_impact(p_salary_group_id, p_new_amount, v_effective)
    LOOP
      v_affected := v_affected + 1;

      v_history_id := public.record_worker_salary_event(
        v_worker.worker_id,
        v_worker.contract_id,
        v_worker.assignment_id,
        p_salary_group_id,
        v_scale.id,
        v_value_id,
        v_worker.previous_amount,
        p_new_amount,
        v_currency,
        v_effective,
        'SALARY_SCALE_CHANGE',
        p_notes
      );

      IF v_history_id IS NOT NULL THEN
        v_history_count := v_history_count + 1;
        v_addendum_id := NULL;

        IF v_worker.contract_id IS NOT NULL THEN
          INSERT INTO public.contract_addendums (
            company_client_id, organization_entity_id, worker_id, employment_contract_id,
            salary_history_id, addendum_type, document_type_id, status, effective_date,
            reason_code, reason, salary_group_id, salary_scale_id,
            previous_amount, new_amount, currency_code,
            position_id, job_id, source_type, source_id, notes, created_by
          )
          SELECT
            w.company_client_id, w.organization_entity_id, v_worker.worker_id, v_worker.contract_id,
            v_history_id, 'SALARY_CHANGE_ADDENDUM', 'CONTRACT_ADDENDUM', 'PENDING_TEMPLATE', v_effective,
            'SALARY_CHANGE', 'Cambio salarial por modificación de la escala',
            p_salary_group_id, v_scale.id,
            v_worker.previous_amount, p_new_amount, v_currency,
            v_worker.position_id, v_worker.job_id,
            'SALARY_SCALE_CHANGE', v_value_id,
            nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
          FROM public.workers w
          WHERE w.id = v_worker.worker_id
          ON CONFLICT DO NOTHING
          RETURNING id INTO v_addendum_id;
        END IF;

        IF v_addendum_id IS NOT NULL THEN
          v_addendum_count := v_addendum_count + 1;
          v_number := public.assign_addendum_number(v_addendum_id);

          SELECT w.organization_entity_id INTO v_entity_id
          FROM public.workers w WHERE w.id = v_worker.worker_id;

          v_has_contract_access :=
            public.can_access_entity(v_entity_id, 'workers.view')
            OR public.can_access_entity(v_entity_id, 'workers.manage');

          IF v_has_contract_access THEN
            v_totals := public.contract_formalized_totals(v_worker.contract_id);
            v_total_before := COALESCE(
              nullif(v_totals->>'total_compensation', '')::numeric,
              COALESCE(v_worker.previous_amount, 0)
            );
            v_total_after := p_new_amount + COALESCE(nullif(v_totals->>'components_total', '')::numeric, 0);
          ELSE
            SELECT COALESCE(ec.total_compensation_snapshot, COALESCE(v_worker.previous_amount, 0))
            INTO v_total_before
            FROM public.employment_contracts ec
            WHERE ec.id = v_worker.contract_id;
            v_total_after := COALESCE(v_total_before, 0) - COALESCE(v_worker.previous_amount, 0) + p_new_amount;
          END IF;

          UPDATE public.contract_addendums
          SET total_before = v_total_before,
              total_after = v_total_after,
              updated_at = now()
          WHERE id = v_addendum_id;

          INSERT INTO public.employment_contract_addendum_changes (
            company_client_id, organization_entity_id, addendum_id, field_code,
            old_value, new_value, old_display_value, new_display_value, display_order
          )
          SELECT
            w.company_client_id, w.organization_entity_id, v_addendum_id, 'SALARY',
            v_worker.previous_amount::text, p_new_amount::text,
            public.format_amount_text(v_worker.previous_amount) || ' ' || v_currency,
            public.format_amount_text(p_new_amount) || ' ' || v_currency,
            6
          FROM public.workers w
          WHERE w.id = v_worker.worker_id;

          INSERT INTO public.employment_contract_addendum_changes (
            company_client_id, organization_entity_id, addendum_id, field_code,
            old_value, new_value, old_display_value, new_display_value, display_order
          )
          SELECT
            w.company_client_id, w.organization_entity_id, v_addendum_id, 'TOTAL_COMPENSATION',
            v_total_before::text, v_total_after::text,
            public.format_amount_text(v_total_before) || ' ' || v_currency,
            public.format_amount_text(v_total_after) || ' ' || v_currency,
            16
          FROM public.workers w
          WHERE w.id = v_worker.worker_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'status', 'APPLIED',
    'salary_group_value_id', v_value_id,
    'salary_group_id', p_salary_group_id,
    'salary_scale_id', v_scale.id,
    'previous_amount', v_prev_amount,
    'previous_effective_from', v_prev_from,
    'new_amount', p_new_amount,
    'currency_code', v_currency,
    'effective_date', v_effective,
    'workers_affected', v_affected,
    'salary_history_created', v_history_count,
    'addendums_created', v_addendum_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_salary_change_event(
  p_salary_group_id uuid,
  p_effective_date date,
  p_description text,
  p_workers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_worker uuid;
  v_prev numeric;
  v_tenant uuid;
  v_event uuid;
  v_seq integer;
  v_created int := 0;
  v_skipped int := 0;
  v_batches jsonb;
  v_rec record;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if p_salary_group_id is null or p_effective_date is null then
    raise exception 'El grupo salarial y la fecha efectiva son obligatorios';
  end if;
  if not public.can_manage_salary_scale((select sg.salary_scale_id from public.salary_groups sg where sg.id = p_salary_group_id)) then
    raise exception 'Permiso denegado: se requiere salary.manage sobre la escala del grupo salarial';
  end if;

  select sg.sequence_number into v_seq from public.salary_groups sg where sg.id = p_salary_group_id;

  if p_workers is not null and jsonb_array_length(p_workers) > 0 then
    select w.company_client_id into v_tenant
    from public.workers w where w.id = ((p_workers->0->>'worker_id')::uuid);
  end if;

  insert into public.document_generation_events (
    company_client_id, organization_entity_id, event_type, description, effective_date, metadata, created_by
  ) values (
    coalesce(v_tenant, gen_random_uuid()), null, 'SALARY_SCALE_CHANGE',
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Cambio salarial'),
    p_effective_date,
    jsonb_build_object('salary_group_id', p_salary_group_id, 'sequence_number', v_seq),
    auth.uid()
  ) returning id into v_event;

  for v_worker in
    select distinct (item->>'worker_id')::uuid
    from jsonb_array_elements(coalesce(p_workers, '[]'::jsonb)) item
    where coalesce(item->>'worker_id', '') <> ''
  loop
    select nullif(item->>'previous_amount', '')::numeric into v_prev
    from jsonb_array_elements(coalesce(p_workers, '[]'::jsonb)) item
    where (item->>'worker_id')::uuid = v_worker
    limit 1;

    for v_rec in
      select a.id as assignment_id, a.position_id
      from public.worker_position_assignments a
      join public.workers w on w.id = a.worker_id
      join public.organization_positions p on p.id = a.position_id
      join public.organization_jobs j on j.id = p.job_id
      left join public.employment_contracts c on c.assignment_id = a.id and c.is_current = true
      where a.worker_id = v_worker
        and a.is_current = true
        and a.end_date is null
        and w.employment_status = 'active'
        and j.salary_group_id = p_salary_group_id
        and coalesce(c.start_date, a.start_date) <= p_effective_date
      order by a.start_date
    loop
      begin
        perform public.create_payroll_movement(
          v_worker, 'REUBICACION', p_effective_date,
          v_rec.position_id, v_rec.position_id, v_rec.assignment_id, v_event,
          v_prev, v_seq, null, v_seq
        );
        v_created := v_created + 1;
      exception when others then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  v_batches := public.create_document_batches_for_event(v_event);

  return jsonb_build_object(
    'event_id', v_event,
    'movements_created', v_created,
    'movements_skipped', v_skipped,
    'batches', v_batches->'batches'
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- #13: Cancelación automática de anexos pendientes al cerrar contrato + guardas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_cancel_pending_addendums_on_contract_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF (NEW.is_current = false OR NEW.actual_end_date IS NOT NULL)
     AND (OLD.is_current IS DISTINCT FROM NEW.is_current OR OLD.actual_end_date IS DISTINCT FROM NEW.actual_end_date) THEN
    UPDATE public.contract_addendums
    SET status = 'CANCELLED',
        cancelled_at = COALESCE(cancelled_at, now()),
        cancellation_reason = COALESCE(
          nullif(btrim(cancellation_reason), ''),
          'Cancelado automáticamente al finalizar el contrato o causar baja el trabajador'
        ),
        updated_at = now()
    WHERE employment_contract_id = NEW.id
      AND status IN ('PENDING_TEMPLATE', 'READY_TO_GENERATE', 'GENERATION_ERROR');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS employment_contracts_cancel_pending_addendums ON public.employment_contracts;
CREATE TRIGGER employment_contracts_cancel_pending_addendums
AFTER UPDATE OF is_current, actual_end_date ON public.employment_contracts
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_cancel_pending_addendums_on_contract_close();

CREATE OR REPLACE FUNCTION public.trg_fn_guard_contract_addendum_active_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_contract public.employment_contracts%ROWTYPE;
  v_worker_status text;
BEGIN
  IF NEW.status <> 'CANCELLED' AND NEW.employment_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.employment_contracts WHERE id = NEW.employment_contract_id;
    SELECT employment_status INTO v_worker_status FROM public.workers WHERE id = NEW.worker_id;
    IF NOT FOUND OR v_contract.is_current = false OR v_contract.actual_end_date IS NOT NULL OR v_worker_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'El trabajador no tiene un contrato vigente sobre el que formalizar el anexo';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS contract_addendums_guard_active_contract ON public.contract_addendums;
CREATE TRIGGER contract_addendums_guard_active_contract
BEFORE INSERT ON public.contract_addendums
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_guard_contract_addendum_active_contract();

-- Backfill: cancelar anexos pendientes huérfanos en contratos ya cerrados
UPDATE public.contract_addendums ca
SET status = 'CANCELLED',
    cancelled_at = COALESCE(ca.cancelled_at, now()),
    cancellation_reason = COALESCE(
      nullif(btrim(ca.cancellation_reason), ''),
      'Cancelado automáticamente: el contrato vinculado ya había finalizado'
    ),
    updated_at = now()
FROM public.employment_contracts ec
WHERE ca.employment_contract_id = ec.id
  AND (ec.is_current = false OR ec.actual_end_date IS NOT NULL)
  AND ca.status IN ('PENDING_TEMPLATE', 'READY_TO_GENERATE', 'GENERATION_ERROR');

CREATE OR REPLACE FUNCTION public.pending_addendum_checklist(p_addendum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_addendum public.contract_addendums%ROWTYPE;
  v_entity public.organization_entities%ROWTYPE;
  v_contract public.employment_contracts%ROWTYPE;
  v_blocking text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_item text;
  v_rep_valid boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_addendum FROM public.contract_addendums WHERE id = p_addendum_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anexo no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_addendum.organization_entity_id, 'workers.view') THEN
    RAISE EXCEPTION 'No tiene permiso para consultar anexos de esta entidad';
  END IF;

  IF v_addendum.status = 'CANCELLED' THEN
    v_blocking := array_append(v_blocking, 'El anexo está cancelado');
  END IF;

  IF v_addendum.employment_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.employment_contracts WHERE id = v_addendum.employment_contract_id;
    IF FOUND AND (v_contract.is_current = false OR v_contract.actual_end_date IS NOT NULL) THEN
      v_blocking := array_append(v_blocking, 'El contrato vinculado ya finalizó');
    END IF;
  END IF;

  IF v_addendum.effective_date IS NULL THEN
    v_blocking := array_append(v_blocking, 'Fecha efectiva');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employment_contract_addendum_changes c
    WHERE c.addendum_id = v_addendum.id
  ) THEN
    v_blocking := array_append(v_blocking, 'Condiciones anteriores y nuevas');
  END IF;

  IF v_addendum.signature_date IS NULL THEN
    v_blocking := array_append(v_blocking, 'Fecha de firma');
  END IF;
  IF btrim(coalesce(v_addendum.signature_place, '')) = '' THEN
    v_blocking := array_append(v_blocking, 'Lugar de firma');
  END IF;

  IF v_addendum.representative_assignment_id IS NULL THEN
    v_blocking := array_append(v_blocking, 'Representante autorizado vigente en la fecha de firma');
  ELSIF v_addendum.signature_date IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organization_representative_assignments ra
      JOIN public.organization_representative_positions rp ON rp.id = ra.representative_position_id
      WHERE ra.id = v_addendum.representative_assignment_id
        AND rp.organization_entity_id = v_addendum.organization_entity_id
        AND ra.effective_from <= v_addendum.signature_date
        AND (ra.effective_to IS NULL OR ra.effective_to >= v_addendum.signature_date)
    ) INTO v_rep_valid;
    IF NOT v_rep_valid THEN
      v_blocking := array_append(v_blocking, 'Representante autorizado vigente en la fecha de firma');
    END IF;
  END IF;

  SELECT * INTO v_entity FROM public.organization_entities WHERE id = v_addendum.organization_entity_id;
  IF NOT FOUND THEN
    v_blocking := array_append(v_blocking, 'Entidad contractual');
  ELSE
    FOREACH v_item IN ARRAY ARRAY[
      CASE WHEN btrim(coalesce(v_entity.organism, '')) = '' THEN 'Organismo al que pertenece' END,
      CASE WHEN btrim(coalesce(v_entity.branch, '')) = '' THEN 'Rama' END,
      CASE WHEN btrim(coalesce(v_entity.labor_identification_code, '')) = '' THEN 'Código de identificación laboral/organizacional' END,
      CASE WHEN btrim(coalesce(v_entity.address, '')) = '' THEN 'Dirección' END,
      CASE WHEN btrim(coalesce(v_entity.province, '')) = '' THEN 'Provincia' END,
      CASE WHEN btrim(coalesce(v_entity.municipality, '')) = '' THEN 'Municipio' END
    ]
    LOOP
      IF v_item IS NOT NULL THEN
        v_blocking := array_append(v_blocking, v_item);
      END IF;
    END LOOP;
  END IF;

  IF btrim(coalesce(v_addendum.worker_profession_snapshot, '')) = '' THEN
    v_warnings := array_append(v_warnings, 'Profesión u oficio de la persona');
  END IF;
  IF FOUND AND v_contract.salary_snapshot_status IS DISTINCT FROM 'CAPTURED' THEN
    v_warnings := array_append(v_warnings, 'Salario de escala formalizado en el contrato');
  END IF;

  RETURN jsonb_build_object(
    'blocking', to_jsonb(v_blocking),
    'warnings', to_jsonb(v_warnings),
    'status', v_addendum.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.formalize_contract_addendum(
  p_addendum_id uuid,
  p_signature_date date DEFAULT NULL::date,
  p_signature_place text DEFAULT NULL::text,
  p_representative_assignment_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_addendum public.contract_addendums%ROWTYPE;
  v_contract public.employment_contracts%ROWTYPE;
  v_signature date;
  v_place text;
  v_rep uuid;
  v_checklist jsonb;
  v_blocking text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_addendum FROM public.contract_addendums WHERE id = p_addendum_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anexo no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_addendum.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar anexos de esta entidad';
  END IF;

  IF v_addendum.status = 'FORMALIZED' THEN
    RAISE EXCEPTION 'El anexo ya está formalizado: su contenido histórico no puede modificarse';
  END IF;
  IF v_addendum.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'El anexo está cancelado y no puede formalizarse';
  END IF;
  IF v_addendum.status NOT IN ('PENDING_TEMPLATE', 'READY_TO_GENERATE', 'GENERATION_ERROR') THEN
    RAISE EXCEPTION 'El anexo no está en un estado que permita su formalización';
  END IF;

  IF v_addendum.employment_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.employment_contracts WHERE id = v_addendum.employment_contract_id;
    IF FOUND AND (v_contract.is_current = false OR v_contract.actual_end_date IS NOT NULL) THEN
      UPDATE public.contract_addendums
      SET status = 'CANCELLED',
          cancelled_at = COALESCE(cancelled_at, now()),
          cancellation_reason = 'Cancelado automáticamente: el contrato vinculado ya finalizó',
          updated_at = now()
      WHERE id = p_addendum_id;
      RAISE EXCEPTION 'No se puede formalizar el anexo porque el contrato vinculado ya finalizó';
    END IF;
  END IF;

  v_signature := COALESCE(p_signature_date, v_addendum.signature_date);
  v_place := COALESCE(nullif(btrim(coalesce(p_signature_place, '')), ''), v_addendum.signature_place);
  v_rep := COALESCE(p_representative_assignment_id, v_addendum.representative_assignment_id);

  UPDATE public.contract_addendums SET
    signature_date = v_signature,
    signature_place = v_place,
    updated_at = now()
  WHERE id = p_addendum_id;

  PERFORM public.capture_addendum_party_snapshot(
    p_addendum_id,
    v_rep,
    COALESCE(v_signature, v_addendum.effective_date)
  );

  v_checklist := public.pending_addendum_checklist(p_addendum_id);
  v_blocking := ARRAY(SELECT jsonb_array_elements_text(v_checklist->'blocking'));
  v_blocking := array_remove(v_blocking, NULL);
  IF array_length(v_blocking, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan datos para formalizar el anexo: %', array_to_string(v_blocking, ' · ');
  END IF;

  UPDATE public.contract_addendums SET
    status = 'FORMALIZED',
    formalized_by = auth.uid(),
    formalized_at = now(),
    updated_at = now()
  WHERE id = p_addendum_id;

  RETURN jsonb_build_object(
    'status', 'FORMALIZED',
    'addendum_id', p_addendum_id,
    'addendum_number', v_addendum.addendum_number,
    'signature_date', v_signature,
    'effective_date', v_addendum.effective_date
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- #12: Baja con fecha futura programada (scheduled_separation_*)
-- ----------------------------------------------------------------------------
ALTER TABLE public.worker_position_assignments
  ADD COLUMN IF NOT EXISTS scheduled_separation_date date,
  ADD COLUMN IF NOT EXISTS scheduled_separation_reason_id uuid REFERENCES public.worker_separation_reasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_separation_notes text;

CREATE OR REPLACE FUNCTION public.register_worker_separation(
  p_worker_id uuid,
  p_effective_date date,
  p_separation_reason_id uuid,
  p_notes text DEFAULT NULL::text,
  p_target_assignment_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_reason public.worker_separation_reasons%rowtype;
  v_remaining integer;
  v_clean_notes text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if p_effective_date is null then
    raise exception 'La fecha efectiva de baja es obligatoria';
  end if;
  if p_separation_reason_id is null then
    raise exception 'El motivo de baja es obligatorio';
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    raise exception 'Trabajador no encontrado';
  end if;
  if not public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para gestionar trabajadores de esta entidad';
  end if;
  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  select * into v_reason from public.worker_separation_reasons
  where id = p_separation_reason_id and is_active = true;
  if not found then
    raise exception 'El motivo de baja seleccionado no es válido';
  end if;

  select * into v_current from public.worker_position_assignments
  where id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  for update;

  if p_effective_date < v_current.start_date then
    raise exception 'La fecha de baja no puede ser anterior al inicio del puesto actual';
  end if;

  v_clean_notes := nullif(btrim(coalesce(p_notes, '')), '');

  -- Si la fecha efectiva es FUTURA, programar la baja sin inactivar ni liberar el puesto todavía
  if p_effective_date > CURRENT_DATE then
    if v_current.scheduled_separation_date is not null then
      raise exception 'El trabajador ya tiene una baja programada para el %',
        to_char(v_current.scheduled_separation_date, 'DD/MM/YYYY');
    end if;

    update public.worker_position_assignments
    set scheduled_separation_date = p_effective_date,
        scheduled_separation_reason_id = v_reason.id,
        scheduled_separation_notes = v_clean_notes,
        updated_at = now()
    where id = v_current.id;

    return jsonb_build_object(
      'assignment_id', v_current.id,
      'effective_date', p_effective_date,
      'separation_reason_id', v_reason.id,
      'scheduled', true,
      'remaining_active_assignments', 1
    );
  end if;

  -- Fecha efectiva <= CURRENT_DATE: aplicar baja inmediata
  update public.worker_position_assignments
  set end_date = p_effective_date,
      is_current = false,
      scheduled_separation_date = null,
      scheduled_separation_reason_id = null,
      scheduled_separation_notes = null,
      updated_at = now()
  where id = v_current.id;

  update public.employment_contracts
  set is_current = false,
      actual_end_date = p_effective_date,
      updated_at = now()
  where assignment_id = v_current.id and is_current = true;

  select count(*) into v_remaining
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id
    and a.is_current = true
    and a.end_date is null
    and a.id <> v_current.id;

  if v_remaining = 0 then
    update public.workers
    set employment_status = 'inactive', updated_at = now()
    where id = p_worker_id;
  end if;

  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, separation_reason_id, created_by
  ) values (
    p_worker_id, 'BAJA', v_current.id, null,
    p_effective_date, v_reason.name,
    v_clean_notes, v_reason.id, auth.uid()
  );

  perform public.create_payroll_movement(
    p_worker_id, 'BAJA', p_effective_date,
    v_current.position_id, null, v_current.id, v_current.id
  );

  return jsonb_build_object(
    'assignment_id', v_current.id,
    'effective_date', p_effective_date,
    'separation_reason_id', v_reason.id,
    'scheduled', false,
    'remaining_active_assignments', v_remaining
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_worker_separation(
  p_worker_id uuid,
  p_target_assignment_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_current public.worker_position_assignments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;
  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  SELECT * INTO v_current
  FROM public.worker_position_assignments
  WHERE id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  FOR UPDATE;

  IF v_current.scheduled_separation_date IS NULL THEN
    RAISE EXCEPTION 'No existe una baja programada pendiente para este puesto';
  END IF;

  UPDATE public.worker_position_assignments
  SET scheduled_separation_date = NULL,
      scheduled_separation_reason_id = NULL,
      scheduled_separation_notes = NULL,
      updated_at = now()
  WHERE id = v_current.id;

  RETURN jsonb_build_object('assignment_id', v_current.id, 'cancelled', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_due_scheduled_separations(
  p_entity_id uuid DEFAULT NULL::uuid,
  p_worker_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_row record;
  v_reason_name text;
  v_remaining integer;
  v_applied integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

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
      AND a.end_date IS NULL
      AND a.scheduled_separation_date IS NOT NULL
      AND a.scheduled_separation_date <= CURRENT_DATE
      AND w.employment_status = 'active'
      AND (p_entity_id IS NULL OR w.organization_entity_id = p_entity_id)
      AND (p_worker_id IS NULL OR w.id = p_worker_id)
      AND (
        public.can_access_entity(w.organization_entity_id, NULL)
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
      AND a2.end_date IS NULL
      AND a2.id <> v_row.assignment_id;

    IF v_remaining = 0 THEN
      UPDATE public.workers
      SET employment_status = 'inactive', updated_at = now()
      WHERE id = v_row.worker_id;
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

GRANT EXECUTE ON FUNCTION public.cancel_scheduled_worker_separation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_due_scheduled_separations(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- #14: Mensaje con fecha exacta en reincorporate_worker cuando fecha <= baja previa
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reincorporate_worker(
  p_worker_id uuid,
  p_new_position_id uuid,
  p_reincorporation_date date,
  p_contract_type_id uuid,
  p_contract_start_date date DEFAULT NULL::date,
  p_contract_end_date date DEFAULT NULL::date,
  p_notes text DEFAULT NULL::text,
  p_representative_assignment_id uuid DEFAULT NULL::uuid,
  p_signature_date date DEFAULT NULL::date,
  p_signature_place text DEFAULT NULL::text,
  p_payment_method_id uuid DEFAULT NULL::uuid,
  p_compensation_components jsonb DEFAULT NULL::jsonb,
  p_payment_schedule_text text DEFAULT NULL::text,
  p_resolution_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_position public.organization_positions%ROWTYPE;
  v_job public.organization_jobs%ROWTYPE;
  v_is_principal boolean := false;
  v_resolution_id uuid := NULL;
  v_res jsonb;
  v_contract_type public.employment_contract_types%ROWTYPE;
  v_occupied integer;
  v_new_assignment_id uuid;
  v_contract_id uuid;
  v_contract_start date;
  v_last_end date;
  v_conditions jsonb;
  v_readiness jsonb;
  v_msg text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_reincorporation_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de reincorporación es obligatoria';
  END IF;
  IF p_new_position_id IS NULL THEN
    RAISE EXCEPTION 'El puesto es obligatorio';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;
  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;
  IF v_worker.employment_status = 'active' THEN
    RAISE EXCEPTION 'El trabajador ya está activo';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.worker_position_assignments
    WHERE worker_id = p_worker_id AND is_current = true AND end_date IS NULL
  ) THEN
    RAISE EXCEPTION 'El trabajador ya tiene un puesto actual asignado';
  END IF;

  SELECT * INTO v_position FROM public.organization_positions WHERE id = p_new_position_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El puesto seleccionado no existe';
  END IF;
  IF v_position.organization_entity_id <> v_worker.organization_entity_id THEN
    RAISE EXCEPTION 'El puesto seleccionado no pertenece a la entidad del trabajador';
  END IF;
  IF NOT v_position.is_active THEN
    RAISE EXCEPTION 'El puesto seleccionado no está activo';
  END IF;

  SELECT * INTO v_job FROM public.organization_jobs WHERE id = v_position.job_id;
  v_is_principal := coalesce(v_job.is_principal_specialist, false);

  SELECT max(end_date) INTO v_last_end
  FROM public.worker_position_assignments
  WHERE worker_id = p_worker_id;
  IF v_last_end IS NOT NULL AND p_reincorporation_date <= v_last_end THEN
    RAISE EXCEPTION 'La fecha de reincorporación debe ser posterior al fin del período laboral anterior (%)',
      to_char(v_last_end, 'DD/MM/YYYY');
  END IF;

  SELECT COUNT(*) INTO v_occupied
  FROM public.worker_position_assignments a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.position_id = p_new_position_id
    AND a.is_current = true
    AND a.end_date IS NULL
    AND w.employment_status = 'active';
  IF v_occupied >= v_position.authorized_quantity THEN
    RAISE EXCEPTION 'El puesto seleccionado ya no tiene vacantes disponibles';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.company_client_id = v_worker.company_client_id
      AND w.identification = v_worker.identification
      AND w.employment_status = 'active'
      AND w.id <> p_worker_id
  ) THEN
    RAISE EXCEPTION 'Ya existe otro trabajador activo con ese carné de identidad en este workspace';
  END IF;

  IF v_is_principal THEN
    v_readiness := public.validate_resolution_readiness(
      NULL, p_worker_id, p_new_position_id,
      coalesce(p_resolution_date, p_reincorporation_date),
      p_representative_assignment_id
    );
    IF NOT (v_readiness->>'ready')::boolean THEN
      v_msg := public.format_contract_readiness_message(v_readiness->'missing', 'No se puede completar la Resolución.');
      RAISE EXCEPTION '%', COALESCE(v_msg, 'No se puede completar la Resolución: faltan datos obligatorios.');
    END IF;

    UPDATE public.workers
    SET employment_status = 'active', updated_at = now()
    WHERE id = p_worker_id;

    UPDATE public.employment_contracts
    SET is_current = false, updated_at = now()
    WHERE worker_id = p_worker_id AND is_current = true;

    INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
    VALUES (p_worker_id, p_new_position_id, p_reincorporation_date, NULL, true)
    RETURNING id INTO v_new_assignment_id;

    INSERT INTO public.worker_employment_movements (
      worker_id, movement_type, previous_assignment_id, new_assignment_id,
      effective_date, reason, notes, created_by
    ) VALUES (
      p_worker_id, 'REINCORPORACION', NULL, v_new_assignment_id,
      p_reincorporation_date, v_job.name, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
    );

    v_res := public.create_worker_resolution(
      p_worker_id, v_new_assignment_id, p_new_position_id,
      coalesce(p_resolution_date, p_reincorporation_date),
      p_representative_assignment_id, NULL, 'MOVEMENT'
    );
    v_resolution_id := (v_res->>'resolution_id')::uuid;

    RETURN jsonb_build_object(
      'assignment_id', v_new_assignment_id,
      'contract_id', NULL,
      'effective_date', p_reincorporation_date,
      'is_principal_specialist', true,
      'resolution_id', v_resolution_id
    );
  END IF;

  IF p_contract_type_id IS NULL THEN
    RAISE EXCEPTION 'El tipo de contrato es obligatorio';
  END IF;
  SELECT * INTO v_contract_type FROM public.employment_contract_types
  WHERE id = p_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  v_contract_start := coalesce(p_contract_start_date, p_reincorporation_date);
  IF v_contract_start IS NULL THEN
    RAISE EXCEPTION 'La fecha de inicio del contrato es obligatoria';
  END IF;
  IF v_contract_type.code = 'DETERMINADO' AND p_contract_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
  END IF;
  IF p_contract_end_date IS NOT NULL AND p_contract_end_date <= v_contract_start THEN
    RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
  END IF;

  v_readiness := public.validate_hiring_readiness(
    NULL, p_worker_id, p_new_position_id, p_signature_date, p_contract_type_id,
    p_signature_place, p_payment_method_id, p_representative_assignment_id,
    v_contract_start, p_contract_end_date
  );
  IF NOT (v_readiness->>'ready')::boolean THEN
    v_msg := public.format_contract_readiness_message(v_readiness->'missing');
    RAISE EXCEPTION '%', COALESCE(v_msg, 'No se puede reincorporar: faltan datos obligatorios.');
  END IF;

  UPDATE public.workers
  SET employment_status = 'active', updated_at = now()
  WHERE id = p_worker_id;

  UPDATE public.employment_contracts
  SET is_current = false, updated_at = now()
  WHERE worker_id = p_worker_id AND is_current = true;

  INSERT INTO public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
  VALUES (p_worker_id, p_new_position_id, p_reincorporation_date, NULL, true)
  RETURNING id INTO v_new_assignment_id;

  INSERT INTO public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, is_current
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_new_assignment_id,
    p_contract_type_id, v_contract_start, p_contract_end_date, true
  ) RETURNING id INTO v_contract_id;

  PERFORM public.capture_contract_salary_snapshot(v_contract_id, 'REINCORPORATION', v_contract_start, p_notes);
  PERFORM public.capture_contract_party_snapshot(
    v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, v_contract_start)
  );
  v_conditions := public.apply_contract_conditions(
    v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    nullif(btrim(coalesce(p_payment_schedule_text, '')), '')
  );

  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, created_by
  ) VALUES (
    p_worker_id, 'REINCORPORACION', NULL, v_new_assignment_id,
    p_reincorporation_date, v_contract_type.name,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'assignment_id', v_new_assignment_id,
    'contract_id', v_contract_id,
    'effective_date', p_reincorporation_date,
    'is_principal_specialist', false,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$;
