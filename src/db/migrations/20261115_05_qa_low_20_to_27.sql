-- =============================================================================
-- QA Fixes #20, #24 & #27 (Bajos):
--   #20 / #24: Normalización de descripciones de cambio salarial ("Grupo Grupo" -> "Grupo"),
--              corrección de errata "Escala Actuslizada 2026" y clasificación de
--              certificados médicos como módulo "medical_certificates" en audit_events.
--   #27: Derivación automática de sexo (gender_id) desde el 10.º dígito del CI cubano
--        (par = Masculino, impar = Femenino) en backend cuando no se envía explícitamente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #27. Resolver gender_id desde el 10.º dígito del carné de identidad cubano
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_gender_id_from_ci(p_identification text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ci text := regexp_replace(COALESCE(p_identification, ''), '\D', '', 'g');
  v_tenth integer;
  v_gender_id uuid;
BEGIN
  IF length(v_ci) < 10 THEN
    RETURN NULL;
  END IF;

  v_tenth := substring(v_ci, 10, 1)::integer;

  IF (v_tenth % 2) = 0 THEN
    SELECT g.id INTO v_gender_id
    FROM public.genders g
    WHERE g.is_active = true
      AND (lower(COALESCE(g.code, '')) IN ('m', 'male') OR lower(g.name) LIKE 'masculino%')
    ORDER BY g.created_at ASC
    LIMIT 1;
  ELSE
    SELECT g.id INTO v_gender_id
    FROM public.genders g
    WHERE g.is_active = true
      AND (lower(COALESCE(g.code, '')) IN ('f', 'female') OR lower(g.name) LIKE 'femenino%')
    ORDER BY g.created_at ASC
    LIMIT 1;
  END IF;

  RETURN v_gender_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_identification_format()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.identification IS DISTINCT FROM OLD.identification
     OR NEW.birth_date IS DISTINCT FROM OLD.birth_date THEN
    PERFORM public.validate_cuban_ci_and_birth_date(NEW.identification, NEW.birth_date);
  END IF;

  IF NEW.gender_id IS NULL AND NEW.identification IS NOT NULL THEN
    NEW.gender_id := public.resolve_gender_id_from_ci(NEW.identification);
  END IF;

  RETURN NEW;
END;
$function$;

-- Completar gender_id en candidatos y trabajadores existentes que tengan CI válido y gender_id nulo
UPDATE public.candidates
SET gender_id = public.resolve_gender_id_from_ci(identification)
WHERE gender_id IS NULL
  AND identification ~ '^[0-9]{11}$';

UPDATE public.workers
SET gender_id = public.resolve_gender_id_from_ci(identification)
WHERE gender_id IS NULL
  AND identification ~ '^[0-9]{11}$';

-- ---------------------------------------------------------------------------
-- #20 / #24. Normalizar descripción en finalize_salary_change_event y limpiar
--            erratas históricas ("Escala Actuslizada", "Grupo Grupo", módulo
--            de certificados médicos en audit_events)
-- ---------------------------------------------------------------------------
UPDATE public.salary_scales
SET name = regexp_replace(name, 'Actuslizada', 'actualizada', 'gi')
WHERE name ILIKE '%Actuslizada%';

UPDATE public.document_generation_events
SET description = regexp_replace(
  regexp_replace(description, 'Actuslizada', 'actualizada', 'gi'),
  '\mGrupo\s+Grupo\M',
  'Grupo',
  'gi'
)
WHERE description ILIKE '%Actuslizada%'
   OR description ~* '\mGrupo\s+Grupo\M';

UPDATE public.audit_events
SET module = 'medical_certificates'
WHERE module = 'vacations'
  AND (
    entity_type IN ('worker_medical_certificate', 'worker_medical_certificates')
    OR action ILIKE '%medical_certificate%'
  );

UPDATE public.audit_events
SET description = regexp_replace(
  regexp_replace(description, 'Actuslizada', 'actualizada', 'gi'),
  '\mGrupo\s+Grupo\M',
  'Grupo',
  'gi'
)
WHERE description ILIKE '%Actuslizada%'
   OR description ~* '\mGrupo\s+Grupo\M';

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
  v_clean_description text;
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

  v_clean_description := coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Cambio salarial');
  v_clean_description := regexp_replace(v_clean_description, '\mGrupo\s+Grupo\M', 'Grupo', 'gi');

  insert into public.document_generation_events (
    company_client_id, organization_entity_id, event_type, description, effective_date, metadata, created_by
  ) values (
    coalesce(v_tenant, gen_random_uuid()), null, 'SALARY_SCALE_CHANGE',
    v_clean_description,
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
      select ec.id as contract_id, wpa.id as assignment_id
      from public.employment_contracts ec
      left join public.worker_position_assignments wpa
        on wpa.id = ec.position_assignment_id
      join public.organization_positions op
        on op.id = coalesce(ec.position_id, wpa.position_id)
      join public.organization_jobs oj
        on oj.id = op.job_id
      where ec.worker_id = v_worker
        and ec.is_current = true
        and ec.status = 'active'
        and oj.salary_group_id = p_salary_group_id
        and ec.start_date <= p_effective_date
        and (ec.end_date is null or ec.end_date >= p_effective_date)
    loop
      begin
        perform public.create_payroll_movement_from_operation(
          p_worker_id             => v_worker,
          p_movement_type         => 'REUBICACION',
          p_effective_date        => p_effective_date,
          p_assignment_id         => v_rec.assignment_id,
          p_contract_id           => v_rec.contract_id,
          p_previous_assignment_id => v_rec.assignment_id,
          p_previous_contract_id  => v_rec.contract_id,
          p_reason_text           => v_clean_description,
          p_generation_event_id   => v_event,
          p_previous_base_salary_override => v_prev
        );
        v_created := v_created + 1;
      exception when others then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  v_batches := public.rebuild_event_document_batches(v_event);

  return jsonb_build_object(
    'event_id', v_event,
    'movements_created', v_created,
    'movements_skipped', v_skipped,
    'batches', v_batches
  );
end;
$function$;
