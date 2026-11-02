-- ============================================================================
-- SiteCorp · Eliminación del campo y generación automática de `code` (Código)
-- en Áreas (`organization_areas`), Cargos (`organization_jobs`) y Puestos
-- (`organization_positions`).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Eliminar triggers y funciones de generación automática de código en
--    `organization_areas`, `organization_jobs` y `organization_positions`
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  -- 1.a) Cualquier trigger en las 3 tablas cuyo nombre o función mencione `code`
  FOR rec IN
    SELECT
      t.tgname AS trigger_name,
      c.relname AS table_name,
      p.oid AS func_oid,
      p.proname AS func_name
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

  -- 1.b) Eliminar funciones de trigger dedicadas a generar código en áreas/cargos/puestos
  FOR rec IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS ident_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname IN (
          'organization_areas_generate_code',
          'organization_jobs_generate_code',
          'organization_positions_generate_code',
          'generate_organization_area_code',
          'generate_organization_job_code',
          'generate_organization_position_code',
          'trg_organization_areas_generate_code',
          'trg_organization_jobs_generate_code',
          'trg_organization_positions_generate_code',
          'set_organization_area_code',
          'set_organization_job_code',
          'set_organization_position_code'
        )
        OR (
          p.prorettype = 'trigger'::regtype
          AND (
            p.proname ILIKE '%area%code%'
            OR p.proname ILIKE '%job%code%'
            OR p.proname ILIKE '%position%code%'
          )
        )
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE;', rec.proname, rec.ident_args);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 2. Reemplazar `public.save_position_with_schedule` sin `p_code`
-- ----------------------------------------------------------------------------
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
  v_tenant_id uuid;
  v_job public.organization_jobs%ROWTYPE;
  v_jobcard jsonb;
  v_pos_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_location text := nullif(btrim(coalesce(p_work_location, '')), '');
  v_notes text := nullif(btrim(coalesce(p_schedule_notes, '')), '');
  v_seg_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'La entidad es obligatoria';
  END IF;

  IF NOT public.can_access_entity(p_entity_id, 'staffing.manage') THEN
    RAISE EXCEPTION 'No tiene permiso para gestionar la estructura de puestos de esta entidad';
  END IF;

  SELECT company_client_id INTO v_tenant_id
  FROM public.organization_entities
  WHERE id = p_entity_id;

  IF v_tenant_id IS NULL THEN
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
    INSERT INTO public.organization_positions (
      company_client_id,
      organization_entity_id,
      job_id,
      name,
      description,
      authorized_quantity,
      work_location,
      daily_hours,
      weekly_hours,
      monthly_hours,
      break_minutes,
      schedule_notes,
      is_active
    ) VALUES (
      v_tenant_id,
      p_entity_id,
      p_job_id,
      v_name,
      nullif(btrim(coalesce(p_description, '')), ''),
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
      company_client_id,
      organization_entity_id,
      position_id,
      day_of_week,
      start_time,
      end_time,
      display_order
    )
    SELECT
      v_tenant_id,
      p_entity_id,
      v_pos_id,
      (seg ->> 'day_of_week')::integer,
      (seg ->> 'start_time')::time,
      (seg ->> 'end_time')::time,
      COALESCE((seg ->> 'display_order')::integer, ord::integer)
    FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS t(seg, ord);
  END IF;

  RETURN v_pos_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_position_with_schedule(uuid, uuid, uuid, text, text, integer, text, numeric, numeric, numeric, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_position_with_schedule(uuid, uuid, uuid, text, text, integer, text, numeric, numeric, numeric, integer, text, jsonb) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. Actualizar funciones dependientes conservando sus firmas y RETURNS TABLE
--    exactos desplegados en la base de datos (evita el error 42P13)
-- ----------------------------------------------------------------------------

-- 3.1 `capture_contract_structure_snapshot` (RETURNS uuid)
CREATE OR REPLACE FUNCTION public.capture_contract_structure_snapshot(p_contract_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_contract public.employment_contracts%rowtype;
  v_position public.organization_positions%rowtype;
  v_job public.organization_jobs%rowtype;
  v_area public.organization_areas%rowtype;
  v_worker public.workers%rowtype;
  v_category text;
  v_jornada text;
  v_schedule text;
begin
  if p_contract_id is null then return null; end if;

  select * into v_contract from public.employment_contracts where id = p_contract_id for update;
  if not found then raise exception 'Contrato no encontrado'; end if;

  if not public.can_access_entity(v_contract.organization_entity_id, 'workers.manage') then
    raise exception 'No tiene permiso para gestionar contratos de esta entidad';
  end if;

  if v_contract.structure_captured_at is not null then
    return v_contract.id;
  end if;

  select * into v_worker from public.workers where id = v_contract.worker_id;

  select p.* into v_position
  from public.worker_position_assignments a
  join public.organization_positions p on p.id = a.position_id
  where a.id = v_contract.assignment_id;

  if v_position.id is not null then
    select * into v_job from public.organization_jobs where id = v_position.job_id;
    if v_job.area_id is not null then
      select * into v_area from public.organization_areas where id = v_job.area_id;
    end if;
    if v_job.occupational_category_id is not null then
      select name into v_category from public.occupational_categories where id = v_job.occupational_category_id;
    end if;
  end if;

  v_jornada := concat_ws(' · ',
    case when v_position.daily_hours is not null then public.format_hours_text(v_position.daily_hours) || ' h/día' end,
    case when v_position.weekly_hours is not null then public.format_hours_text(v_position.weekly_hours) || ' h/semana' end,
    case when v_position.monthly_hours is not null then public.format_hours_text(v_position.monthly_hours) || ' h/mes' end,
    case when v_position.break_minutes is not null then 'descanso ' || v_position.break_minutes || ' min' end
  );

  v_schedule := coalesce(
    public.format_position_schedule_text(v_position.id),
    nullif(btrim(coalesce(v_position.schedule_notes, '')), '')
  );

  update public.employment_contracts set
    area_name_snapshot = nullif(btrim(coalesce(v_area.name, '')), ''),
    job_name_snapshot = nullif(btrim(coalesce(v_job.name, '')), ''),
    occupational_category_snapshot = nullif(btrim(coalesce(v_category, '')), ''),
    position_name_snapshot = nullif(btrim(coalesce(v_position.name, '')), ''),
    position_code_snapshot = null,
    work_location_snapshot = nullif(btrim(coalesce(v_position.work_location, '')), ''),
    work_jornada_snapshot = nullif(v_jornada, ''),
    work_schedule_snapshot = nullif(v_schedule, ''),
    daily_hours_snapshot = v_position.daily_hours,
    weekly_hours_snapshot = v_position.weekly_hours,
    monthly_hours_snapshot = v_position.monthly_hours,
    break_minutes_snapshot = v_position.break_minutes,
    profession_or_trade_snapshot = nullif(btrim(coalesce(v_worker.profession_or_trade, '')), ''),
    structure_captured_at = now(),
    updated_at = now()
  where id = p_contract_id;

  return v_contract.id;
end;
$function$;


-- 3.2 `migration_validate_rows` (RETURNS jsonb): resuelve puesto por `id` o por `name`
CREATE OR REPLACE FUNCTION public.migration_validate_rows(
    p_entity_id uuid,
    p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_tenant_id uuid;
    v_row jsonb;
    v_idx integer := 0;
    v_result jsonb := '[]'::jsonb;
    v_status text;
    v_messages text[];
    v_ident text;
    v_start date;
    v_position public.organization_positions%rowtype;
    v_pos_raw text;
    v_pos_id uuid;
    v_pos_label text;
    v_matches integer;
    v_occ integer;
    v_batch jsonb := '{}'::jsonb;
    v_seen jsonb := '{}'::jsonb;
    v_balance text;
    v_contract jsonb;
    v_contract_type_code text;
    v_cstart date;
    v_cend date;
BEGIN
    IF NOT public.can_access_entity(p_entity_id, 'workers.manage') THEN
        RAISE EXCEPTION 'No tiene permiso para gestionar trabajadores en esta entidad';
    END IF;

    SELECT company_client_id INTO v_tenant_id
    FROM public.organization_entities WHERE id = p_entity_id AND is_active = true;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'La entidad no existe o no está activa';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'Se esperaba una lista de filas';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        v_status := 'VALID';
        v_messages := ARRAY[]::text[];
        v_pos_id := NULL;
        v_pos_label := NULL;
        v_position := NULL;
        v_contract_type_code := NULL;
        v_cstart := NULL;
        v_cend := NULL;

        IF NULLIF(btrim(COALESCE(v_row ->> 'first_name', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El nombre es obligatorio');
        END IF;
        IF NULLIF(btrim(COALESCE(v_row ->> 'first_surname', '')), '') IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El primer apellido es obligatorio');
        END IF;

        v_ident := NULLIF(btrim(COALESCE(v_row ->> 'identification', '')), '');
        IF v_ident IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'El carné de identidad es obligatorio');
        ELSE
            IF v_ident !~ '^[0-9]{11}$' THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'El número de identificación debe contener exactamente 11 dígitos');
            END IF;

            IF v_seen ? v_ident THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Identificación repetida dentro del archivo (%s): otra fila usa el mismo carné. Corrija la identificación.', v_ident);
            ELSE
                v_seen := v_seen || jsonb_build_object(v_ident, true);
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.workers w
                WHERE w.company_client_id = v_tenant_id
                  AND w.identification = v_ident
            ) THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Ya existe un trabajador en este workspace con el carné de identidad %s. Se creará igualmente; corrija la identificación.', v_ident);
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.candidates c
                WHERE c.company_client_id = v_tenant_id
                  AND c.identification = v_ident
            ) THEN
                IF v_status <> 'ERROR' THEN
                    v_status := 'WARNING';
                END IF;
                v_messages := v_messages || format('Existe un candidato en este workspace con el carné de identidad %s. Corrija la identificación si no es la misma persona.', v_ident);
            END IF;
        END IF;

        BEGIN
            v_start := NULLIF(btrim(COALESCE(v_row ->> 'employment_start_date', '')), '')::date;
        EXCEPTION WHEN OTHERS THEN
            v_start := NULL;
        END;
        IF v_start IS NULL THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'Fecha de incorporación inválida o vacía');
        ELSIF v_start > CURRENT_DATE THEN
            v_status := 'ERROR';
            v_messages := array_append(v_messages, 'La fecha de incorporación no puede ser futura');
        END IF;

        v_pos_raw := NULLIF(btrim(COALESCE(v_row ->> 'position_id', '')), '');
        IF v_pos_raw IS NULL THEN
            v_pos_raw := NULLIF(btrim(COALESCE(v_row ->> 'position_code', '')), '');
        END IF;

        IF v_pos_raw IS NOT NULL THEN
            BEGIN
                v_pos_id := v_pos_raw::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_pos_id := NULL;
            END;
        END IF;

        IF v_pos_id IS NOT NULL THEN
            SELECT op.*
            INTO v_position
            FROM public.organization_positions op
            WHERE op.id = v_pos_id
              AND op.organization_entity_id = p_entity_id
              AND op.is_active = true;
            IF NOT FOUND THEN
                v_pos_id := NULL;
                v_status := 'ERROR';
                v_messages := v_messages || format('Puesto no encontrado (%s)', v_pos_raw);
            END IF;
        ELSIF v_pos_raw IS NOT NULL THEN
            SELECT COUNT(*) INTO v_matches
            FROM public.organization_positions op
            WHERE op.organization_entity_id = p_entity_id
              AND op.is_active = true
              AND upper(btrim(op.name)) = upper(btrim(v_pos_raw));
            IF v_matches = 0 THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Puesto no encontrado (%s)', v_pos_raw);
            ELSIF v_matches > 1 THEN
                v_status := 'ERROR';
                v_messages := v_messages || format('Referencia de puesto ambigua (%s): use el identificador', v_pos_raw);
            ELSE
                SELECT op.*
                INTO v_position
                FROM public.organization_positions op
                WHERE op.organization_entity_id = p_entity_id
                  AND op.is_active = true
                  AND upper(btrim(op.name)) = upper(btrim(v_pos_raw));
            END IF;
        END IF;

        IF v_position.id IS NOT NULL THEN
            v_pos_id := v_position.id;
            v_pos_label := v_position.name;

            SELECT COUNT(*) INTO v_occ
            FROM public.worker_position_assignments a
            JOIN public.workers w ON w.id = a.worker_id
            WHERE a.position_id = v_position.id
              AND a.is_current = true
              AND a.end_date IS NULL
              AND w.employment_status = 'active';

            v_occ := v_occ + COALESCE((v_batch ->> v_position.id::text)::int, 0);

            IF v_occ >= v_position.authorized_quantity THEN
                v_status := 'ERROR';
                v_messages := v_messages || format(
                    'Puesto sin capacidad disponible: %s (capacidad %s, ocupadas %s)',
                    v_position.name, v_position.authorized_quantity, v_occ
                );
            ELSE
                v_batch := v_batch || jsonb_build_object(
                    v_position.id::text, COALESCE((v_batch ->> v_position.id::text)::int, 0) + 1
                );
            END IF;
        ELSIF v_pos_raw IS NULL THEN
            IF v_status <> 'ERROR' THEN
                v_status := 'WARNING';
            END IF;
            v_messages := array_append(v_messages, 'Se importará como pendiente de vinculación a plantilla');
        END IF;

        v_balance := NULLIF(btrim(COALESCE(v_row ->> 'initial_vacation_balance', '')), '');
        IF v_balance IS NOT NULL THEN
            BEGIN
                IF v_balance::numeric < 0 OR v_balance::numeric > 24 THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El saldo inicial de vacaciones debe estar entre 0 y 24 días');
                END IF;
            EXCEPTION WHEN OTHERS THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'Saldo inicial de vacaciones inválido');
            END;
            IF NULLIF(btrim(COALESCE(v_row ->> 'vacation_cutoff_date', '')), '') IS NULL
               AND v_status <> 'ERROR' THEN
                v_messages := array_append(v_messages, 'Sin fecha de corte: se usará la fecha de incorporación');
            END IF;
        END IF;

        v_contract := v_row -> 'contract';
        IF v_contract IS NOT NULL AND jsonb_typeof(v_contract) = 'object' THEN
            IF v_pos_id IS NULL THEN
                v_status := 'ERROR';
                v_messages := array_append(v_messages, 'El contrato migrado requiere que el trabajador se vincule a un puesto');
            ELSE
                SELECT code INTO v_contract_type_code
                FROM public.employment_contract_types
                WHERE id = NULLIF(btrim(COALESCE(v_contract ->> 'contract_type_id', '')), '')::uuid
                  AND is_active = true;
                IF v_contract_type_code IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'Tipo de contrato no encontrado o inactivo');
                END IF;

                BEGIN
                    v_cstart := NULLIF(btrim(COALESCE(v_contract ->> 'start_date', '')), '')::date;
                    v_cend := NULLIF(btrim(COALESCE(v_contract ->> 'end_date', '')), '')::date;
                EXCEPTION WHEN OTHERS THEN
                    v_cstart := NULL; v_cend := NULL;
                END;

                IF v_cstart IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El contrato migrado requiere fecha de inicio');
                END IF;
                IF v_contract_type_code = 'DETERMINADO' AND v_cend IS NULL THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'El contrato por tiempo determinado requiere fecha de fin');
                END IF;
                IF v_cend IS NOT NULL AND v_cstart IS NOT NULL AND v_cend <= v_cstart THEN
                    v_status := 'ERROR';
                    v_messages := array_append(v_messages, 'La fecha de fin del contrato debe ser posterior a su inicio');
                END IF;
            END IF;
        END IF;

        v_result := v_result || jsonb_build_object(
            'index', v_idx,
            'status', v_status,
            'messages', to_jsonb(v_messages),
            'position_id', v_pos_id,
            'position_label', v_pos_label
        );

        v_idx := v_idx + 1;
    END LOOP;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.migration_validate_rows(uuid, jsonb) TO authenticated;


-- 3.3 Reescritura in-situ de `contract_expiry_alerts`, `get_migration_template_data`,
--     `entity_positions_anexo14` y variantes `__pcgate_` conservando intacta su
--     cabecera `RETURNS TABLE(...)` desplegada en la BD.
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
      AND (
        p.proname = 'contract_expiry_alerts'
        OR p.proname LIKE 'contract_expiry_alerts\_\_pcgate\_%'
        OR p.proname = 'get_migration_template_data'
        OR p.proname LIKE 'get_migration_template_data\_\_pcgate\_%'
        OR p.proname = 'entity_positions_anexo14'
        OR p.proname LIKE 'entity_positions_anexo14\_\_pcgate\_%'
        OR p.proname LIKE 'capture_contract_structure_snapshot\_\_pcgate\_%'
        OR p.proname LIKE 'migration_validate_rows\_\_pcgate\_%'
      )
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    v_new_def := v_def;

    -- En `contract_expiry_alerts`: reemplazar lectura de `p.code` / `op.code` / `pos.code` por NULL::text
    IF rec.proname LIKE 'contract_expiry_alerts%' THEN
      v_new_def := regexp_replace(v_new_def, '\m(p|op|pos)\.code\s+AS\s+position_code\M', 'NULL::text AS position_code', 'gi');
      v_new_def := regexp_replace(v_new_def, '\m(p|op|pos)\.code\M', 'NULL::text', 'gi');
    END IF;

    -- En `get_migration_template_data`: no leer la columna `code` de áreas, cargos ni puestos
    IF rec.proname LIKE 'get_migration_template_data%' THEN
      v_new_def := replace(
        v_new_def,
        '''id'', id, ''name'', name, ''code'', code) ORDER BY hierarchy_order',
        '''id'', id, ''name'', name) ORDER BY hierarchy_order'
      );
      v_new_def := replace(
        v_new_def,
        '''id'', id, ''name'', name, ''code'', code, ''area_id'', area_id',
        '''id'', id, ''name'', name, ''area_id'', area_id'
      );
      v_new_def := replace(
        v_new_def,
        '''id'', id, ''name'', name, ''code'', code, ''job_id'', job_id',
        '''id'', id, ''name'', name, ''job_id'', job_id'
      );
    END IF;

    -- En `entity_positions_anexo14`, `capture_contract_structure_snapshot` y `migration_validate_rows`
    v_new_def := replace(v_new_def, 'v_position.code', 'NULL::text');
    v_new_def := replace(v_new_def, 'upper(op.code) = upper(v_pos_raw)', 'upper(btrim(op.name)) = upper(btrim(v_pos_raw))');
    v_new_def := regexp_replace(v_new_def, '\ma\.code\s+AS\s+area_code\M', 'NULL::text AS area_code', 'gi');

    IF v_new_def <> v_def THEN
      EXECUTE v_new_def;
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 4. Eliminar restricciones UNIQUE y la columna `code` de las 3 tablas
-- ----------------------------------------------------------------------------
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

COMMIT;
