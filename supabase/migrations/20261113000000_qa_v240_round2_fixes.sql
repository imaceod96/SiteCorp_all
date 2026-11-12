-- =============================================================================
-- Migración: Correcciones QA Ronda 2 (v2.4.0)
-- =============================================================================
-- 1. Corrige `public.save_position_with_schedule`:
--    - Elimina la inserción errónea de `company_client_id` (columna inexistente en
--      `organization_positions` y `position_schedule_segments`).
--    - Incluye `position_order` obligatorio en `INSERT INTO public.organization_positions`
--      calculando el siguiente orden correlativo por entidad y cargo.
--    - Incluye `crosses_midnight` obligatorio en `INSERT INTO public.position_schedule_segments`
--      calculado según `end_time < start_time`.
--    - Limpia de forma idempotente cualquier resto de columna/triggers `code` o
--      sobrecargas antiguas de `save_position_with_schedule`.
-- 2. Sincroniza de forma idempotente `public.document_variables` con todo el
--    catálogo oficial (`c.*`, `a.*`, `s.*`, `r.*`, `m.*` y `worker.full_name`)
--    para que `activate_document_template_version` valide las mismas variables
--    que el cliente.
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
-- 3. Sincronización completa e idempotente de `public.document_variables`
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'document_variables'
  ) THEN
    INSERT INTO public.document_variables (key, label, category, document_types, data_type, kind, description, is_active)
    VALUES
      -- Legacy / Internas comunes (incluye worker.full_name en los 5 tipos)
      ('entity.name', 'Nombre de la entidad', 'Entidad', ARRAY['CONTRACT','ADDENDUM','SC_4_04'], 'text', 'SOURCE', 'Snapshot contractual de la entidad firmante.', true),
      ('entity.organism', 'Organismo', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Organismo al que pertenece la entidad (snapshot).', true),
      ('entity.branch', 'Rama', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Rama de la entidad (snapshot).', true),
      ('entity.labor_code', 'Código laboral/organizacional', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Código de identificación laboral (snapshot).', true),
      ('entity.address', 'Dirección de la entidad', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Dirección de la entidad (snapshot).', true),
      ('entity.province', 'Provincia de la entidad', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Provincia de la entidad (snapshot).', true),
      ('entity.municipality', 'Municipio de la entidad', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Municipio de la entidad (snapshot).', true),
      ('entity.revolution_year', 'Año de la Revolución', 'Entidad', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Valor institucional configurado por entidad y preservado en el documento.', true),
      ('representative.name', 'Nombre del representante', 'Representante', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Representante histórico que suscribió el documento (snapshot).', true),
      ('representative.position', 'Cargo del representante', 'Representante', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Cargo del representante histórico (snapshot).', true),
      ('worker.full_name', 'Nombre completo', 'Trabajador', ARRAY['CONTRACT','ADDENDUM','SC_4_04','RESOLUTION','PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Nombre y apellidos del trabajador.', true),
      ('worker.identification', 'Carné de identidad', 'Trabajador', ARRAY['CONTRACT','ADDENDUM','SC_4_04','RESOLUTION','PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Carné de identidad del trabajador.', true),
      ('worker.birth_date', 'Fecha de nacimiento', 'Trabajador', ARRAY['CONTRACT','ADDENDUM'], 'date', 'SOURCE', 'Fecha de nacimiento del trabajador.', true),
      ('worker.profession', 'Profesión u oficio', 'Trabajador', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Profesión u oficio (dato profesional, no nivel de estudios).', true),
      ('worker.address', 'Dirección del trabajador', 'Trabajador', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Dirección particular del trabajador.', true),
      ('worker.province', 'Provincia del trabajador', 'Trabajador', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Provincia de residencia del trabajador.', true),
      ('worker.municipality', 'Municipio del trabajador', 'Trabajador', ARRAY['CONTRACT','ADDENDUM'], 'text', 'SOURCE', 'Municipio de residencia del trabajador.', true),
      ('job.name', 'Cargo', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Cargo del trabajador según condiciones formalizadas vigentes.', true),
      ('job.salary_group', 'Grupo salarial', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Grupo salarial en números romanos (p. ej. XII).', true),
      ('job.occupational_category', 'Categoría ocupacional', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Categoría ocupacional del cargo.', true),
      ('position.name', 'Puesto de trabajo', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Puesto que ocupa el trabajador.', true),
      ('position.code', 'Código del puesto', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Código del puesto formalizado (tras anexos de cambio de puesto).', true),
      ('position.work_location', 'Lugar de trabajo', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Lugar de trabajo según condiciones formalizadas.', true),
      ('schedule.daily_hours', 'Horas diarias', 'Jornada', ARRAY['CONTRACT'], 'hours', 'SOURCE', 'Horas de trabajo al día.', true),
      ('schedule.weekly_hours', 'Horas semanales', 'Jornada', ARRAY['CONTRACT'], 'hours', 'SOURCE', 'Horas de trabajo a la semana.', true),
      ('schedule.monthly_hours', 'Horas mensuales', 'Jornada', ARRAY['CONTRACT'], 'hours', 'SOURCE', 'Horas de trabajo al mes.', true),
      ('schedule.text', 'Horario', 'Jornada', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Horario / jornada en texto (del puesto o sus segmentos).', true),
      ('schedule.break', 'Descanso', 'Jornada', ARRAY['CONTRACT'], 'integer', 'SOURCE', 'Minutos de descanso dentro de la jornada.', true),
      ('contract.type', 'Tipo de contrato', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Nombre del tipo de contrato (determinado / indeterminado).', true),
      ('contract.start_date', 'Fecha de inicio', 'Contrato', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de inicio del contrato.', true),
      ('contract.end_date', 'Fecha de fin', 'Contrato', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de fin prevista (contrato por tiempo determinado).', true),
      ('contract.duration', 'Duración', 'Contrato', ARRAY['CONTRACT'], 'text', 'CALCULATED', 'Duración calculada a partir de la fecha de inicio y la fecha de término (p. ej. «6 meses»).', true),
      ('contract.signature_date', 'Fecha de firma', 'Contrato', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de firma del contrato.', true),
      ('contract.signature_day', 'Día de firma', 'Contrato', ARRAY['CONTRACT'], 'integer', 'CALCULATED', 'Día de la fecha de firma (calculado, no se persiste).', true),
      ('contract.signature_month', 'Mes de firma', 'Contrato', ARRAY['CONTRACT'], 'text', 'CALCULATED', 'Mes de la fecha de firma en español (calculado, no se persiste).', true),
      ('contract.signature_year', 'Año de firma', 'Contrato', ARRAY['CONTRACT'], 'integer', 'CALCULATED', 'Año de la fecha de firma (calculado, no se persiste).', true),
      ('contract.signature_place', 'Lugar de firma', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Lugar/municipio de firma.', true),
      ('contract.payment_method', 'Forma de pago', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Forma de pago (A tiempo / A rendimiento), incluidos anexos formalizados.', true),
      ('contract.payment_schedule', 'Día / momento de pago', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Día o momento de pago (p. ej. «Día 10 de cada mes»), incluidos anexos formalizados.', true),
      ('compensation.base_salary', 'Salario de escala', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Salario de escala formalizado vigente.', true),
      ('compensation.additional_payments', 'Pagos adicionales', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Suma de pagos adicionales formalizados.', true),
      ('compensation.abnormal_conditions_payments', 'Pagos por condiciones anormales', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Suma de pagos por condiciones laborales anormales.', true),
      ('compensation.other_payments', 'Otros pagos', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Suma de otros pagos del contrato.', true),
      ('compensation.total', 'Total contractual', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Total contractual formalizado (salario + conceptos).', true),
      ('compensation.currency', 'Moneda', 'Retribución', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Moneda de la retribución (p. ej. CUP).', true),
      ('addendum.number', 'Número de anexo', 'Anexo', ARRAY['ADDENDUM'], 'integer', 'SOURCE', 'Numeración secuencial del anexo dentro del contrato.', true),
      ('addendum.reason', 'Motivo del anexo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Motivo legible del anexo.', true),
      ('addendum.effective_date', 'Fecha efectiva', 'Anexo', ARRAY['ADDENDUM'], 'date', 'SOURCE', 'Fecha desde la cual aplican las nuevas condiciones.', true),
      ('addendum.signature_date', 'Fecha de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'date', 'SOURCE', 'Fecha de firma del anexo.', true),
      ('addendum.signature_day', 'Día de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'integer', 'CALCULATED', 'Día de la fecha de firma del anexo (calculado).', true),
      ('addendum.signature_month', 'Mes de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'CALCULATED', 'Mes de la fecha de firma del anexo en español (calculado).', true),
      ('addendum.signature_year', 'Año de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'integer', 'CALCULATED', 'Año de la fecha de firma del anexo (calculado).', true),
      ('addendum.signature_place', 'Lugar de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Lugar de firma del anexo.', true),
      ('addendum.previous.job', 'Cargo anterior', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Cargo anterior según el snapshot del anexo.', true),
      ('addendum.previous.salary_group', 'Grupo salarial anterior', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Grupo salarial anterior según el snapshot del anexo.', true),
      ('addendum.previous.occupational_category', 'Categoría ocupacional anterior', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Categoría ocupacional anterior según el snapshot.', true),
      ('addendum.previous.salary', 'Salario anterior', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Salario anterior según el snapshot del anexo.', true),
      ('addendum.new.job', 'Cargo nuevo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Cargo nuevo según el snapshot del anexo.', true),
      ('addendum.new.salary_group', 'Grupo salarial nuevo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Grupo salarial nuevo según el snapshot del anexo.', true),
      ('addendum.new.occupational_category', 'Categoría ocupacional nueva', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Categoría ocupacional nueva según el snapshot.', true),
      ('addendum.new.salary', 'Salario nuevo', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Salario nuevo según el snapshot del anexo.', true),
      ('addendum.new.other_payments', 'Otros pagos nuevos', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Otros pagos según el lado «después» del anexo.', true),
      ('addendum.new.total', 'Total nuevo', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Total contractual nuevo según el anexo.', true),
      -- SC-4-04 legacy/internas
      ('sc404.fecha_desde', 'SC-4-04 · Fecha desde', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Inicio del período en formato DD/MM/AA (fecha de inicio de vacaciones o fecha de salida del certificado médico).', true),
      ('sc404.fecha_hasta', 'SC-4-04 · Fecha hasta', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Último día del período en formato DD/MM/AA (fecha de término en vacaciones; vacío en certificado médico).', true),
      ('sc404.dias', 'SC-4-04 · Días', 'SC-4-04', ARRAY['SC_4_04'], 'integer', 'SOURCE', 'Vacaciones: días naturales del período. Certificado médico: cantidad de días otorgados.', true),
      ('sc404.incorporacion_dia', 'SC-4-04 · Día de incorporación', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Día (1–31) de la fecha de reincorporación laboral.', true),
      ('sc404.incorporacion_mes', 'SC-4-04 · Mes de incorporación', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Mes numérico (1–12) de la fecha de incorporación.', true),
      ('sc404.incorporacion_anio', 'SC-4-04 · Año de incorporación', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Año en dos dígitos (AA) de la fecha de incorporación.', true),
      ('certificado.es_licencia_subsidio', 'Marcador Licencia/Subsidio', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Devuelve «X» cuando el origen es un certificado médico; vacío para vacaciones.', true),
      ('certificado.fecha_salida', 'Certificado · Fecha de salida', 'Certificado médico', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Fecha de salida del certificado médico en DD/MM/AA.', true),
      ('certificado.fecha_reincorporacion', 'Certificado · Fecha de reincorporación', 'Certificado médico', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Fecha de reincorporación del certificado médico en DD/MM/AA.', true),
      ('certificado.dias', 'Certificado · Días', 'Certificado médico', ARRAY['SC_4_04'], 'integer', 'SOURCE', 'Cantidad de días explícita del certificado médico.', true),
      ('vacaciones.fecha_desde', 'Vacaciones · Fecha desde', 'Vacaciones', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Fecha de inicio del período de vacaciones en DD/MM/AA.', true),
      ('vacaciones.fecha_hasta', 'Vacaciones · Fecha hasta', 'Vacaciones', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Fecha de término del período de vacaciones en DD/MM/AA.', true),
      ('vacaciones.dias_naturales', 'Vacaciones · Días naturales', 'Vacaciones', ARRAY['SC_4_04'], 'integer', 'SOURCE', 'Días naturales del período (hasta − desde + 1).', true),
      ('vacaciones.dias_consumidos', 'Vacaciones · Días consumidos', 'Vacaciones', ARRAY['SC_4_04'], 'integer', 'SOURCE', 'Días descontados del saldo vacacional.', true),
      ('vacaciones.reincorporacion', 'Vacaciones · Incorporación', 'Vacaciones', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Primer día hábil posterior al período según el horario del puesto (DD/MM/AA).', true),
      ('area.name', 'Área', 'Cargo y Puesto', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Área del puesto de la asignación vigente al período.', true),
      ('entity.code', 'Código de la entidad', 'Entidad', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Código interno de la entidad del trabajador.', true),
      ('documento.fecha_emision', 'Fecha de emisión del documento', 'Documento', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Fecha en que se emite el documento, en DD/MM/AA.', true),
      -- SC-4-04 catálogo visible s.* (16 variables)
      ('s.fem', 'SC-4-04 · Fecha de emisión', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Fecha (día de la generación) en que se emite el documento, en DD/MM/AA.', true),
      ('s.ent', 'SC-4-04 · Nombre de la entidad', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Nombre de la entidad del trabajador.', true),
      ('s.cod', 'SC-4-04 · Código de la entidad', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Código interno de la entidad del trabajador.', true),
      ('s.nom', 'SC-4-04 · Nombre del trabajador', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Nombre o nombres del trabajador, sin apellidos.', true),
      ('s.ap1', 'SC-4-04 · Primer apellido', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Primer apellido del trabajador.', true),
      ('s.ap2', 'SC-4-04 · Segundo apellido', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Segundo apellido del trabajador.', true),
      ('s.ci', 'SC-4-04 · Carné de identidad', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Carné de identidad del trabajador.', true),
      ('s.area', 'SC-4-04 · Área', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Área del puesto de la asignación vigente al período.', true),
      ('s.f_des', 'SC-4-04 · Fecha desde', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Inicio del período en formato DD/MM/AA (fecha de inicio de vacaciones o fecha de salida del certificado médico).', true),
      ('s.f_has', 'SC-4-04 · Fecha hasta', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'SOURCE', 'Último día del período en formato DD/MM/AA (fecha de término en vacaciones; vacío en certificado médico).', true),
      ('s.dias', 'SC-4-04 · Días', 'SC-4-04', ARRAY['SC_4_04'], 'integer', 'SOURCE', 'Vacaciones: días naturales del período. Certificado médico: cantidad de días otorgados.', true),
      ('s.inc_d', 'SC-4-04 · Día de incorporación', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Día (1–31) de la fecha de reincorporación laboral.', true),
      ('s.inc_m', 'SC-4-04 · Mes de incorporación', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Mes numérico (1–12) de la fecha de incorporación.', true),
      ('s.inc_a', 'SC-4-04 · Año de incorporación', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Año en dos dígitos (AA) de la fecha de incorporación.', true),
      ('s.vac', 'SC-4-04 · Marca de vacaciones', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Devuelve «X» cuando el origen es un período de vacaciones; vacío para certificado médico.', true),
      ('s.lic', 'SC-4-04 · Marca de licencia/subsidio', 'SC-4-04', ARRAY['SC_4_04'], 'text', 'CALCULATED', 'Devuelve «X» cuando el origen es un certificado médico; vacío para vacaciones.', true),
      -- Contrato catálogo visible c.* (45 variables)
      ('c.ent', 'Contrato · Nombre de la entidad', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Nombre de la entidad firmante.', true),
      ('c.org', 'Contrato · Organismo', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Organismo al que pertenece la entidad.', true),
      ('c.ram', 'Contrato · Rama', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Rama de actividad de la entidad.', true),
      ('c.cod', 'Contrato · Código laboral', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Código de identificación laboral de la entidad.', true),
      ('c.dir', 'Contrato · Dirección de la entidad', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Dirección oficial de la entidad.', true),
      ('c.prov', 'Contrato · Provincia de la entidad', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Provincia de la entidad.', true),
      ('c.mun', 'Contrato · Municipio de la entidad', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Municipio de la entidad.', true),
      ('c.rev', 'Contrato · Año de la Revolución', 'Entidad', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Valor institucional configurado por la entidad para el encabezado oficial.', true),
      ('c.rep_nom', 'Contrato · Nombre del representante', 'Representante', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Nombre completo del representante que suscribe el documento.', true),
      ('c.rep_cargo', 'Contrato · Cargo del representante', 'Representante', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Cargo del representante que suscribe el documento.', true),
      ('c.nom', 'Contrato · Nombre completo', 'Trabajador', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Nombre y apellidos del trabajador.', true),
      ('c.ci', 'Contrato · Carné de identidad', 'Trabajador', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Carné de identidad del trabajador.', true),
      ('c.nac', 'Contrato · Fecha de nacimiento', 'Trabajador', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de nacimiento del trabajador.', true),
      ('c.prof', 'Contrato · Profesión u oficio', 'Trabajador', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Profesión u oficio del trabajador.', true),
      ('c.dir_trab', 'Contrato · Dirección del trabajador', 'Trabajador', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Dirección particular del trabajador.', true),
      ('c.prov_trab', 'Contrato · Provincia del trabajador', 'Trabajador', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Provincia de residencia del trabajador.', true),
      ('c.mun_trab', 'Contrato · Municipio del trabajador', 'Trabajador', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Municipio de residencia del trabajador.', true),
      ('c.cargo', 'Contrato · Cargo', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Cargo del trabajador según condiciones formalizadas vigentes.', true),
      ('c.grupo', 'Contrato · Grupo salarial', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Grupo salarial en números romanos (p. ej. XII).', true),
      ('c.cat_ocup', 'Contrato · Categoría ocupacional', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Categoría ocupacional del cargo.', true),
      ('c.puesto', 'Contrato · Puesto de trabajo', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Puesto que ocupa el trabajador.', true),
      ('c.cod_puesto', 'Contrato · Código del puesto', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Código del puesto formalizado.', true),
      ('c.lug_trab', 'Contrato · Lugar de trabajo', 'Cargo y Puesto', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Lugar de trabajo según condiciones formalizadas.', true),
      ('c.horas_dia', 'Contrato · Horas diarias', 'Jornada', ARRAY['CONTRACT'], 'hours', 'SOURCE', 'Horas de trabajo al día.', true),
      ('c.horas_sem', 'Contrato · Horas semanales', 'Jornada', ARRAY['CONTRACT'], 'hours', 'SOURCE', 'Horas de trabajo a la semana.', true),
      ('c.horas_mes', 'Contrato · Horas mensuales', 'Jornada', ARRAY['CONTRACT'], 'hours', 'SOURCE', 'Horas de trabajo al mes.', true),
      ('c.horario', 'Contrato · Horario', 'Jornada', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Horario o régimen de jornada en texto.', true),
      ('c.descanso', 'Contrato · Descanso', 'Jornada', ARRAY['CONTRACT'], 'integer', 'SOURCE', 'Minutos de descanso dentro de la jornada.', true),
      ('c.tipo', 'Contrato · Tipo de contrato', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Nombre del tipo de contrato (determinado / indeterminado).', true),
      ('c.inicio', 'Contrato · Fecha de inicio', 'Contrato', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de inicio del contrato.', true),
      ('c.fin', 'Contrato · Fecha de fin', 'Contrato', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de fin prevista (contrato por tiempo determinado).', true),
      ('c.duracion', 'Contrato · Duración', 'Contrato', ARRAY['CONTRACT'], 'text', 'CALCULATED', 'Duración calculada a partir de la fecha de inicio y la fecha de término (p. ej. «6 meses»).', true),
      ('c.firma', 'Contrato · Fecha de firma', 'Contrato', ARRAY['CONTRACT'], 'date', 'SOURCE', 'Fecha de firma del contrato.', true),
      ('c.firma_dia', 'Contrato · Día de firma', 'Contrato', ARRAY['CONTRACT'], 'integer', 'CALCULATED', 'Día de la fecha de firma.', true),
      ('c.firma_mes', 'Contrato · Mes de firma', 'Contrato', ARRAY['CONTRACT'], 'text', 'CALCULATED', 'Mes de la fecha de firma en español.', true),
      ('c.firma_anio', 'Contrato · Año de firma', 'Contrato', ARRAY['CONTRACT'], 'integer', 'CALCULATED', 'Año de la fecha de firma.', true),
      ('c.lugar_firma', 'Contrato · Lugar de firma', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Lugar o municipio de firma.', true),
      ('c.formaPago', 'Contrato · Forma de pago', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Forma de pago (A tiempo / A rendimiento).', true),
      ('c.momentoPago', 'Contrato · Día / momento de pago', 'Contrato', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Día o momento de pago (p. ej. «Día 10 de cada mes»).', true),
      ('c.salario', 'Contrato · Salario de escala', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Salario de escala formalizado vigente.', true),
      ('c.pagos_adic', 'Contrato · Pagos adicionales', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Suma de pagos adicionales formalizados.', true),
      ('c.cond_anorm', 'Contrato · Pagos por condiciones anormales', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Suma de pagos por condiciones laborales anormales.', true),
      ('c.otros_pagos', 'Contrato · Otros pagos', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Suma de otros pagos del contrato.', true),
      ('c.total', 'Contrato · Total contractual', 'Retribución', ARRAY['CONTRACT'], 'amount', 'SOURCE', 'Total contractual formalizado (salario + conceptos).', true),
      ('c.moneda', 'Contrato · Moneda', 'Retribución', ARRAY['CONTRACT'], 'text', 'SOURCE', 'Moneda de la retribución (p. ej. CUP).', true),
      -- Anexo catálogo visible a.* (40 variables)
      ('a.ent', 'Anexo · Nombre de la entidad', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Nombre de la entidad firmante.', true),
      ('a.org', 'Anexo · Organismo', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Organismo al que pertenece la entidad.', true),
      ('a.ram', 'Anexo · Rama', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Rama de actividad de la entidad.', true),
      ('a.cod', 'Anexo · Código laboral', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Código de identificación laboral de la entidad.', true),
      ('a.dir', 'Anexo · Dirección de la entidad', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Dirección oficial de la entidad.', true),
      ('a.prov', 'Anexo · Provincia de la entidad', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Provincia de la entidad.', true),
      ('a.mun', 'Anexo · Municipio de la entidad', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Municipio de la entidad.', true),
      ('a.rev', 'Anexo · Año de la Revolución', 'Entidad', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Valor institucional configurado por la entidad.', true),
      ('a.rep_nom', 'Anexo · Nombre del representante', 'Representante', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Nombre completo del representante que suscribe el anexo.', true),
      ('a.rep_cargo', 'Anexo · Cargo del representante', 'Representante', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Cargo del representante que suscribe el anexo.', true),
      ('a.nom', 'Anexo · Nombre completo', 'Trabajador', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Nombre y apellidos del trabajador.', true),
      ('a.ci', 'Anexo · Carné de identidad', 'Trabajador', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Carné de identidad del trabajador.', true),
      ('a.nac', 'Anexo · Fecha de nacimiento', 'Trabajador', ARRAY['ADDENDUM'], 'date', 'SOURCE', 'Fecha de nacimiento del trabajador.', true),
      ('a.prof', 'Anexo · Profesión u oficio', 'Trabajador', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Profesión u oficio del trabajador.', true),
      ('a.dir_trab', 'Anexo · Dirección del trabajador', 'Trabajador', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Dirección particular del trabajador.', true),
      ('a.prov_trab', 'Anexo · Provincia del trabajador', 'Trabajador', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Provincia de residencia del trabajador.', true),
      ('a.mun_trab', 'Anexo · Municipio del trabajador', 'Trabajador', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Municipio de residencia del trabajador.', true),
      ('a.num', 'Anexo · Número de anexo', 'Anexo', ARRAY['ADDENDUM'], 'integer', 'SOURCE', 'Numeración secuencial del anexo dentro del contrato.', true),
      ('a.motivo', 'Anexo · Motivo del anexo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Motivo legible del anexo.', true),
      ('a.efectiva', 'Anexo · Fecha efectiva', 'Anexo', ARRAY['ADDENDUM'], 'date', 'SOURCE', 'Fecha desde la cual aplican las nuevas condiciones.', true),
      ('a.firma', 'Anexo · Fecha de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'date', 'SOURCE', 'Fecha de firma del anexo.', true),
      ('a.firma_dia', 'Anexo · Día de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'integer', 'CALCULATED', 'Día de la fecha de firma del anexo.', true),
      ('a.firma_mes', 'Anexo · Mes de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'CALCULATED', 'Mes de la fecha de firma del anexo en español.', true),
      ('a.firma_anio', 'Anexo · Año de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'integer', 'CALCULATED', 'Año de la fecha de firma del anexo.', true),
      ('a.lugar_firma', 'Anexo · Lugar de firma del anexo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Lugar de firma del anexo.', true),
      ('a.ant_cargo', 'Anexo · Cargo anterior', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Cargo anterior del trabajador.', true),
      ('a.ant_grupal', 'Anexo · Grupo salarial anterior', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Grupo salarial anterior del trabajador.', true),
      ('a.ant_cat', 'Anexo · Categoría ocupacional anterior', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Categoría ocupacional anterior.', true),
      ('a.ant_salario', 'Anexo · Salario anterior', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Salario anterior del trabajador.', true),
      ('a.nue_cargo', 'Anexo · Cargo nuevo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Cargo nuevo del trabajador.', true),
      ('a.nue_grupal', 'Anexo · Grupo salarial nuevo', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Grupo salarial nuevo del trabajador.', true),
      ('a.nue_cat', 'Anexo · Categoría ocupacional nueva', 'Anexo', ARRAY['ADDENDUM'], 'text', 'SOURCE', 'Categoría ocupacional nueva.', true),
      ('a.nue_salario', 'Anexo · Salario nuevo', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Salario nuevo del trabajador.', true),
      ('a.nue_otros', 'Anexo · Otros pagos nuevos', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Otros pagos nuevos del anexo.', true),
      ('a.nue_total', 'Anexo · Total nuevo', 'Anexo', ARRAY['ADDENDUM'], 'amount', 'SOURCE', 'Total contractual nuevo según el anexo.', true),
      -- Resolución catálogo visible r.* (13 variables)
      ('r.nom', 'Resolución · Nombre completo', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Nombre y apellidos del trabajador.', true),
      ('r.car', 'Resolución · Cargo', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Cargo destino que pasa a ocupar el trabajador.', true),
      ('r.ent', 'Resolución · Nombre de la entidad', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Entidad que emite la Resolución.', true),
      ('r.emp', 'Resolución · Empresa', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Empresa a la que pertenece la UEB (vacío si la entidad no es UEB).', true),
      ('r.sal', 'Resolución · Salario', 'Resolución', ARRAY['RESOLUTION'], 'amount', 'SOURCE', 'Salario correspondiente al nuevo Cargo.', true),
      ('r.ge', 'Resolución · Grupo Escala', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Grupo Escala del nuevo Cargo (valor en números romanos, p. ej. XI).', true),
      ('r.fun', 'Resolución · Funciones / contenido de trabajo', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Funciones y contenido de trabajo del nuevo Cargo.', true),
      ('r.mun', 'Resolución · Municipio', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Municipio donde se firma la Resolución.', true),
      ('r.dia', 'Resolución · Día de firma', 'Resolución', ARRAY['RESOLUTION'], 'text', 'CALCULATED', 'Día de la fecha de Resolución.', true),
      ('r.mes', 'Resolución · Mes de firma', 'Resolución', ARRAY['RESOLUTION'], 'text', 'CALCULATED', 'Mes de la fecha de Resolución en español.', true),
      ('r.ano', 'Resolución · Año de firma', 'Resolución', ARRAY['RESOLUTION'], 'text', 'CALCULATED', 'Año de la fecha de Resolución.', true),
      ('r.rev', 'Resolución · Año de la Revolución', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Año de la Revolución configurado en la información contractual.', true),
      ('r.rep', 'Resolución · Representante', 'Resolución', ARRAY['RESOLUTION'], 'text', 'SOURCE', 'Persona representante a nombre de quien se emite la Resolución.', true),
      -- Movimiento de Nómina catálogo visible m.* (23 variables)
      ('m.org', 'Movimiento · Organismo', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Organismo al que pertenece la entidad.', true),
      ('m.emp', 'Movimiento · Empresa', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Empresa según la jerarquía organizativa.', true),
      ('m.uni', 'Movimiento · Unidad', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Unidad Empresarial de Base (UEB). Vacío si la entidad no es una UEB.', true),
      ('m.exp', 'Movimiento · Expediente', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Número de identificación del trabajador (11 dígitos).', true),
      ('m.dia', 'Movimiento · Día', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'integer', 'CALCULATED', 'Día de la fecha efectiva del movimiento laboral.', true),
      ('m.mes', 'Movimiento · Mes', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'CALCULATED', 'Mes de la fecha efectiva del movimiento (nombre en español).', true),
      ('m.ano', 'Movimiento · Año', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'integer', 'CALCULATED', 'Año de la fecha efectiva del movimiento.', true),
      ('m.nom', 'Movimiento · Nombre', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Nombre o nombres del trabajador.', true),
      ('m.ap1', 'Movimiento · Primer apellido', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Primer apellido del trabajador.', true),
      ('m.ap2', 'Movimiento · Segundo apellido', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Segundo apellido del trabajador.', true),
      ('m.sex_m', 'Movimiento · Sexo masculino', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'CALCULATED', 'Devuelve «X» si el trabajador es masculino; vacío en caso contrario.', true),
      ('m.sex_f', 'Movimiento · Sexo femenino', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'CALCULATED', 'Devuelve «X» si el trabajador es femenino; vacío en caso contrario.', true),
      ('m.alta', 'Movimiento · Alta', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'CALCULATED', 'Devuelve «X» en una nueva contratación; vacío en el resto.', true),
      ('m.reu', 'Movimiento · Reubicación', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'CALCULATED', 'Devuelve «X» en un cambio de puesto y/o cambio salarial efectivo; vacío en el resto.', true),
      ('m.baja', 'Movimiento · Baja', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'CALCULATED', 'Devuelve «X» al dar de baja al trabajador; vacío en el resto.', true),
      ('m.area_act', 'Movimiento · Área actual', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Área actual/anterior (en Alta, el área de incorporación).', true),
      ('m.cargo_act', 'Movimiento · Cargo actual', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Cargo actual/anterior (en Alta, el cargo de incorporación).', true),
      ('m.area_nva', 'Movimiento · Área nueva', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Área nueva/posterior. Vacío en Alta y Baja.', true),
      ('m.cargo_nvo', 'Movimiento · Cargo nuevo', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Cargo nuevo/posterior. Vacío en Alta y Baja.', true),
      ('m.ge_act', 'Movimiento · Grupo Escala actual', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Grupo Escala actual/anterior (número romano).', true),
      ('m.sal_act', 'Movimiento · Salario actual', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'amount', 'SOURCE', 'Salario actual/anterior.', true),
      ('m.ge_nvo', 'Movimiento · Grupo Escala nuevo', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'text', 'SOURCE', 'Grupo Escala nuevo/posterior. Vacío en Alta y Baja.', true),
      ('m.sal_nvo', 'Movimiento · Salario nuevo', 'Movimiento de Nómina', ARRAY['PAYROLL_MOVEMENT'], 'amount', 'SOURCE', 'Salario nuevo/posterior. Vacío en Alta y Baja.', true)
    ON CONFLICT (key) DO UPDATE
      SET label          = EXCLUDED.label,
          category       = EXCLUDED.category,
          document_types = EXCLUDED.document_types,
          data_type      = EXCLUDED.data_type,
          kind           = EXCLUDED.kind,
          description    = EXCLUDED.description,
          is_active      = true;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
