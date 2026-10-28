-- ============================================================================
-- PLURIEMPLEO — BLOQUE 3 (A): OPERACIONES CONTRACTUALES POR CONTRATO
-- Estado: APLICADA en Supabase y verificada. Este archivo incorpora ya, dentro de su
--   propio SQL, las correcciones de consolidación posteriores a la ejecución
--   (sección 2 BIS y sección 3): el anexo se formaliza sobre el contrato objetivo y el
--   contrato —con su saldo de vacaciones— se revincula al puesto al cambiar de puesto.
--
-- NO es un archivo de migración de Supabase (no vive en supabase/migrations/).
-- Se aplica tras los Bloques 1 y 2.
--
-- OBJETIVO
--   Permitir que las operaciones contractuales actúen sobre UN contrato/asignación
--   concreto cuando el trabajador tiene 2 contratos activos, sin tocar el otro y
--   conservando intacto el funcionamiento de los trabajadores con 1 solo contrato.
--
--   · `change_worker_position`      → reubica SOLO la asignación objetivo.
--   · `complete_worker_contract`    → registra el contrato de SOLO la asignación objetivo.
--   · `change_worker_contract`      → cambia el tipo de SOLO el contrato objetivo.
--   · `register_worker_separation`  → finaliza SOLO la asignación/contrato objetivo;
--                                     deja al trabajador inactivo sólo si no queda otro activo.
--
-- CÓMO SE IDENTIFICA EL CONTRATO
--   Se AÑADE un parámetro opcional final (`p_target_assignment_id` / `p_target_contract_id`).
--   Sin él: si el trabajador tiene 1 sola relación vigente se conserva el comportamiento
--   actual; si tiene 2, la operación se RECHAZA con un mensaje claro (no se elige al azar).
--   Como la firma cambia, se elimina la versión anterior para no dejar ambigüedad en PostgREST.
--   Verificado: ninguna otra función referencia estas RPC (no hay dependencias internas).
--
-- ORDEN Y DEPENDENCIAS (corregido)
--   Este archivo define TAMBIÉN `position_change_preview` con su firma de 4 argumentos,
--   porque es el único consumidor interno que usa esa firma (`change_worker_position`).
--   Antes esa función vivía en `20261029_07`, lo que creaba una dependencia circular
--   (03 → 07 para la vista previa; 07 → 03 para los resolutores) e impedía aplicar
--   cualquiera de los dos archivos por separado: en el hueco entre ambos, el cambio de
--   puesto fallaba con «function position_change_preview(uuid,uuid,date,uuid) does not
--   exist» y afectaba incluso a los trabajadores con UN solo contrato.
--   Con la definición aquí, cada archivo es autoconsistente, no se reescribe lógica
--   (la vista previa existe una sola vez) y el orden numérico 01→02→03→04→05→06→07 es
--   un orden topológico válido. No se usa DROP CASCADE en ningún punto.
--
-- ANTIGÜEDAD COMPARTIDA
--   No se toca ningún cálculo de antigüedad: sigue residiendo en el TRABAJADOR
--   (`workers.employment_start_date` / `hire_date`) y se paga en cada contrato según su
--   puesto/escala. Crear o finalizar un contrato NO reinicia ni modifica esa fecha.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. RESOLUTORES COMPARTIDOS DEL CONTRATO/ASIGNACIÓN OBJETIVO
--    Reutilizables por todas las operaciones; evitan duplicar la regla de selección.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_worker_target_assignment(
  p_worker_id uuid,
  p_assignment_id uuid default null
)
returns uuid
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare
  v_count integer;
  v_target uuid;
begin
  -- Objetivo explícito: debe estar vigente y pertenecer al trabajador.
  if p_assignment_id is not null then
    select a.id into v_target
    from public.worker_position_assignments a
    where a.id = p_assignment_id
      and a.worker_id = p_worker_id
      and a.is_current = true
      and a.end_date is null;
    if v_target is null then
      raise exception 'La asignación seleccionada no está vigente o no pertenece al trabajador';
    end if;
    return v_target;
  end if;

  select count(*) into v_count
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null;

  if v_count = 0 then
    raise exception 'El trabajador no tiene un puesto actual asignado';
  end if;

  if v_count > 1 then
    raise exception 'El trabajador tiene % contratos activos: identifique la asignación a modificar', v_count;
  end if;

  select a.id into v_target
  from public.worker_position_assignments a
  where a.worker_id = p_worker_id and a.is_current = true and a.end_date is null
  order by a.start_date desc
  limit 1;

  return v_target;
end $$;

create or replace function public.resolve_worker_target_contract(
  p_worker_id uuid,
  p_contract_id uuid default null
)
returns uuid
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
declare
  v_count integer;
  v_target uuid;
begin
  if p_contract_id is not null then
    select c.id into v_target
    from public.employment_contracts c
    where c.id = p_contract_id
      and c.worker_id = p_worker_id
      and c.is_current = true;
    if v_target is null then
      raise exception 'El contrato seleccionado no está vigente o no pertenece al trabajador';
    end if;
    return v_target;
  end if;

  select count(*) into v_count
  from public.employment_contracts c
  where c.worker_id = p_worker_id and c.is_current = true;

  if v_count = 0 then
    raise exception 'El trabajador no tiene un contrato vigente';
  end if;

  if v_count > 1 then
    raise exception 'El trabajador tiene % contratos activos: identifique el contrato a modificar', v_count;
  end if;

  select c.id into v_target
  from public.employment_contracts c
  where c.worker_id = p_worker_id and c.is_current = true
  order by c.start_date desc
  limit 1;

  return v_target;
end $$;


-- ---------------------------------------------------------------------------
-- 2. VISTA PREVIA DEL CAMBIO DE PUESTO (`position_change_preview`) — por asignación objetivo
--    Se define AQUÍ, inmediatamente ANTES de su único consumidor interno
--    (`change_worker_position`): así la dependencia entre los dos archivos es de un
--    SOLO SENTIDO (07 consume los resolutores publicados por 03) y deja de ser
--    circular. `change_worker_position` invoca la firma de 4 argumentos, que por tanto
--    existe ya cuando se aplica este archivo (ni antes ni después).
--
--    La vista previa corresponde al contrato de la ASIGNACIÓN OBJETIVO, y por tanto
--    también su cálculo salarial y los componentes/totales del anexo. La resolución
--    del objetivo se delega en `resolve_worker_target_assignment` (arriba): sin
--    duplicar la regla de selección.
-- ---------------------------------------------------------------------------
drop function if exists public.position_change_preview(uuid, uuid, date);

create or replace function public.position_change_preview(
  p_worker_id uuid,
  p_new_position_id uuid,
  p_effective_date date,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
as $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_current public.worker_position_assignments%ROWTYPE;
  v_contract public.employment_contracts%ROWTYPE;
  v_new_position public.organization_positions%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_components jsonb;
  v_components_total numeric := 0;
  v_additional numeric := 0;
  v_abnormal numeric := 0;
  v_other numeric := 0;
  v_payment_id uuid;
  v_payment_name text;
  v_currency text := 'CUP';
  v_salary_before numeric;
  v_salary_after numeric;
  v_total_before numeric := 0;
  v_total_after numeric := 0;
  v_raw jsonb;
  v_out jsonb := '[]'::jsonb;
  v_change jsonb;
  v_code text;
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

  SELECT * INTO v_new_position FROM public.organization_positions WHERE id = p_new_position_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El puesto seleccionado no existe';
  END IF;

  -- Asignación OBJETIVO: explícita o única vigente (nunca una elección arbitraria).
  SELECT * INTO v_current FROM public.worker_position_assignments
  WHERE id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id);

  -- Contrato VIGENTE de ESA asignación: es el contrato cuyo anexo se va a preparar.
  SELECT * INTO v_contract FROM public.employment_contracts
  WHERE assignment_id = v_current.id AND is_current = true
  ORDER BY start_date DESC
  LIMIT 1;

  -- Condiciones antes (posición actual, valor vigente el día anterior) y después (posición destino)
  v_before := public.contract_condition_set(v_current.position_id, p_effective_date - 1);
  v_after := public.contract_condition_set(p_new_position_id, p_effective_date);

  v_salary_before := nullif(v_before->>'salary_amount', '')::numeric;
  v_salary_after := nullif(v_after->>'salary_amount', '')::numeric;

  v_currency := COALESCE(
    nullif(v_after->>'currency_code', ''),
    nullif(v_before->>'currency_code', ''),
    v_contract.salary_currency_code,
    'CUP'
  );

  -- Componentes retributivos y forma de pago vigentes (formalizados), que no cambian con el puesto
  IF v_contract.id IS NOT NULL THEN
    v_components := public.contract_retribution_components(v_contract.id);
    SELECT COALESCE(SUM(CASE WHEN value->>'component_type' = 'ADDITIONAL_PAYMENT' THEN (value->>'amount')::numeric ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN value->>'component_type' = 'ABNORMAL_CONDITIONS' THEN (value->>'amount')::numeric ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN value->>'component_type' = 'OTHER' THEN (value->>'amount')::numeric ELSE 0 END), 0)
    INTO v_additional, v_abnormal, v_other
    FROM jsonb_array_elements(v_components);

    v_components_total := v_additional + v_abnormal + v_other;

    v_payment_id := public.contract_current_payment_method(v_contract.id);
    IF v_payment_id IS NOT NULL THEN
      SELECT name INTO v_payment_name FROM public.payment_methods WHERE id = v_payment_id;
    END IF;
  END IF;

  v_total_before := COALESCE(v_salary_before, 0) + v_components_total;
  v_total_after := COALESCE(v_salary_after, 0) + v_components_total;

  -- Diferencias contractuales representables
  v_raw := public.contract_condition_changes(
    v_before || jsonb_build_object(
      'additional_payment', v_additional,
      'abnormal_conditions', v_abnormal,
      'other_payment', v_other,
      'payment_method_id', v_payment_id,
      'total_compensation', v_total_before
    ),
    v_after || jsonb_build_object(
      'additional_payment', v_additional,
      'abnormal_conditions', v_abnormal,
      'other_payment', v_other,
      'payment_method_id', v_payment_id,
      'total_compensation', v_total_after
    )
  );

  FOR v_change IN SELECT value FROM jsonb_array_elements(v_raw)
  LOOP
    v_code := v_change->>'field_code';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'field_code', v_code,
      'field_label', v_change->>'field_label',
      'display_order', COALESCE((v_change->>'display_order')::integer, 99),
      'old_value', v_change->>'old_value',
      'new_value', v_change->>'new_value',
      'old_display_value', public.addendum_change_display(v_code, v_change->>'old_value', v_currency),
      'new_display_value', public.addendum_change_display(v_code, v_change->>'new_value', v_currency),
      'old_reference_id', v_change->>'old_reference_id',
      'new_reference_id', v_change->>'new_reference_id'
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'employment_contract_id', v_contract.id,
    'current_assignment_id', v_current.id,
    'current_position_id', v_current.position_id,
    'new_position_id', p_new_position_id,
    'effective_date', p_effective_date,
    'currency_code', v_currency,
    'salary_before', v_salary_before,
    'salary_after', v_salary_after,
    'total_before', v_total_before,
    'total_after', v_total_after,
    'components_total', v_components_total,
    'payment_method_id', v_payment_id,
    'payment_method_name', v_payment_name,
    'before', v_before,
    'after', v_after,
    'changes', v_out,
    'has_contractual_changes', jsonb_array_length(v_out) > 0
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- 2 BIS. ANEXO SOBRE EL CONTRATO OBJETIVO (`create_contract_addendum`)
--    Función PREVIA del proyecto (no creada por Pluriempleo): se publica aquí completa
--    —reproducida de Supabase— con un parámetro final opcional `p_target_contract_id`,
--    porque su ÚNICO consumidor interno es `change_worker_position` (ver más abajo) y
--    éste debe formalizar el anexo sobre el CONTRATO MODIFICADO, no sobre el contrato
--    vigente más reciente del trabajador: con 2 contratos, el anexo del cambio de puesto
--    se vinculaba al OTRO contrato (el de `start_date` mayor).
--    Sin el parámetro, la resolución del contrato es EXACTAMENTE la anterior, así que las
--    llamadas de 17 argumentos (frontend de anexos manuales) siguen funcionando igual.
--    Se define AQUÍ, antes de su consumidor y en el archivo que ya reescribe el cambio de
--    puesto: no se duplica ninguna función ni se añade un archivo nuevo.
-- ---------------------------------------------------------------------------
drop function if exists public.create_contract_addendum(
  uuid, jsonb, text, text, date, text, text, uuid, uuid, text, date, text, uuid, boolean, jsonb, numeric, numeric
);

create or replace function public.create_contract_addendum(
  p_worker_id uuid,
  p_changes jsonb,
  p_reason_code text default null,
  p_reason text default null,
  p_effective_date date default null,
  p_notes text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_salary_history_id uuid default null,
  p_addendum_type text default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_representative_assignment_id uuid default null,
  p_require_formalized boolean default false,
  p_components jsonb default null,
  p_total_before numeric default null,
  p_total_after numeric default null,
  p_target_contract_id uuid default null
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_contract public.employment_contracts%ROWTYPE;
  v_conditions jsonb;
  v_existing public.contract_addendums%ROWTYPE;
  v_addendum_id uuid;
  v_item jsonb;
  v_field text;
  v_code text;
  v_before numeric;
  v_after numeric;
  v_salary numeric;
  v_prev_additional numeric := 0;
  v_prev_abnormal numeric := 0;
  v_prev_other numeric := 0;
  v_new_additional numeric := 0;
  v_new_abnormal numeric := 0;
  v_new_other numeric := 0;
  v_components_count integer := 0;
  v_checklist jsonb;
  v_blocking text[];
  v_status text;
  v_type text;
  v_number integer;
  v_prev_payment uuid;
  v_currency text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'El trabajador es obligatorio';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar anexos de esta entidad';
  END IF;

  -- 73/74: solo puede existir un anexo sobre un contrato vigente del trabajador.
  -- Con 2 contratos vigentes, `p_target_contract_id` identifica EL contrato del anexo;
  -- sin él se mantiene la resolución histórica (el contrato vigente más reciente).
  IF p_target_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.employment_contracts
    WHERE id = public.resolve_worker_target_contract(p_worker_id, p_target_contract_id)
    FOR UPDATE;
  ELSE
    SELECT * INTO v_contract FROM public.employment_contracts
    WHERE worker_id = p_worker_id AND is_current = true
    ORDER BY start_date DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El trabajador no tiene un contrato vigente sobre el que formalizar el anexo';
  END IF;

  -- 61: idempotencia por origen
  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.contract_addendums
    WHERE employment_contract_id = v_contract.id
      AND source_type = p_source_type
      AND source_id = p_source_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'status', 'ALREADY_EXISTS',
        'addendum_id', v_existing.id,
        'addendum_number', v_existing.addendum_number,
        'addendum_status', v_existing.status,
        'total_after', v_existing.total_after
      );
    END IF;
  END IF;

  -- 14/24: un anexo agrupa 1..N cambios, nunca se crea vacío
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'Un anexo debe contener al menos un cambio de condiciones';
  END IF;

  v_code := nullif(btrim(coalesce(p_reason_code, '')), '');

  -- 65/66: el anexo manual nunca cambia Cargo/Puesto ni la escala salarial
  IF p_source_type IN ('MANUAL', 'MANUAL_COMPENSATION_CHANGE') THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes)
    LOOP
      v_field := upper(btrim(coalesce(v_item->>'field_code', '')));
      IF v_field IN ('AREA', 'JOB', 'POSITION', 'SALARY_GROUP', 'SALARY', 'OCCUPATIONAL_CATEGORY') THEN
        RAISE EXCEPTION 'El campo % no puede modificarse desde un anexo manual: use Cambiar de puesto o la escala salarial', v_field;
      END IF;
    END LOOP;
  END IF;

  v_type := CASE
    WHEN p_addendum_type IS NOT NULL THEN p_addendum_type
    WHEN v_code = 'SALARY_CHANGE' THEN 'SALARY_CHANGE_ADDENDUM'
    ELSE 'CONTRACT_VARIATION_ADDENDUM'
  END;

  IF v_type NOT IN ('SALARY_CHANGE_ADDENDUM', 'CONTRACT_VARIATION_ADDENDUM') THEN
    RAISE EXCEPTION 'El tipo de anexo no es válido';
  END IF;

  -- Totales: el backend es la autoridad y parte de las condiciones formalizadas vigentes
  v_conditions := public.contract_formalized_conditions(v_contract.id);
  v_salary := nullif(v_conditions->>'salary_amount', '')::numeric;
  v_prev_additional := COALESCE(nullif(v_conditions->>'additional_payment', '')::numeric, 0);
  v_prev_abnormal := COALESCE(nullif(v_conditions->>'abnormal_conditions', '')::numeric, 0);
  v_prev_other := COALESCE(nullif(v_conditions->>'other_payment', '')::numeric, 0);
  v_prev_payment := nullif(v_conditions->>'payment_method_id', '')::uuid;
  v_currency := COALESCE(nullif(v_conditions->>'currency_code', ''), 'CUP');

  IF p_components IS NOT NULL AND jsonb_typeof(p_components) = 'array' THEN
    SELECT COALESCE(SUM(CASE WHEN value->>'component_type' = 'ADDITIONAL_PAYMENT' THEN (value->>'amount')::numeric ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN value->>'component_type' = 'ABNORMAL_CONDITIONS' THEN (value->>'amount')::numeric ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN value->>'component_type' = 'OTHER' THEN (value->>'amount')::numeric ELSE 0 END), 0)
    INTO v_new_additional, v_new_abnormal, v_new_other
    FROM jsonb_array_elements(p_components);

    v_before := COALESCE(nullif(v_conditions->>'total_compensation', '')::numeric,
                         COALESCE(v_salary, 0) + v_prev_additional + v_prev_abnormal + v_prev_other);
    v_after := COALESCE(v_salary, 0) + v_new_additional + v_new_abnormal + v_new_other;
  ELSE
    v_before := p_total_before;
    v_after := p_total_after;
  END IF;

  INSERT INTO public.contract_addendums (
    company_client_id, organization_entity_id, worker_id, employment_contract_id,
    addendum_type, document_type_id, status, effective_date,
    reason_code, reason, notes, source_type, source_id, salary_history_id,
    total_before, total_after, currency_code, created_by
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_contract.id,
    v_type, 'CONTRACT_ADDENDUM', 'PENDING_TEMPLATE',
    COALESCE(p_effective_date, CURRENT_DATE),
    v_code,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_source_type, '')), ''),
    p_source_id,
    p_salary_history_id,
    v_before,
    v_after,
    v_currency,
    auth.uid()
  ) RETURNING id INTO v_addendum_id;

  -- Numeración por contrato, segura ante concurrencia
  v_number := public.assign_addendum_number(v_addendum_id);

  -- Cambios antes/después (snapshots: nunca se resuelven con datos vivos)
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    v_field := upper(btrim(coalesce(v_item->>'field_code', '')));
    IF v_field = '' THEN
      RAISE EXCEPTION 'Cada cambio del anexo necesita un código de campo';
    END IF;

    INSERT INTO public.employment_contract_addendum_changes (
      company_client_id, organization_entity_id, addendum_id, field_code,
      old_value, new_value, old_display_value, new_display_value,
      old_reference_id, new_reference_id, display_order
    ) VALUES (
      v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, v_field,
      v_item->>'old_value',
      v_item->>'new_value',
      COALESCE(nullif(btrim(coalesce(v_item->>'old_display_value','')), ''), v_item->>'old_value'),
      COALESCE(nullif(btrim(coalesce(v_item->>'new_display_value','')), ''), v_item->>'new_value'),
      nullif(v_item->>'old_reference_id','')::uuid,
      nullif(v_item->>'new_reference_id','')::uuid,
      COALESCE((v_item->>'display_order')::integer, 0) + 1
    );
  END LOOP;

  -- Nueva versión de conceptos retributivos vinculada al anexo (la anterior no se destruye)
  IF p_components IS NOT NULL AND jsonb_typeof(p_components) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_components)
    LOOP
      v_field := upper(btrim(coalesce(v_item->>'component_type', '')));
      IF v_field NOT IN ('ADDITIONAL_PAYMENT', 'ABNORMAL_CONDITIONS', 'OTHER') THEN
        RAISE EXCEPTION 'El tipo del concepto retributivo no es válido';
      END IF;
      IF btrim(coalesce(v_item->>'description', '')) = '' THEN
        RAISE EXCEPTION 'Cada concepto retributivo necesita una descripción';
      END IF;
      IF (v_item->>'amount') IS NULL
         OR NOT (v_item->>'amount') ~ '^-?[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION 'El importe del concepto retributivo no es válido';
      END IF;
      IF (v_item->>'amount')::numeric < 0 THEN
        RAISE EXCEPTION 'El importe del concepto retributivo no puede ser negativo';
      END IF;

      v_components_count := v_components_count + 1;

      INSERT INTO public.employment_contract_compensation_components (
        employment_contract_id, addendum_id, component_type, description, amount, display_order
      ) VALUES (
        v_contract.id, v_addendum_id, v_field,
        btrim(v_item->>'description'),
        round((v_item->>'amount')::numeric, 2),
        COALESCE((v_item->>'display_order')::integer, v_components_count)
      );
    END LOOP;

    -- Los cambios retributivos los calcula el backend (no el frontend)
    DELETE FROM public.employment_contract_addendum_changes
    WHERE addendum_id = v_addendum_id
      AND field_code IN ('ADDITIONAL_PAYMENT', 'ABNORMAL_CONDITIONS', 'OTHER_PAYMENT', 'TOTAL_COMPENSATION');

    IF v_prev_additional IS DISTINCT FROM v_new_additional THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'ADDITIONAL_PAYMENT',
        v_prev_additional::text, v_new_additional::text,
        public.format_amount_text(v_prev_additional) || ' ' || v_currency,
        public.format_amount_text(v_new_additional) || ' ' || v_currency,
        13
      );
    END IF;

    IF v_prev_abnormal IS DISTINCT FROM v_new_abnormal THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'ABNORMAL_CONDITIONS',
        v_prev_abnormal::text, v_new_abnormal::text,
        public.format_amount_text(v_prev_abnormal) || ' ' || v_currency,
        public.format_amount_text(v_new_abnormal) || ' ' || v_currency,
        14
      );
    END IF;

    IF v_prev_other IS DISTINCT FROM v_new_other THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'OTHER_PAYMENT',
        v_prev_other::text, v_new_other::text,
        public.format_amount_text(v_prev_other) || ' ' || v_currency,
        public.format_amount_text(v_new_other) || ' ' || v_currency,
        15
      );
    END IF;

    IF v_before IS DISTINCT FROM v_after THEN
      INSERT INTO public.employment_contract_addendum_changes (
        company_client_id, organization_entity_id, addendum_id, field_code,
        old_value, new_value, old_display_value, new_display_value, display_order
      ) VALUES (
        v_worker.company_client_id, v_worker.organization_entity_id, v_addendum_id, 'TOTAL_COMPENSATION',
        v_before::text, v_after::text,
        public.format_amount_text(v_before) || ' ' || v_currency,
        public.format_amount_text(v_after) || ' ' || v_currency,
        16
      );
    END IF;
  END IF;

  -- El anexo nunca puede quedar vacío de cambios
  IF NOT EXISTS (SELECT 1 FROM public.employment_contract_addendum_changes WHERE addendum_id = v_addendum_id) THEN
    RAISE EXCEPTION 'El anexo no contiene cambios reales de condiciones';
  END IF;

  -- Firma del anexo
  UPDATE public.contract_addendums SET
    signature_date = p_signature_date,
    signature_place = nullif(btrim(coalesce(p_signature_place, '')), ''),
    updated_at = now()
  WHERE id = v_addendum_id;

  PERFORM public.capture_addendum_party_snapshot(
    v_addendum_id,
    p_representative_assignment_id,
    COALESCE(p_signature_date, COALESCE(p_effective_date, CURRENT_DATE))
  );

  UPDATE public.contract_addendums SET
    payment_method_id = (
      SELECT c.new_reference_id FROM public.employment_contract_addendum_changes c
      WHERE c.addendum_id = v_addendum_id AND c.field_code = 'PAYMENT_METHOD'
    ),
    previous_payment_method_id = CASE
      WHEN EXISTS (SELECT 1 FROM public.employment_contract_addendum_changes c
                   WHERE c.addendum_id = v_addendum_id AND c.field_code = 'PAYMENT_METHOD')
      THEN v_prev_payment
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = v_addendum_id;

  v_checklist := public.pending_addendum_checklist(v_addendum_id);
  v_blocking := ARRAY(SELECT jsonb_array_elements_text(v_checklist->'blocking'));
  v_blocking := array_remove(v_blocking, NULL);

  IF array_length(v_blocking, 1) IS NULL THEN
    UPDATE public.contract_addendums
    SET status = 'FORMALIZED', formalized_by = auth.uid(), formalized_at = now(), updated_at = now()
    WHERE id = v_addendum_id;
    v_status := 'FORMALIZED';
  ELSE
    IF p_require_formalized THEN
      RAISE EXCEPTION 'No se puede formalizar el anexo. Datos pendientes: %',
        array_to_string(v_blocking, ' · ');
    END IF;
    v_status := 'PENDING_TEMPLATE';
  END IF;

  RETURN jsonb_build_object(
    'status', 'CREATED',
    'addendum_id', v_addendum_id,
    'addendum_number', v_number,
    'addendum_status', v_status,
    'employment_contract_id', v_contract.id,
    'changes', (SELECT count(*) FROM public.employment_contract_addendum_changes WHERE addendum_id = v_addendum_id),
    'components', v_components_count,
    'total_before', v_before,
    'total_after', v_after,
    'pending', to_jsonb(v_blocking)
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 3. CAMBIO DE PUESTO (`change_worker_position`) — actúa sólo sobre la asignación objetivo
-- ---------------------------------------------------------------------------
drop function if exists public.change_worker_position(
  uuid, uuid, date, text, text, boolean, date, text, uuid, text, boolean, date
);

create or replace function public.change_worker_position(
  p_worker_id uuid,
  p_new_position_id uuid,
  p_effective_date date,
  p_reason text default null,
  p_notes text default null,
  p_create_addendum boolean default true,
  p_signature_date date default null,
  p_signature_place text default null,
  p_representative_assignment_id uuid default null,
  p_reason_code text default null,
  p_require_formalized boolean default false,
  p_resolution_date date default null,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_position public.organization_positions%rowtype;
  v_job public.organization_jobs%rowtype;
  v_is_principal boolean := false;
  v_resolution_id uuid := null;
  v_occupied integer;
  v_new_assignment_id uuid;
  v_contract_id uuid;
  v_group_id uuid;
  v_scale_id uuid;
  v_value_id uuid;
  v_amount numeric;
  v_currency text;
  v_previous_salary numeric;
  v_old_group uuid;
  v_old_amount numeric;
  v_old_seq integer;
  v_history_id uuid;
  v_preview jsonb;
  v_changes jsonb;
  v_addendum jsonb := null;
  v_skipped text := null;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if p_effective_date is null then
    raise exception 'La fecha efectiva es obligatoria';
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    raise exception 'Trabajador no encontrado';
  end if;

  if not public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para gestionar trabajadores en esta entidad';
  end if;

  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  -- Asignación OBJETIVO (explícita o única vigente; si hay 2 sin identificar → error).
  select * into v_current from public.worker_position_assignments
  where id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  for update;

  if v_current.position_id = p_new_position_id then
    raise exception 'El trabajador ya ocupa el puesto seleccionado';
  end if;

  if p_effective_date <= v_current.start_date then
    raise exception 'La fecha efectiva debe ser posterior al inicio del puesto actual';
  end if;

  -- Snapshot salarial de la situación ANTERIOR (antes de cerrar el assignment).
  select ctx.salary_group_id, ctx.amount into v_old_group, v_old_amount
  from public.position_salary_context(v_current.position_id, p_effective_date) ctx;
  if v_old_group is not null then
    select sg.sequence_number into v_old_seq from public.salary_groups sg where sg.id = v_old_group;
  end if;

  select * into v_position from public.organization_positions where id = p_new_position_id for update;
  if not found then
    raise exception 'El puesto seleccionado no existe';
  end if;

  if v_position.organization_entity_id <> v_worker.organization_entity_id then
    raise exception 'El puesto seleccionado no pertenece a la entidad del trabajador';
  end if;

  if not v_position.is_active then
    raise exception 'El puesto seleccionado no está activo';
  end if;

  select * into v_job from public.organization_jobs where id = v_position.job_id;
  v_is_principal := coalesce(v_job.is_principal_specialist, false);

  select count(*) into v_occupied
  from public.worker_position_assignments a
  join public.workers w on w.id = a.worker_id
  where a.position_id = p_new_position_id and a.is_current = true and a.end_date is null
    and w.employment_status = 'active';

  if v_occupied >= v_position.authorized_quantity then
    raise exception 'El puesto seleccionado ya no tiene vacantes disponibles';
  end if;

  -- Contrato VIGENTE de ESTA asignación (no el del trabajador en general).
  select id into v_contract_id
  from public.employment_contracts
  where assignment_id = v_current.id and is_current = true
  order by start_date desc limit 1;

  -- La vista previa corresponde a la MISMA asignación objetivo (y por tanto al mismo
  -- contrato) que se va a mover: nunca a una asignación arbitraria.
  v_preview := public.position_change_preview(
    p_worker_id, p_new_position_id, p_effective_date, v_current.id
  );
  v_changes := coalesce(v_preview->'changes', '[]'::jsonb);

  update public.worker_position_assignments
  set end_date = p_effective_date - 1, is_current = false, updated_at = now()
  where id = v_current.id;

  insert into public.worker_position_assignments (worker_id, position_id, start_date, end_date, is_current)
  values (p_worker_id, p_new_position_id, p_effective_date, null, true)
  returning id into v_new_assignment_id;

  -- El CONTRATO (y lo que cuelga de él) acompaña al puesto nuevo. Sin esto, el contrato
  -- seguía apuntando a la asignación cerrada y, en las operaciones siguientes,
  -- `v_contract_id` (arriba) quedaba nulo: el anexo se omitía como NO_CONTRACT, el
  -- histórico salarial se registraba sin contrato, la prenómina por contrato perdía el
  -- vínculo y el saldo de vacaciones del contrato se leía 0 (los movimientos seguían en
  -- la asignación anterior). Sólo se mueven los datos DE ESTE contrato: el otro no se toca.
  if v_contract_id is not null then
    update public.employment_contracts
    set assignment_id = v_new_assignment_id, updated_at = now()
    where id = v_contract_id;

    update public.worker_vacations
    set assignment_id = v_new_assignment_id, updated_at = now()
    where worker_id = p_worker_id and assignment_id = v_current.id;

    update public.worker_vacation_movements
    set assignment_id = v_new_assignment_id
    where worker_id = p_worker_id and assignment_id = v_current.id;
  end if;

  insert into public.worker_employment_movements (
    worker_id, movement_type, previous_assignment_id, new_assignment_id,
    effective_date, reason, notes, created_by
  ) values (
    p_worker_id, 'CAMBIO_PUESTO', v_current.id, v_new_assignment_id,
    p_effective_date,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  );

  select ctx.salary_group_id, ctx.salary_scale_id, ctx.salary_group_value_id, ctx.amount, ctx.currency_code
  into v_group_id, v_scale_id, v_value_id, v_amount, v_currency
  from public.position_salary_context(p_new_position_id, p_effective_date) ctx;

  if v_amount is not null then
    v_previous_salary := public.worker_last_recorded_salary(p_worker_id, p_effective_date);
    if v_previous_salary is distinct from v_amount then
      v_history_id := public.record_worker_salary_event(
        p_worker_id, v_contract_id, v_new_assignment_id,
        v_group_id, v_scale_id, v_value_id,
        v_previous_salary, v_amount, v_currency, p_effective_date,
        'POSITION_CHANGE', p_reason
      );
    end if;
  end if;

  if v_is_principal then
    v_resolution_id := (public.create_worker_resolution(
      p_worker_id, v_new_assignment_id, p_new_position_id,
      coalesce(p_resolution_date, p_effective_date),
      p_representative_assignment_id, null, 'MOVEMENT'
    )->>'resolution_id')::uuid;
    v_skipped := 'PRINCIPAL_SPECIALIST';
  elsif p_create_addendum and jsonb_array_length(v_changes) > 0 then
    if v_contract_id is null then
      v_skipped := 'NO_CONTRACT';
    else
      -- El anexo se formaliza sobre EL contrato que se está moviendo (`v_contract_id`),
      -- no sobre el contrato vigente más reciente del trabajador (parámetro 18).
      v_addendum := public.create_contract_addendum(
        p_worker_id, v_changes,
        coalesce(nullif(btrim(coalesce(p_reason_code, '')), ''), 'POSITION_CHANGE'),
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cambio de puesto'),
        p_effective_date, p_notes, 'POSITION_CHANGE', v_new_assignment_id, v_history_id,
        'CONTRACT_VARIATION_ADDENDUM', p_signature_date, p_signature_place,
        p_representative_assignment_id, p_require_formalized, null,
        (v_preview->>'total_before')::numeric, (v_preview->>'total_after')::numeric, v_contract_id
      );
    end if;
  end if;

  -- Movimiento de Nómina: REUBICACIÓN de ESTE contrato. `event_id = nueva asignación`
  -- identifica el movimiento y evita colisiones si el otro contrato se reubica el mismo día.
  perform public.create_payroll_movement(
    p_worker_id, 'REUBICACION', p_effective_date,
    v_current.position_id, p_new_position_id, v_new_assignment_id, v_new_assignment_id,
    v_old_amount, v_old_seq, v_amount, null
  );

  return jsonb_build_object(
    'previous_assignment_id', v_current.id,
    'new_assignment_id', v_new_assignment_id,
    'effective_date', p_effective_date,
    'employment_contract_id', v_contract_id,
    'salary_history_id', v_history_id,
    'changes', v_changes,
    'has_contractual_changes', jsonb_array_length(v_changes) > 0,
    'is_principal_specialist', v_is_principal,
    'resolution_id', v_resolution_id,
    'addendum_skipped', v_skipped,
    'addendum', v_addendum
  );
end $$;


-- ---------------------------------------------------------------------------
-- 4. REGISTRAR CONTRATO (`complete_worker_contract`) — sólo la asignación objetivo
-- ---------------------------------------------------------------------------
drop function if exists public.complete_worker_contract(
  uuid, uuid, date, date, uuid, date, text, uuid, jsonb, text
);

create or replace function public.complete_worker_contract(
  p_worker_id uuid,
  p_contract_type_id uuid,
  p_contract_start_date date,
  p_contract_end_date date default null,
  p_representative_assignment_id uuid default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_payment_method_id uuid default null,
  p_compensation_components jsonb default null,
  p_payment_schedule_text text default null,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_assignment_id uuid;
  v_contract_type public.employment_contract_types%ROWTYPE;
  v_contract_id uuid;
  v_has_previous boolean;
  v_previous_schedule text;
  v_conditions jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  -- Asignación OBJETIVO (explícita o única vigente).
  v_assignment_id := public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id);

  -- Validar tipo de contrato (catálogo global de SiteCorp)
  SELECT * INTO v_contract_type FROM public.employment_contract_types
  WHERE id = p_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  IF p_contract_start_date IS NULL THEN
    RAISE EXCEPTION 'La fecha de inicio del contrato es obligatoria';
  END IF;

  IF v_contract_type.code = 'DETERMINADO' AND p_contract_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de fin';
  END IF;

  IF p_contract_end_date IS NOT NULL AND p_contract_end_date <= p_contract_start_date THEN
    RAISE EXCEPTION 'La fecha de fin del contrato debe ser posterior a su inicio';
  END IF;

  -- Cerrar el contrato vigente de ESTA asignación (si existe), preservando su día/momento
  -- de pago como prellenado del nuevo (Fase 11A.7 §8). NO toca el otro contrato.
  SELECT payment_schedule_text INTO v_previous_schedule
  FROM public.employment_contracts
  WHERE assignment_id = v_assignment_id AND is_current = true
  ORDER BY start_date DESC
  LIMIT 1;

  v_has_previous := EXISTS (
    SELECT 1 FROM public.employment_contracts
    WHERE assignment_id = v_assignment_id AND is_current = true
  );

  UPDATE public.employment_contracts
  SET is_current = false, updated_at = now()
  WHERE assignment_id = v_assignment_id AND is_current = true;

  -- Registrar nuevo contrato vigente para la asignación objetivo
  INSERT INTO public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, is_current
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment_id,
    p_contract_type_id, p_contract_start_date, p_contract_end_date, true
  ) RETURNING id INTO v_contract_id;

  -- Fase 11A: snapshot salarial contractual e histórico salarial (por contrato)
  PERFORM public.capture_contract_salary_snapshot(
    v_contract_id,
    CASE WHEN v_has_previous THEN 'CONTRACT_CHANGE' ELSE 'INITIAL_CONTRACT' END,
    p_contract_start_date,
    NULL
  );
  PERFORM public.capture_contract_party_snapshot(
    v_contract_id, p_representative_assignment_id, coalesce(p_signature_date, p_contract_start_date)
  );

  -- Condiciones contractuales del NUEVO contrato (firma, pago, retribución, prellenado)
  v_conditions := public.apply_contract_conditions(
    v_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    COALESCE(nullif(btrim(coalesce(p_payment_schedule_text, '')), ''), v_previous_schedule)
  );

  RETURN jsonb_build_object(
    'contract_id', v_contract_id,
    'assignment_id', v_assignment_id,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 5. CAMBIO DE CONTRATO (`change_worker_contract`) — sólo el contrato objetivo
-- ---------------------------------------------------------------------------
drop function if exists public.change_worker_contract(
  uuid, uuid, date, date, text, uuid, date, text, uuid, jsonb, text
);

create or replace function public.change_worker_contract(
  p_worker_id uuid,
  p_new_contract_type_id uuid,
  p_effective_date date,
  p_new_end_date date default null,
  p_notes text default null,
  p_representative_assignment_id uuid default null,
  p_signature_date date default null,
  p_signature_place text default null,
  p_payment_method_id uuid default null,
  p_compensation_components jsonb default null,
  p_payment_schedule_text text default null,
  p_target_contract_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_current public.employment_contracts%ROWTYPE;
  v_type public.employment_contract_types%ROWTYPE;
  v_assignment_id uuid;
  v_new_contract_id uuid;
  v_conditions jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'La fecha efectiva es obligatoria';
  END IF;

  IF p_new_contract_type_id IS NULL THEN
    RAISE EXCEPTION 'El nuevo tipo de contrato es obligatorio';
  END IF;

  -- Bloquear al trabajador (serializa cambios contractuales concurrentes)
  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabajador no encontrado';
  END IF;

  IF NOT public.can_access_entity(v_worker.organization_entity_id, 'workers.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores de esta entidad';
  END IF;

  IF v_worker.employment_status <> 'active' THEN
    RAISE EXCEPTION 'El trabajador no está activo';
  END IF;

  SELECT * INTO v_type FROM public.employment_contract_types
  WHERE id = p_new_contract_type_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tipo de contrato seleccionado no es válido';
  END IF;

  -- Contrato OBJETIVO (explícito o único vigente) bloqueado.
  SELECT * INTO v_current FROM public.employment_contracts
  WHERE id = public.resolve_worker_target_contract(p_worker_id, p_target_contract_id)
  FOR UPDATE;

  IF p_effective_date <= v_current.start_date THEN
    RAISE EXCEPTION 'La fecha efectiva debe ser posterior al inicio del contrato vigente';
  END IF;

  IF v_type.code = 'DETERMINADO' AND p_new_end_date IS NULL THEN
    RAISE EXCEPTION 'El contrato por tiempo determinado requiere una fecha de finalización';
  END IF;

  IF p_new_end_date IS NOT NULL AND p_new_end_date <= p_effective_date THEN
    RAISE EXCEPTION 'La fecha de finalización debe ser posterior a la fecha efectiva';
  END IF;

  -- La asignación es la del CONTRATO objetivo: NO se modifica (sólo se referencia).
  v_assignment_id := v_current.assignment_id;

  -- 1) Cerrar SÓLO el contrato objetivo (se conserva como histórico). El otro contrato no se toca.
  UPDATE public.employment_contracts
  SET is_current = false,
      actual_end_date = p_effective_date - 1,
      updated_at = now()
  WHERE id = v_current.id;

  -- 2) Crear el nuevo contrato vigente sobre la misma asignación.
  INSERT INTO public.employment_contracts (
    company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
    start_date, end_date, actual_end_date, is_current
  ) VALUES (
    v_worker.company_client_id, v_worker.organization_entity_id, p_worker_id, v_assignment_id,
    p_new_contract_type_id, p_effective_date,
    CASE WHEN v_type.code = 'DETERMINADO' THEN p_new_end_date ELSE NULL END,
    NULL, true
  ) RETURNING id INTO v_new_contract_id;

  PERFORM public.capture_contract_salary_snapshot(v_new_contract_id, 'CONTRACT_CHANGE', p_effective_date, p_notes);
  PERFORM public.capture_contract_party_snapshot(
    v_new_contract_id, p_representative_assignment_id, coalesce(p_signature_date, p_effective_date)
  );

  v_conditions := public.apply_contract_conditions(
    v_new_contract_id, p_signature_date, p_signature_place, p_payment_method_id,
    p_compensation_components, p_representative_assignment_id,
    COALESCE(nullif(btrim(coalesce(p_payment_schedule_text, '')), ''), v_current.payment_schedule_text)
  );

  -- 3) Bitácora del evento contractual
  INSERT INTO public.worker_employment_movements (
    worker_id, movement_type, previous_contract_id, new_contract_id,
    effective_date, reason, notes, created_by
  ) VALUES (
    p_worker_id, 'CAMBIO_CONTRATO', v_current.id, v_new_contract_id,
    p_effective_date, v_type.name,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'previous_contract_id', v_current.id,
    'new_contract_id', v_new_contract_id,
    'effective_date', p_effective_date,
    'total_compensation_snapshot', v_conditions->'total_compensation_snapshot'
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 6. FINALIZACIÓN POR CONTRATO (`register_worker_separation`) — sólo la asignación objetivo
--    Cierra únicamente esa asignación y su contrato; el trabajador permanece activo si
--    conserva otro contrato vigente y sólo pasa a inactivo cuando no queda ninguno.
-- ---------------------------------------------------------------------------
drop function if exists public.register_worker_separation(uuid, date, uuid, text);

create or replace function public.register_worker_separation(
  p_worker_id uuid,
  p_effective_date date,
  p_separation_reason_id uuid,
  p_notes text default null,
  p_target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_worker public.workers%rowtype;
  v_current public.worker_position_assignments%rowtype;
  v_reason public.worker_separation_reasons%rowtype;
  v_remaining integer;
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
    raise exception 'No tiene permiso para gestionar trabajadores en esta entidad';
  end if;

  if v_worker.employment_status <> 'active' then
    raise exception 'El trabajador no está activo';
  end if;

  select * into v_reason from public.worker_separation_reasons
  where id = p_separation_reason_id and is_active = true;
  if not found then
    raise exception 'El motivo de baja seleccionado no es válido';
  end if;

  -- Asignación OBJETIVO (explícita o única vigente; si hay 2 sin identificar → error).
  select * into v_current from public.worker_position_assignments
  where id = public.resolve_worker_target_assignment(p_worker_id, p_target_assignment_id)
  for update;

  if p_effective_date < v_current.start_date then
    raise exception 'La fecha de baja no puede ser anterior al inicio del puesto actual';
  end if;

  -- Cerrar SÓLO la asignación objetivo.
  update public.worker_position_assignments
  set end_date = p_effective_date,
      is_current = false,
      updated_at = now()
  where id = v_current.id;

  -- Cerrar SÓLO los contratos vigentes de esa asignación.
  update public.employment_contracts
  set is_current = false,
      actual_end_date = p_effective_date,
      updated_at = now()
  where assignment_id = v_current.id and is_current = true;

  -- El trabajador sigue activo mientras conserve OTRO contrato vigente.
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
    nullif(btrim(coalesce(p_notes, '')), ''), v_reason.id, auth.uid()
  );

  -- Movimiento de Nómina: BAJA de ESTE contrato. `event_id = asignación` evita colisiones
  -- si el otro contrato se finaliza el mismo día.
  perform public.create_payroll_movement(
    p_worker_id, 'BAJA', p_effective_date,
    v_current.position_id, null, v_current.id, v_current.id
  );

  return jsonb_build_object(
    'assignment_id', v_current.id,
    'effective_date', p_effective_date,
    'separation_reason_id', v_reason.id,
    'remaining_active_assignments', v_remaining
  );
end $$;


-- ---------------------------------------------------------------------------
-- 7. PERMISOS
-- ---------------------------------------------------------------------------
grant execute on function public.resolve_worker_target_assignment(uuid, uuid) to authenticated;
grant execute on function public.resolve_worker_target_contract(uuid, uuid) to authenticated;
revoke execute on function public.resolve_worker_target_assignment(uuid, uuid) from public, anon;
revoke execute on function public.resolve_worker_target_contract(uuid, uuid) from public, anon;

grant execute on function public.position_change_preview(uuid, uuid, date, uuid) to authenticated, service_role;
revoke execute on function public.position_change_preview(uuid, uuid, date, uuid) from public, anon;

grant execute on function public.change_worker_position(
  uuid, uuid, date, text, text, boolean, date, text, uuid, text, boolean, date, uuid
) to authenticated;
revoke execute on function public.change_worker_position(
  uuid, uuid, date, text, text, boolean, date, text, uuid, text, boolean, date, uuid
) from public, anon;

grant execute on function public.complete_worker_contract(
  uuid, uuid, date, date, uuid, date, text, uuid, jsonb, text, uuid
) to authenticated;
revoke execute on function public.complete_worker_contract(
  uuid, uuid, date, date, uuid, date, text, uuid, jsonb, text, uuid
) from public, anon;

grant execute on function public.change_worker_contract(
  uuid, uuid, date, date, text, uuid, date, text, uuid, jsonb, text, uuid
) to authenticated;
revoke execute on function public.change_worker_contract(
  uuid, uuid, date, date, text, uuid, date, text, uuid, jsonb, text, uuid
) from public, anon;

grant execute on function public.register_worker_separation(uuid, date, uuid, text, uuid) to authenticated;
revoke execute on function public.register_worker_separation(uuid, date, uuid, text, uuid) from public, anon;

-- Anexo sobre el contrato objetivo (sección 2 BIS): la firma de 18 argumentos sustituye
-- a la de 17, por lo que la nueva firma necesita sus permisos explícitos (igual que las
-- demás RPC de este bloque). Sin `p_target_contract_id` el comportamiento no cambia.
grant execute on function public.create_contract_addendum(
  uuid, jsonb, text, text, date, text, text, uuid, uuid, text, date, text, uuid, boolean, jsonb, numeric, numeric, uuid
) to authenticated, service_role;
revoke execute on function public.create_contract_addendum(
  uuid, jsonb, text, text, date, text, text, uuid, uuid, text, date, text, uuid, boolean, jsonb, numeric, numeric, uuid
) from public, anon;


-- ============================================================================
-- FIN DEL BLOQUE 3 (A) — APLICADO en Supabase (con las correcciones de consolidación).
-- ============================================================================
