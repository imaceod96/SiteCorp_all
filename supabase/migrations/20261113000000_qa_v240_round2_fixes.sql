-- =============================================================================
-- Migración: Correcciones QA Ronda 2 (v2.4.0)
-- =============================================================================
-- 1. Limpieza idempotente de restos de `code` en áreas, cargos y puestos,
--    incluyendo funciones huérfanas `generate_area_code` / `generate_job_code`.
-- 2. Corrige `public.save_position_with_schedule`:
--    - Elimina la inserción errónea de `company_client_id` (columna inexistente en
--      `organization_positions` y `position_schedule_segments`).
--    - Incluye `position_order` obligatorio en `INSERT INTO public.organization_positions`.
--    - Incluye `crosses_midnight` obligatorio en `INSERT INTO public.position_schedule_segments`.
-- 3. Corrige RPCs residuales en producción que aún leían columnas `code` eliminadas:
--    - `capture_contract_structure_snapshot(uuid, date)` (`v_position.code` -> `NULL::text`)
--    - `contract_condition_set(uuid, date)` (`v_position.code` -> `NULL::text`)
--    - `contract_formalized_conditions(uuid)` (`pos.code` -> `NULL::text`)
--    - `entity_positions_anexo14(uuid, boolean, uuid, uuid)` (`ar.code::text` -> `NULL::text`)
-- 4. Reclasifica el análisis cacheado (`document_template_versions.analysis`) de
--    plantillas en borrador ya analizadas contra el catálogo `document_variables`
--    actualizado para que puedan activarse sin bloqueo falso.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Limpieza idempotente de restos de `code` en áreas, cargos y puestos
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT
      t.tgname AS trigger_name,
      c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname IN ('organization_areas', 'organization_jobs', 'organization_positions')
      AND NOT t.tgisinternal
      AND (
        t.tgname ILIKE '%code%'
        OR p.proname ILIKE '%code%'
        OR pg_get_functiondef(p.oid) ILIKE '%NEW.code%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', rec.trigger_name, rec.table_name);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.generate_area_code(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.generate_job_code(uuid, text, text) CASCADE;

ALTER TABLE public.organization_areas
  DROP CONSTRAINT IF EXISTS organization_areas_organization_entity_id_code_unique,
  DROP CONSTRAINT IF EXISTS organization_areas_tenant_entity_code_unique,
  DROP CONSTRAINT IF EXISTS organization_areas_entity_code_unique,
  DROP CONSTRAINT IF EXISTS organization_areas_code_key;

ALTER TABLE public.organization_jobs
  DROP CONSTRAINT IF EXISTS organization_jobs_organization_entity_id_code_unique,
  DROP CONSTRAINT IF EXISTS organization_jobs_tenant_entity_code_unique,
  DROP CONSTRAINT IF EXISTS organization_jobs_entity_code_unique,
  DROP CONSTRAINT IF EXISTS organization_jobs_code_key;

ALTER TABLE public.organization_positions
  DROP CONSTRAINT IF EXISTS organization_positions_organization_entity_id_code_unique,
  DROP CONSTRAINT IF EXISTS organization_positions_tenant_entity_code_unique,
  DROP CONSTRAINT IF EXISTS organization_positions_entity_code_unique,
  DROP CONSTRAINT IF EXISTS organization_positions_code_key;

ALTER TABLE public.organization_areas
  DROP COLUMN IF EXISTS code CASCADE;

ALTER TABLE public.organization_jobs
  DROP COLUMN IF EXISTS code CASCADE;

ALTER TABLE public.organization_positions
  DROP COLUMN IF EXISTS code CASCADE;

-- Asegurar defaults seguros en columnas obligatorias de puestos y horarios
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_positions'
      AND column_name = 'position_order'
  ) THEN
    ALTER TABLE public.organization_positions
      ALTER COLUMN position_order SET DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'position_schedule_segments'
      AND column_name = 'crosses_midnight'
  ) THEN
    ALTER TABLE public.position_schedule_segments
      ALTER COLUMN crosses_midnight SET DEFAULT false;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Reemplazar `public.save_position_with_schedule` sin columnas inexistentes
--    y con `position_order` + `crosses_midnight`
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  IF to_regclass('public.password_gate_wrapped_functions') IS NOT NULL THEN
    DELETE FROM public.password_gate_wrapped_functions
    WHERE function_signature ILIKE '%save_position_with_schedule%';
  END IF;

  FOR rec IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS ident_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname = 'save_position_with_schedule'
        OR p.proname LIKE 'save_position_with_schedule\_\_pcgate\_%'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE;', rec.proname, rec.ident_args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.save_position_with_schedule(
  p_entity_id uuid,
  p_position_id uuid,
  p_job_id uuid,
  p_name text,
  p_description text,
  p_authorized_quantity integer,
  p_work_location text,
  p_daily_hours numeric,
  p_weekly_hours numeric,
  p_monthly_hours numeric,
  p_break_minutes integer,
  p_schedule_notes text,
  p_segments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_entity_exists boolean := false;
  v_job public.organization_jobs%ROWTYPE;
  v_jobcard jsonb;
  v_pos_id uuid;
  v_next_order integer := 1;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_location text := nullif(btrim(coalesce(p_work_location, '')), '');
  v_notes text := nullif(btrim(coalesce(p_schedule_notes, '')), '');
  v_seg_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF to_regprocedure('public.assert_password_change_allowed()') IS NOT NULL THEN
    PERFORM public.assert_password_change_allowed();
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'La entidad es obligatoria';
  END IF;

  IF NOT public.can_access_entity(p_entity_id, 'staffing.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar la estructura de puestos de esta entidad';
  END IF;

  SELECT true INTO v_entity_exists
  FROM public.organization_entities
  WHERE id = p_entity_id;

  IF NOT COALESCE(v_entity_exists, false) THEN
    RAISE EXCEPTION 'La entidad seleccionada no existe';
  END IF;

  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'El cargo es obligatorio';
  END IF;

  SELECT * INTO v_job
  FROM public.organization_jobs
  WHERE id = p_job_id
    AND organization_entity_id = p_entity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cargo seleccionado no pertenece a esta entidad';
  END IF;

  v_jobcard := public.validate_job_contract_readiness(p_job_id);
  IF NOT COALESCE((v_jobcard ->> 'ready')::boolean, false) THEN
    RAISE EXCEPTION '%', public.format_contract_readiness_message(
      v_jobcard -> 'missing',
      'No se puede guardar el puesto porque el cargo está incompleto.'
    );
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'El nombre del puesto es obligatorio';
  END IF;

  IF p_authorized_quantity IS NULL OR p_authorized_quantity < 1 THEN
    RAISE EXCEPTION 'La cantidad autorizada de plazas debe ser mayor o igual a 1';
  END IF;

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'El lugar de trabajo es obligatorio';
  END IF;

  IF p_daily_hours IS NULL OR p_daily_hours <= 0
     OR p_weekly_hours IS NULL OR p_weekly_hours <= 0
     OR p_monthly_hours IS NULL OR p_monthly_hours <= 0 THEN
    RAISE EXCEPTION 'La jornada es obligatoria: horas diarias, semanales y mensuales deben ser mayores que 0';
  END IF;

  IF p_break_minutes IS NULL OR p_break_minutes < 0 THEN
    RAISE EXCEPTION 'El tiempo de descanso es obligatorio';
  END IF;

  IF p_segments IS NOT NULL AND jsonb_typeof(p_segments) = 'array' THEN
    v_seg_count := jsonb_array_length(p_segments);
  END IF;

  IF v_seg_count = 0 AND v_notes IS NULL THEN
    RAISE EXCEPTION 'El horario es obligatorio: añade segmentos de horario o una descripción';
  END IF;

  IF p_position_id IS NOT NULL THEN
    UPDATE public.organization_positions
    SET job_id = p_job_id,
        name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        authorized_quantity = p_authorized_quantity,
        work_location = v_location,
        daily_hours = p_daily_hours,
        weekly_hours = p_weekly_hours,
        monthly_hours = p_monthly_hours,
        break_minutes = p_break_minutes,
        schedule_notes = v_notes,
        updated_at = now()
    WHERE id = p_position_id
      AND organization_entity_id = p_entity_id
    RETURNING id INTO v_pos_id;

    IF v_pos_id IS NULL THEN
      RAISE EXCEPTION 'Puesto no encontrado en esta entidad';
    END IF;
  ELSE
    SELECT COALESCE(MAX(position_order), 0) + 1
      INTO v_next_order
      FROM public.organization_positions
     WHERE organization_entity_id = p_entity_id
       AND job_id = p_job_id;

    INSERT INTO public.organization_positions (
      organization_entity_id,
      job_id,
      name,
      description,
      position_order,
      authorized_quantity,
      work_location,
      daily_hours,
      weekly_hours,
      monthly_hours,
      break_minutes,
      schedule_notes,
      is_active
    ) VALUES (
      p_entity_id,
      p_job_id,
      v_name,
      nullif(btrim(coalesce(p_description, '')), ''),
      v_next_order,
      p_authorized_quantity,
      v_location,
      p_daily_hours,
      p_weekly_hours,
      p_monthly_hours,
      p_break_minutes,
      v_notes,
      true
    )
    RETURNING id INTO v_pos_id;
  END IF;

  DELETE FROM public.position_schedule_segments
  WHERE position_id = v_pos_id;

  IF v_seg_count > 0 THEN
    INSERT INTO public.position_schedule_segments (
      organization_entity_id,
      position_id,
      day_of_week,
      start_time,
      end_time,
      crosses_midnight,
      display_order
    )
    SELECT
      p_entity_id,
      v_pos_id,
      (seg ->> 'day_of_week')::integer,
      (seg ->> 'start_time')::time,
      (seg ->> 'end_time')::time,
      COALESCE(
        NULLIF(seg ->> 'crosses_midnight', '')::boolean,
        (seg ->> 'end_time')::time < (seg ->> 'start_time')::time
      ),
      COALESCE((seg ->> 'display_order')::integer, ord::integer)
    FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS t(seg, ord);
  END IF;

  RETURN v_pos_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_position_with_schedule(uuid, uuid, uuid, text, text, integer, text, numeric, numeric, numeric, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_position_with_schedule(uuid, uuid, uuid, text, text, integer, text, numeric, numeric, numeric, integer, text, jsonb) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Corregir funciones residuales que aún referenciaban `.code` eliminado
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
  v_def text;
  v_new_def text;
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'capture_contract_structure_snapshot',
        'contract_condition_set',
        'contract_formalized_conditions',
        'entity_positions_anexo14'
      )
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    v_new_def := v_def;

    -- Quitar `v_position.code` en `capture_contract_structure_snapshot` y `contract_condition_set`
    v_new_def := replace(
      v_new_def,
      'nullif(btrim(coalesce(v_position.code, '''')), '''')',
      'NULL::text'
    );
    v_new_def := replace(v_new_def, 'v_position.code', 'NULL::text');

    -- Quitar `pos.code` en `contract_formalized_conditions`
    v_new_def := regexp_replace(
      v_new_def,
      'SELECT\s+pos\.code,\s*pos\.break_minutes\s+INTO',
      'SELECT NULL::text, pos.break_minutes INTO',
      'gi'
    );

    -- Quitar `ar.code` en `entity_positions_anexo14`
    v_new_def := regexp_replace(
      v_new_def,
      '\m(ar|a)\.code(?:::text)?\s+AS\s+area_code\M',
      'NULL::text AS area_code',
      'gi'
    );

    IF v_new_def <> v_def THEN
      EXECUTE v_new_def;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Reclasificar análisis cacheados de versiones DRAFT contra el catálogo oficial
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
  v_recognized jsonb;
  v_unknown jsonb;
  v_incompatible jsonb;
  v_required jsonb;
  v_warnings jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_template_versions'
  ) THEN
    FOR rec IN
      SELECT id, document_type_code, analysis
      FROM public.document_template_versions
      WHERE status = 'DRAFT'
        AND analysis IS NOT NULL
    LOOP
      SELECT
        coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'count', x.count, 'split_runs', x.split_runs) ORDER BY x.sort_order) FILTER (WHERE x.state = 'RECOGNIZED'), '[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'count', x.count) ORDER BY x.sort_order) FILTER (WHERE x.state = 'UNKNOWN'), '[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'label', x.label, 'count', x.count) ORDER BY x.sort_order) FILTER (WHERE x.state = 'INCOMPATIBLE'), '[]'::jsonb),
        coalesce(jsonb_agg(to_jsonb(x.key) ORDER BY x.sort_order) FILTER (WHERE x.state = 'RECOGNIZED'), '[]'::jsonb)
      INTO v_recognized, v_unknown, v_incompatible, v_required
      FROM (
        SELECT
          o.occ->>'key' AS key,
          coalesce((o.occ->>'count')::integer, 0) AS count,
          coalesce((o.occ->>'split_runs')::integer, 0) AS split_runs,
          coalesce((o.occ->>'sort_order')::integer, 0) AS sort_order,
          d.label AS label,
          CASE
            WHEN d.key IS NULL THEN 'UNKNOWN'
            WHEN rec.document_type_code = ANY(d.document_types) THEN 'RECOGNIZED'
            ELSE 'INCOMPATIBLE'
          END AS state
        FROM jsonb_array_elements(coalesce(rec.analysis->'occurrences', '[]'::jsonb)) AS o(occ)
        LEFT JOIN public.document_variables d ON d.key = o.occ->>'key'
        WHERE coalesce(btrim(o.occ->>'key'), '') <> ''
      ) AS x;

      SELECT coalesce(jsonb_agg(w.val), '[]'::jsonb)
        INTO v_warnings
        FROM jsonb_array_elements(coalesce(rec.analysis->'warnings', '[]'::jsonb)) AS w(val)
       WHERE NOT (jsonb_array_length(v_required) > 0 AND w.val::text ILIKE '%no contiene variables dinámicas%');

      UPDATE public.document_template_versions
         SET analysis = rec.analysis || jsonb_build_object(
               'recognized', v_recognized,
               'required_variables', v_required,
               'unknown_variables', v_unknown,
               'incompatible_variables', v_incompatible,
               'warnings', v_warnings
             ),
             updated_at = now()
       WHERE id = rec.id;
    END LOOP;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Eliminar sobrecarga ambigua de `public.validate_hiring_readiness`
--    (dos firmas con los mismos 10 nombres de parámetro en distinto orden
--    causaban error 42725 en PostgREST al invocar por nombre). Se conserva el
--    orden posicional usado por `hire_candidate` / `reincorporate_worker` /
--    `create_worker_pluriemploy` con el chequeo de autorización S3 completo.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_hiring_readiness(
  uuid, uuid, uuid, uuid, date, date, date, text, uuid, uuid
) CASCADE;

CREATE OR REPLACE FUNCTION public.validate_hiring_readiness(
  p_candidate_id uuid DEFAULT NULL::uuid,
  p_worker_id uuid DEFAULT NULL::uuid,
  p_position_id uuid DEFAULT NULL::uuid,
  p_signature_date date DEFAULT NULL::date,
  p_contract_type_id uuid DEFAULT NULL::uuid,
  p_signature_place text DEFAULT NULL::text,
  p_payment_method_id uuid DEFAULT NULL::uuid,
  p_representative_assignment_id uuid DEFAULT NULL::uuid,
  p_contract_start_date date DEFAULT NULL::date,
  p_contract_end_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_missing jsonb := '[]'::jsonb;
  v_sections jsonb;
  v_pos public.organization_positions%ROWTYPE;
  v_entity_id uuid;
  v_card jsonb;
  v_pending jsonb;
  v_item text;
  v_section text;
  v_type_code text;
  v_start date;
  v_auth_entity uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- S3: autorización por identidad y ámbito organizativo (plaza -> trabajador -> candidato)
  IF p_position_id IS NOT NULL THEN
    SELECT p.organization_entity_id INTO v_auth_entity FROM public.organization_positions p WHERE p.id = p_position_id;
  END IF;
  IF v_auth_entity IS NULL AND p_worker_id IS NOT NULL THEN
    SELECT w.organization_entity_id INTO v_auth_entity FROM public.workers w WHERE w.id = p_worker_id;
  END IF;
  IF v_auth_entity IS NULL AND p_candidate_id IS NOT NULL THEN
    SELECT c.organization_entity_id INTO v_auth_entity FROM public.candidates c WHERE c.id = p_candidate_id;
  END IF;

  IF v_auth_entity IS NOT NULL AND NOT (public.can_access_entity(v_auth_entity, NULL) OR public.has_platform_permission('salary.manage')) THEN
    RAISE EXCEPTION 'Permiso denegado: sin autoridad sobre la entidad de la contratación';
  END IF;

  -- Puesto: resuelve la entidad y valida estructura del puesto (incluye cargo)
  IF p_position_id IS NOT NULL THEN
    SELECT * INTO v_pos FROM public.organization_positions WHERE id = p_position_id;
    IF FOUND THEN
      v_entity_id := v_pos.organization_entity_id;
      v_card := public.validate_position_contract_readiness(p_position_id);
      v_missing := v_missing || (v_card->'missing');
    ELSE
      v_missing := v_missing || jsonb_build_object('code','position','label','Puesto','source','position','sourceId',p_position_id,'section','Puesto');
    END IF;
  ELSE
    v_missing := v_missing || jsonb_build_object('code','position','label','Puesto','source','position','sourceId',NULL,'section','Puesto');
  END IF;

  -- Datos personales: el trabajador es la fuente de verdad en reincorporaciones
  IF p_worker_id IS NOT NULL THEN
    v_card := public.validate_worker_contract_readiness(p_worker_id);
    v_missing := v_missing || (v_card->'missing');
  ELSIF p_candidate_id IS NOT NULL THEN
    v_card := public.validate_candidate_contract_readiness(p_candidate_id);
    v_missing := v_missing || (v_card->'missing');
  END IF;

  -- Entidad contractual
  IF v_entity_id IS NOT NULL THEN
    v_card := public.validate_entity_contract_readiness(v_entity_id);
    v_missing := v_missing || (v_card->'missing');
  END IF;

  -- Condiciones contractuales (escala salarial, firma, pago, representante vigente)
  IF v_entity_id IS NOT NULL THEN
    v_pending := public.pending_contract_formalization(
      v_entity_id, p_position_id, p_signature_date, p_signature_place,
      p_payment_method_id, p_representative_assignment_id
    );
    FOR v_item IN SELECT jsonb_array_elements_text(COALESCE(v_pending->'blocking','[]'::jsonb)) LOOP
      v_section := CASE
        WHEN v_item ILIKE '%representante%' THEN 'Representante'
        WHEN v_item ILIKE '%Entidad%' THEN 'Entidad'
        ELSE 'Contrato'
      END;
      v_missing := v_missing || jsonb_build_object(
        'code','contract.pending','label',v_item,'source','contract','sourceId',NULL,'section',v_section);
    END LOOP;
  END IF;

  -- Tipo de contrato / fechas
  IF p_contract_type_id IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.type','label','Tipo de contrato','source','contract','sourceId',NULL,'section','Contrato');
  ELSE
    SELECT code INTO v_type_code FROM public.employment_contract_types WHERE id = p_contract_type_id AND is_active = true;
    IF v_type_code IS NULL THEN
      v_missing := v_missing || jsonb_build_object('code','contract.type','label','Tipo de contrato válido','source','contract','sourceId',NULL,'section','Contrato');
    END IF;
  END IF;

  v_start := COALESCE(p_contract_start_date, p_signature_date);
  IF v_start IS NULL THEN
    v_missing := v_missing || jsonb_build_object('code','contract.start_date','label','Fecha de inicio','source','contract','sourceId',NULL,'section','Contrato');
  END IF;

  IF v_type_code = 'DETERMINADO' THEN
    IF p_contract_end_date IS NULL THEN
      v_missing := v_missing || jsonb_build_object('code','contract.end_date','label','Fecha de fin (contrato determinado)','source','contract','sourceId',NULL,'section','Contrato');
    ELSIF v_start IS NOT NULL AND p_contract_end_date <= v_start THEN
      v_missing := v_missing || jsonb_build_object('code','contract.end_date_order','label','Fecha de fin posterior al inicio','source','contract','sourceId',NULL,'section','Contrato');
    END IF;
  ELSIF p_contract_end_date IS NOT NULL AND v_start IS NOT NULL AND p_contract_end_date <= v_start THEN
    v_missing := v_missing || jsonb_build_object('code','contract.end_date_order','label','Fecha de fin posterior al inicio','source','contract','sourceId',NULL,'section','Contrato');
  END IF;

  -- Agrupar por sección (orden contractual)
  SELECT COALESCE(jsonb_agg(sec ORDER BY ord), '[]'::jsonb) INTO v_sections
  FROM (
    SELECT s AS label, o AS ord,
           jsonb_build_object(
             'key', s,
             'label', s,
             'ready', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_missing) e WHERE e->>'section' = s),
             'missing', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(v_missing) e WHERE e->>'section' = s), '[]'::jsonb)
           ) AS sec
    FROM (VALUES ('Entidad',1),('Representante',2),('Candidato',3),('Trabajador',4),('Cargo',5),('Puesto',6),('Contrato',7)) AS t(s,o)
  ) q;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing, 'sections', v_sections);
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_hiring_readiness(uuid, uuid, uuid, date, uuid, text, uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_hiring_readiness(uuid, uuid, uuid, date, uuid, text, uuid, uuid, date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
