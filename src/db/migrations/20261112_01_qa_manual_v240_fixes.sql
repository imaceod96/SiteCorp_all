-- =============================================================================
-- Migración: Correcciones QA Manual de Gestor v2.4.0 (C1, C2, G1, G3, G4, M16)
-- =============================================================================
-- 1. C1: Corrige public.resolve_salary_scale_for_entity(entity_id uuid)
--    - Elimina el filtro erróneo `AND is_sitecorp_account = false` que dejaba
--      sin escala a todas las entidades con Cuenta SiteCorp activa.
--    - Usa variable `text` en lugar de `uuid` para `regime_id` ('PRESUPUESTADA' / 'EMPRESARIAL').
--    - Soporta tanto scope_type 'PRESUPUESTADA_GLOBAL'/'GLOBAL' como 'EMPRESARIAL_ENTITY'.
-- 2. C2 + G1 + M16: Sincroniza el catálogo completo `public.document_variables`
--    sin columna `is_active` (esquema real: key, label, category, data_type,
--    kind, document_types, description, sort_order) e incluyendo los códigos
--    reales de `document_template_types` ('EMPLOYMENT_CONTRACT_DETERMINED',
--    'EMPLOYMENT_CONTRACT_INDETERMINED', 'EMPLOYMENT_CONTRACT_ADDENDUM',
--    'SC_4_04', 'RESOLUTION', 'PAYROLL_MOVEMENT') además de los códigos de dominio
--    ('CONTRACT', 'ADDENDUM').
-- 3. G3: Índice único por entidad para nombres de áreas normalizados
--    `lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))`.
-- 4. G4: Desduplicación del catálogo global `public.occupational_categories`
--    en las 5 categorías canónicas cubanas (Cuadro, Técnico, Administrativo,
--    Servicio, Operario), reasignando FK en `organization_jobs` y creando
--    índices únicos por código y nombre.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. C1 — RPC resolve_salary_scale_for_entity
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_salary_scale_for_entity(entity_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'auth'
AS $$
DECLARE
  v_regime_code text;
  v_scale_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT upper(btrim(oe.regime_id::text))
    INTO v_regime_code
    FROM public.organization_entities oe
   WHERE oe.id = resolve_salary_scale_for_entity.entity_id
     AND oe.is_active = true;

  IF v_regime_code IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_regime_code = 'PRESUPUESTADA' THEN
    SELECT ss.id
      INTO v_scale_id
      FROM public.salary_scales ss
     WHERE ss.scope_type IN ('PRESUPUESTADA_GLOBAL', 'GLOBAL')
       AND ss.is_active = true
     ORDER BY ss.updated_at DESC NULLS LAST, ss.created_at DESC NULLS LAST
     LIMIT 1;
  ELSE
    SELECT ss.id
      INTO v_scale_id
      FROM public.salary_scales ss
     WHERE ss.organization_entity_id = resolve_salary_scale_for_entity.entity_id
       AND ss.scope_type = 'EMPRESARIAL_ENTITY'
       AND ss.is_active = true
     ORDER BY ss.updated_at DESC NULLS LAST, ss.created_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  RETURN v_scale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_salary_scale_for_entity(uuid) TO authenticated;

-- =============================================================================
-- 2. C2 + G1 + M16 — Sincronización completa de public.document_variables
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'document_variables'
  ) THEN
    -- Eliminar claves erróneas clonadas de SC-4-04 hacia c.* / a.* que no existen en el dominio
    DELETE FROM public.document_variables
    WHERE key IN (
      'c.ap1','c.ap2','c.area','c.dias','c.f_des','c.f_has','c.fem','c.inc_a','c.inc_d','c.inc_m','c.lic','c.vac',
      'a.ap1','a.ap2','a.area','a.dias','a.f_des','a.f_has','a.fem','a.inc_a','a.inc_d','a.inc_m','a.lic','a.vac'
    );

    INSERT INTO public.document_variables (key, label, category, data_type, kind, document_types, description, sort_order)
    VALUES
      -- Legacy / Internas comunes
      ('entity.name', 'Nombre de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','SC_4_04','CONTRACT','ADDENDUM'], 'Snapshot contractual de la entidad firmante.', 10),
      ('entity.organism', 'Organismo', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Organismo al que pertenece la entidad (snapshot).', 20),
      ('entity.branch', 'Rama', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Rama de la entidad (snapshot).', 30),
      ('entity.labor_code', 'Código laboral/organizacional', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Código de identificación laboral (snapshot).', 40),
      ('entity.address', 'Dirección de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Dirección de la entidad (snapshot).', 50),
      ('entity.province', 'Provincia de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Provincia de la entidad (snapshot).', 60),
      ('entity.municipality', 'Municipio de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Municipio de la entidad (snapshot).', 70),
      ('entity.revolution_year', 'Año de la Revolución', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Valor institucional configurado por entidad y preservado en el documento.', 80),
      ('representative.name', 'Nombre del representante', 'Representante', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Representante histórico que suscribió el documento (snapshot).', 90),
      ('representative.position', 'Cargo del representante', 'Representante', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Cargo del representante histórico (snapshot).', 100),
      ('worker.full_name', 'Nombre completo', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','SC_4_04','RESOLUTION','PAYROLL_MOVEMENT','CONTRACT','ADDENDUM'], 'Nombre y apellidos del trabajador.', 110),
      ('worker.identification', 'Carné de identidad', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','SC_4_04','RESOLUTION','PAYROLL_MOVEMENT','CONTRACT','ADDENDUM'], 'Carné de identidad del trabajador.', 120),
      ('worker.birth_date', 'Fecha de nacimiento', 'Trabajador', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Fecha de nacimiento del trabajador.', 130),
      ('worker.profession', 'Profesión u oficio', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Profesión u oficio (dato profesional, no nivel de estudios).', 140),
      ('worker.address', 'Dirección del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Dirección particular del trabajador.', 150),
      ('worker.province', 'Provincia del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Provincia de residencia del trabajador.', 160),
      ('worker.municipality', 'Municipio del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','EMPLOYMENT_CONTRACT_ADDENDUM','CONTRACT','ADDENDUM'], 'Municipio de residencia del trabajador.', 170),
      ('job.name', 'Cargo', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Cargo del trabajador según condiciones formalizadas vigentes.', 180),
      ('job.salary_group', 'Grupo salarial', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Grupo salarial en números romanos (p. ej. XII).', 190),
      ('job.occupational_category', 'Categoría ocupacional', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Categoría ocupacional del cargo.', 200),
      ('position.name', 'Puesto de trabajo', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Puesto que ocupa el trabajador.', 210),
      ('position.code', 'Código del puesto', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Código del puesto formalizado (tras anexos de cambio de puesto).', 220),
      ('position.work_location', 'Lugar de trabajo', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Lugar de trabajo según condiciones formalizadas.', 230),
      ('schedule.daily_hours', 'Horas diarias', 'Jornada', 'hours', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horas de trabajo al día.', 240),
      ('schedule.weekly_hours', 'Horas semanales', 'Jornada', 'hours', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horas de trabajo a la semana.', 250),
      ('schedule.monthly_hours', 'Horas mensuales', 'Jornada', 'hours', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horas de trabajo al mes.', 260),
      ('schedule.text', 'Horario', 'Jornada', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horario / jornada en texto (del puesto o sus segmentos).', 270),
      ('schedule.break', 'Descanso', 'Jornada', 'integer', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Minutos de descanso dentro de la jornada.', 280),
      ('contract.type', 'Tipo de contrato', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Nombre del tipo de contrato (determinado / indeterminado).', 290),
      ('contract.start_date', 'Fecha de inicio', 'Contrato', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de inicio del contrato.', 300),
      ('contract.end_date', 'Fecha de fin', 'Contrato', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de fin prevista (contrato por tiempo determinado).', 310),
      ('contract.duration', 'Duración', 'Contrato', 'text', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Duración calculada a partir de la fecha de inicio y la fecha de término (p. ej. «6 meses»).', 320),
      ('contract.signature_date', 'Fecha de firma', 'Contrato', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de firma del contrato.', 330),
      ('contract.signature_day', 'Día de firma', 'Contrato', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Día de la fecha de firma (calculado, no se persiste).', 340),
      ('contract.signature_month', 'Mes de firma', 'Contrato', 'text', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Mes de la fecha de firma en español (calculado, no se persiste).', 350),
      ('contract.signature_year', 'Año de firma', 'Contrato', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Año de la fecha de firma (calculado, no se persiste).', 360),
      ('contract.signature_place', 'Lugar de firma', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Lugar/municipio de firma.', 370),
      ('contract.payment_method', 'Forma de pago', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Forma de pago (A tiempo / A rendimiento), incluidos anexos formalizados.', 380),
      ('contract.payment_schedule', 'Día / momento de pago', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Día o momento de pago (p. ej. «Día 10 de cada mes»), incluidos anexos formalizados.', 390),
      ('compensation.base_salary', 'Salario de escala', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Salario de escala formalizado vigente.', 400),
      ('compensation.additional_payments', 'Pagos adicionales', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Suma de pagos adicionales formalizados.', 410),
      ('compensation.abnormal_conditions_payments', 'Pagos por condiciones anormales', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Suma de pagos por condiciones laborales anormales.', 420),
      ('compensation.other_payments', 'Otros pagos', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Suma de otros pagos del contrato.', 430),
      ('compensation.total', 'Total contractual', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Total contractual formalizado (salario + conceptos).', 440),
      ('compensation.currency', 'Moneda', 'Retribución', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Moneda de la retribución (p. ej. CUP).', 450),
      ('addendum.number', 'Número de anexo', 'Anexo', 'integer', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Numeración secuencial del anexo dentro del contrato.', 500),
      ('addendum.reason', 'Motivo del anexo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Motivo legible del anexo.', 510),
      ('addendum.effective_date', 'Fecha efectiva', 'Anexo', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Fecha desde la cual aplican las nuevas condiciones.', 520),
      ('addendum.signature_date', 'Fecha de firma del anexo', 'Anexo', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Fecha de firma del anexo.', 530),
      ('addendum.signature_day', 'Día de firma del anexo', 'Anexo', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Día de la fecha de firma del anexo (calculado).', 540),
      ('addendum.signature_month', 'Mes de firma del anexo', 'Anexo', 'text', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Mes de la fecha de firma del anexo en español (calculado).', 550),
      ('addendum.signature_year', 'Año de firma del anexo', 'Anexo', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Año de la fecha de firma del anexo (calculado).', 560),
      ('addendum.signature_place', 'Lugar de firma del anexo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Lugar de firma del anexo.', 570),
      ('addendum.previous.job', 'Cargo anterior', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Cargo anterior según el snapshot del anexo.', 580),
      ('addendum.previous.salary_group', 'Grupo salarial anterior', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Grupo salarial anterior según el snapshot del anexo.', 590),
      ('addendum.previous.occupational_category', 'Categoría ocupacional anterior', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Categoría ocupacional anterior según el snapshot.', 600),
      ('addendum.previous.salary', 'Salario anterior', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Salario anterior según el snapshot del anexo.', 610),
      ('addendum.new.job', 'Cargo nuevo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Cargo nuevo según el snapshot del anexo.', 620),
      ('addendum.new.salary_group', 'Grupo salarial nuevo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Grupo salarial nuevo según el snapshot del anexo.', 630),
      ('addendum.new.occupational_category', 'Categoría ocupacional nueva', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Categoría ocupacional nueva según el snapshot.', 640),
      ('addendum.new.salary', 'Salario nuevo', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Salario nuevo según el snapshot del anexo.', 650),
      ('addendum.new.other_payments', 'Otros pagos nuevos', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Otros pagos según el lado «después» del anexo.', 660),
      ('addendum.new.total', 'Total nuevo', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Total contractual nuevo según el anexo.', 670),
      -- SC-4-04 legacy/internas
      ('sc404.fecha_desde', 'SC-4-04 · Fecha desde', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Inicio del período en formato DD/MM/AA (fecha de inicio de vacaciones o fecha de salida del certificado médico).', 700),
      ('sc404.fecha_hasta', 'SC-4-04 · Fecha hasta', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Último día del período en formato DD/MM/AA (fecha de término en vacaciones; vacío en certificado médico).', 701),
      ('sc404.dias', 'SC-4-04 · Días', 'SC-4-04', 'integer', 'SOURCE', ARRAY['SC_4_04'], 'Vacaciones: días naturales del período. Certificado médico: cantidad de días otorgados.', 702),
      ('sc404.incorporacion_dia', 'SC-4-04 · Día de incorporación', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Día (1–31) de la fecha de reincorporación laboral.', 703),
      ('sc404.incorporacion_mes', 'SC-4-04 · Mes de incorporación', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Mes numérico (1–12) de la fecha de incorporación.', 704),
      ('sc404.incorporacion_anio', 'SC-4-04 · Año de incorporación', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Año en dos dígitos (AA) de la fecha de incorporación.', 705),
      ('certificado.es_licencia_subsidio', 'Marcador Licencia/Subsidio', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Devuelve «X» cuando el origen es un certificado médico; vacío para vacaciones.', 706),
      ('certificado.fecha_salida', 'Certificado · Fecha de salida', 'Certificado médico', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Fecha de salida del certificado médico en DD/MM/AA.', 707),
      ('certificado.fecha_reincorporacion', 'Certificado · Fecha de reincorporación', 'Certificado médico', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Fecha de reincorporación del certificado médico en DD/MM/AA.', 708),
      ('certificado.dias', 'Certificado · Días', 'Certificado médico', 'integer', 'SOURCE', ARRAY['SC_4_04'], 'Cantidad de días explícita del certificado médico.', 709),
      ('vacaciones.fecha_desde', 'Vacaciones · Fecha desde', 'Vacaciones', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Fecha de inicio del período de vacaciones en DD/MM/AA.', 710),
      ('vacaciones.fecha_hasta', 'Vacaciones · Fecha hasta', 'Vacaciones', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Fecha de término del período de vacaciones en DD/MM/AA.', 711),
      ('vacaciones.dias_naturales', 'Vacaciones · Días naturales', 'Vacaciones', 'integer', 'SOURCE', ARRAY['SC_4_04'], 'Días naturales del período (hasta − desde + 1).', 712),
      ('vacaciones.dias_consumidos', 'Vacaciones · Días consumidos', 'Vacaciones', 'integer', 'SOURCE', ARRAY['SC_4_04'], 'Días descontados del saldo vacacional.', 713),
      ('vacaciones.reincorporacion', 'Vacaciones · Incorporación', 'Vacaciones', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Primer día hábil posterior al período según el horario del puesto (DD/MM/AA).', 714),
      ('area.name', 'Área', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Área del puesto de la asignación vigente al período.', 715),
      ('entity.code', 'Código de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Código interno de la entidad del trabajador.', 716),
      ('documento.fecha_emision', 'Fecha de emisión del documento', 'Documento', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Fecha en que se emite el documento, en DD/MM/AA.', 717),
      -- SC-4-04 catálogo visible s.* (16 variables)
      ('s.fem', 'SC-4-04 · Fecha de emisión', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Fecha (día de la generación) en que se emite el documento, en DD/MM/AA.', 750),
      ('s.ent', 'SC-4-04 · Nombre de la entidad', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Nombre de la entidad del trabajador.', 751),
      ('s.cod', 'SC-4-04 · Código de la entidad', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Código interno de la entidad del trabajador.', 752),
      ('s.nom', 'SC-4-04 · Nombre del trabajador', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Nombre o nombres del trabajador, sin apellidos.', 753),
      ('s.ap1', 'SC-4-04 · Primer apellido', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Primer apellido del trabajador.', 754),
      ('s.ap2', 'SC-4-04 · Segundo apellido', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Segundo apellido del trabajador.', 755),
      ('s.ci', 'SC-4-04 · Carné de identidad', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Carné de identidad del trabajador.', 756),
      ('s.area', 'SC-4-04 · Área', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Área del puesto de la asignación vigente al período.', 757),
      ('s.f_des', 'SC-4-04 · Fecha desde', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Inicio del período en formato DD/MM/AA (fecha de inicio de vacaciones o fecha de salida del certificado médico).', 758),
      ('s.f_has', 'SC-4-04 · Fecha hasta', 'SC-4-04', 'text', 'SOURCE', ARRAY['SC_4_04'], 'Último día del período en formato DD/MM/AA (fecha de término en vacaciones; vacío en certificado médico).', 759),
      ('s.dias', 'SC-4-04 · Días', 'SC-4-04', 'integer', 'SOURCE', ARRAY['SC_4_04'], 'Vacaciones: días naturales del período. Certificado médico: cantidad de días otorgados.', 760),
      ('s.inc_d', 'SC-4-04 · Día de incorporación', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Día (1–31) de la fecha de reincorporación laboral.', 761),
      ('s.inc_m', 'SC-4-04 · Mes de incorporación', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Mes numérico (1–12) de la fecha de incorporación.', 762),
      ('s.inc_a', 'SC-4-04 · Año de incorporación', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Año en dos dígitos (AA) de la fecha de incorporación.', 763),
      ('s.vac', 'SC-4-04 · Marca de vacaciones', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Devuelve «X» cuando el origen es un período de vacaciones; vacío para certificado médico.', 764),
      ('s.lic', 'SC-4-04 · Marca de licencia/subsidio', 'SC-4-04', 'text', 'CALCULATED', ARRAY['SC_4_04'], 'Devuelve «X» cuando el origen es un certificado médico; vacío para vacaciones.', 765),
      -- Contrato catálogo visible c.* (45 variables)
      ('c.ent', 'Contrato · Nombre de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Nombre de la entidad firmante.', 800),
      ('c.org', 'Contrato · Organismo', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Organismo al que pertenece la entidad.', 801),
      ('c.ram', 'Contrato · Rama', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Rama de actividad de la entidad.', 802),
      ('c.cod', 'Contrato · Código laboral', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Código de identificación laboral de la entidad.', 803),
      ('c.dir', 'Contrato · Dirección de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Dirección oficial de la entidad.', 804),
      ('c.prov', 'Contrato · Provincia de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Provincia de la entidad.', 805),
      ('c.mun', 'Contrato · Municipio de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Municipio de la entidad.', 806),
      ('c.rev', 'Contrato · Año de la Revolución', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Valor institucional configurado por la entidad para el encabezado oficial.', 807),
      ('c.rep_nom', 'Contrato · Nombre del representante', 'Representante', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Nombre completo del representante que suscribe el documento.', 808),
      ('c.rep_cargo', 'Contrato · Cargo del representante', 'Representante', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Cargo del representante que suscribe el documento.', 809),
      ('c.nom', 'Contrato · Nombre completo', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Nombre y apellidos del trabajador.', 810),
      ('c.ci', 'Contrato · Carné de identidad', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Carné de identidad del trabajador.', 811),
      ('c.nac', 'Contrato · Fecha de nacimiento', 'Trabajador', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de nacimiento del trabajador.', 812),
      ('c.prof', 'Contrato · Profesión u oficio', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Profesión u oficio del trabajador.', 813),
      ('c.dir_trab', 'Contrato · Dirección del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Dirección particular del trabajador.', 814),
      ('c.prov_trab', 'Contrato · Provincia del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Provincia de residencia del trabajador.', 815),
      ('c.mun_trab', 'Contrato · Municipio del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Municipio de residencia del trabajador.', 816),
      ('c.cargo', 'Contrato · Cargo', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Cargo del trabajador según condiciones formalizadas vigentes.', 817),
      ('c.grupo', 'Contrato · Grupo salarial', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Grupo salarial en números romanos (p. ej. XII).', 818),
      ('c.cat_ocup', 'Contrato · Categoría ocupacional', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Categoría ocupacional del cargo.', 819),
      ('c.puesto', 'Contrato · Puesto de trabajo', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Puesto que ocupa el trabajador.', 820),
      ('c.cod_puesto', 'Contrato · Código del puesto', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Código del puesto formalizado.', 821),
      ('c.lug_trab', 'Contrato · Lugar de trabajo', 'Cargo y Puesto', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Lugar de trabajo según condiciones formalizadas.', 822),
      ('c.horas_dia', 'Contrato · Horas diarias', 'Jornada', 'hours', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horas de trabajo al día.', 823),
      ('c.horas_sem', 'Contrato · Horas semanales', 'Jornada', 'hours', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horas de trabajo a la semana.', 824),
      ('c.horas_mes', 'Contrato · Horas mensuales', 'Jornada', 'hours', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horas de trabajo al mes.', 825),
      ('c.horario', 'Contrato · Horario', 'Jornada', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Horario o régimen de jornada en texto.', 826),
      ('c.descanso', 'Contrato · Descanso', 'Jornada', 'integer', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Minutos de descanso dentro de la jornada.', 827),
      ('c.tipo', 'Contrato · Tipo de contrato', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Nombre del tipo de contrato (determinado / indeterminado).', 828),
      ('c.inicio', 'Contrato · Fecha de inicio', 'Contrato', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de inicio del contrato.', 829),
      ('c.fin', 'Contrato · Fecha de fin', 'Contrato', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de fin prevista (contrato por tiempo determinado).', 830),
      ('c.duracion', 'Contrato · Duración', 'Contrato', 'text', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Duración calculada a partir de la fecha de inicio y la fecha de término (p. ej. «6 meses»).', 831),
      ('c.firma', 'Contrato · Fecha de firma', 'Contrato', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Fecha de firma del contrato.', 832),
      ('c.firma_dia', 'Contrato · Día de firma', 'Contrato', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Día de la fecha de firma.', 833),
      ('c.firma_mes', 'Contrato · Mes de firma', 'Contrato', 'text', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Mes de la fecha de firma en español.', 834),
      ('c.firma_anio', 'Contrato · Año de firma', 'Contrato', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Año de la fecha de firma.', 835),
      ('c.lugar_firma', 'Contrato · Lugar de firma', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Lugar o municipio de firma.', 836),
      ('c.formaPago', 'Contrato · Forma de pago', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Forma de pago (A tiempo / A rendimiento).', 837),
      ('c.momentoPago', 'Contrato · Día / momento de pago', 'Contrato', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Día o momento de pago (p. ej. «Día 10 de cada mes»).', 838),
      ('c.salario', 'Contrato · Salario de escala', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Salario de escala formalizado vigente.', 839),
      ('c.pagos_adic', 'Contrato · Pagos adicionales', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Suma de pagos adicionales formalizados.', 840),
      ('c.cond_anorm', 'Contrato · Pagos por condiciones anormales', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Suma de pagos por condiciones laborales anormales.', 841),
      ('c.otros_pagos', 'Contrato · Otros pagos', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Suma de otros pagos del contrato.', 842),
      ('c.total', 'Contrato · Total contractual', 'Retribución', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Total contractual formalizado (salario + conceptos).', 843),
      ('c.moneda', 'Contrato · Moneda', 'Retribución', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_DETERMINED','EMPLOYMENT_CONTRACT_INDETERMINED','CONTRACT'], 'Moneda de la retribución (p. ej. CUP).', 844),
      -- Anexo catálogo visible a.* (35 variables)
      ('a.ent', 'Anexo · Nombre de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Nombre de la entidad firmante.', 900),
      ('a.org', 'Anexo · Organismo', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Organismo al que pertenece la entidad.', 901),
      ('a.ram', 'Anexo · Rama', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Rama de actividad de la entidad.', 902),
      ('a.cod', 'Anexo · Código laboral', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Código de identificación laboral de la entidad.', 903),
      ('a.dir', 'Anexo · Dirección de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Dirección oficial de la entidad.', 904),
      ('a.prov', 'Anexo · Provincia de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Provincia de la entidad.', 905),
      ('a.mun', 'Anexo · Municipio de la entidad', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Municipio de la entidad.', 906),
      ('a.rev', 'Anexo · Año de la Revolución', 'Entidad', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Valor institucional configurado por la entidad.', 907),
      ('a.rep_nom', 'Anexo · Nombre del representante', 'Representante', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Nombre completo del representante que suscribe el anexo.', 908),
      ('a.rep_cargo', 'Anexo · Cargo del representante', 'Representante', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Cargo del representante que suscribe el anexo.', 909),
      ('a.nom', 'Anexo · Nombre completo', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Nombre y apellidos del trabajador.', 910),
      ('a.ci', 'Anexo · Carné de identidad', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Carné de identidad del trabajador.', 911),
      ('a.nac', 'Anexo · Fecha de nacimiento', 'Trabajador', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Fecha de nacimiento del trabajador.', 912),
      ('a.prof', 'Anexo · Profesión u oficio', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Profesión u oficio del trabajador.', 913),
      ('a.dir_trab', 'Anexo · Dirección del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Dirección particular del trabajador.', 914),
      ('a.prov_trab', 'Anexo · Provincia del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Provincia de residencia del trabajador.', 915),
      ('a.mun_trab', 'Anexo · Municipio del trabajador', 'Trabajador', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Municipio de residencia del trabajador.', 916),
      ('a.num', 'Anexo · Número de anexo', 'Anexo', 'integer', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Numeración secuencial del anexo dentro del contrato.', 917),
      ('a.motivo', 'Anexo · Motivo del anexo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Motivo legible del anexo.', 918),
      ('a.efectiva', 'Anexo · Fecha efectiva', 'Anexo', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Fecha desde la cual aplican las nuevas condiciones.', 919),
      ('a.firma', 'Anexo · Fecha de firma del anexo', 'Anexo', 'date', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Fecha de firma del anexo.', 920),
      ('a.firma_dia', 'Anexo · Día de firma del anexo', 'Anexo', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Día de la fecha de firma del anexo.', 921),
      ('a.firma_mes', 'Anexo · Mes de firma del anexo', 'Anexo', 'text', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Mes de la fecha de firma del anexo en español.', 922),
      ('a.firma_anio', 'Anexo · Año de firma del anexo', 'Anexo', 'integer', 'CALCULATED', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Año de la fecha de firma del anexo.', 923),
      ('a.lugar_firma', 'Anexo · Lugar de firma del anexo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Lugar de firma del anexo.', 924),
      ('a.ant_cargo', 'Anexo · Cargo anterior', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Cargo anterior del trabajador.', 925),
      ('a.ant_grupal', 'Anexo · Grupo salarial anterior', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Grupo salarial anterior del trabajador.', 926),
      ('a.ant_cat', 'Anexo · Categoría ocupacional anterior', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Categoría ocupacional anterior.', 927),
      ('a.ant_salario', 'Anexo · Salario anterior', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Salario anterior del trabajador.', 928),
      ('a.nue_cargo', 'Anexo · Cargo nuevo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Cargo nuevo del trabajador.', 929),
      ('a.nue_grupal', 'Anexo · Grupo salarial nuevo', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Grupo salarial nuevo del trabajador.', 930),
      ('a.nue_cat', 'Anexo · Categoría ocupacional nueva', 'Anexo', 'text', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Categoría ocupacional nueva.', 931),
      ('a.nue_salario', 'Anexo · Salario nuevo', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Salario nuevo del trabajador.', 932),
      ('a.nue_otros', 'Anexo · Otros pagos nuevos', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Otros pagos nuevos del anexo.', 933),
      ('a.nue_total', 'Anexo · Total nuevo', 'Anexo', 'amount', 'SOURCE', ARRAY['EMPLOYMENT_CONTRACT_ADDENDUM','ADDENDUM'], 'Total contractual nuevo según el anexo.', 934),
      -- Resolución catálogo visible r.* (13 variables)
      ('r.nom', 'Resolución · Nombre completo', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Nombre y apellidos del trabajador.', 200),
      ('r.car', 'Resolución · Cargo', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Cargo destino que pasa a ocupar el trabajador.', 201),
      ('r.ent', 'Resolución · Nombre de la entidad', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Entidad que emite la Resolución.', 202),
      ('r.emp', 'Resolución · Empresa', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Empresa a la que pertenece la UEB (vacío si la entidad no es UEB).', 203),
      ('r.sal', 'Resolución · Salario', 'Resolución', 'amount', 'SOURCE', ARRAY['RESOLUTION'], 'Salario correspondiente al nuevo Cargo.', 204),
      ('r.ge', 'Resolución · Grupo Escala', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Grupo Escala del nuevo Cargo (valor en números romanos, p. ej. XI).', 205),
      ('r.fun', 'Resolución · Funciones / contenido de trabajo', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Funciones y contenido de trabajo del nuevo Cargo.', 206),
      ('r.mun', 'Resolución · Municipio', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Municipio donde se firma la Resolución.', 207),
      ('r.dia', 'Resolución · Día de firma', 'Resolución', 'text', 'CALCULATED', ARRAY['RESOLUTION'], 'Día de la fecha de Resolución.', 208),
      ('r.mes', 'Resolución · Mes de firma', 'Resolución', 'text', 'CALCULATED', ARRAY['RESOLUTION'], 'Mes de la fecha de Resolución en español.', 209),
      ('r.ano', 'Resolución · Año de firma', 'Resolución', 'text', 'CALCULATED', ARRAY['RESOLUTION'], 'Año de la fecha de Resolución.', 210),
      ('r.rev', 'Resolución · Año de la Revolución', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Año de la Revolución configurado en la información contractual.', 211),
      ('r.rep', 'Resolución · Representante', 'Resolución', 'text', 'SOURCE', ARRAY['RESOLUTION'], 'Persona representante a nombre de quien se emite la Resolución.', 212),
      -- Movimiento de Nómina catálogo visible m.* (23 variables)
      ('m.org', 'Movimiento · Organismo', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Organismo al que pertenece la entidad.', 300),
      ('m.emp', 'Movimiento · Empresa', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Empresa según la jerarquía organizativa.', 301),
      ('m.uni', 'Movimiento · Unidad', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Unidad Empresarial de Base (UEB). Vacío si la entidad no es una UEB.', 302),
      ('m.exp', 'Movimiento · Expediente', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Número de identificación del trabajador (11 dígitos).', 303),
      ('m.dia', 'Movimiento · Día', 'Movimiento de Nómina', 'integer', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Día de la fecha efectiva del movimiento laboral.', 304),
      ('m.mes', 'Movimiento · Mes', 'Movimiento de Nómina', 'text', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Mes de la fecha efectiva del movimiento (nombre en español).', 305),
      ('m.ano', 'Movimiento · Año', 'Movimiento de Nómina', 'integer', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Año de la fecha efectiva del movimiento.', 306),
      ('m.nom', 'Movimiento · Nombre', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Nombre o nombres del trabajador.', 307),
      ('m.ap1', 'Movimiento · Primer apellido', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Primer apellido del trabajador.', 308),
      ('m.ap2', 'Movimiento · Segundo apellido', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Segundo apellido del trabajador.', 309),
      ('m.sex_m', 'Movimiento · Sexo masculino', 'Movimiento de Nómina', 'text', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Devuelve «X» si el trabajador es masculino; vacío en caso contrario.', 310),
      ('m.sex_f', 'Movimiento · Sexo femenino', 'Movimiento de Nómina', 'text', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Devuelve «X» si el trabajador es femenino; vacío en caso contrario.', 311),
      ('m.alta', 'Movimiento · Alta', 'Movimiento de Nómina', 'text', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Devuelve «X» en una nueva contratación; vacío en el resto.', 312),
      ('m.reu', 'Movimiento · Reubicación', 'Movimiento de Nómina', 'text', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Devuelve «X» en un cambio de puesto y/o cambio salarial efectivo; vacío en el resto.', 313),
      ('m.baja', 'Movimiento · Baja', 'Movimiento de Nómina', 'text', 'CALCULATED', ARRAY['PAYROLL_MOVEMENT'], 'Devuelve «X» al dar de baja al trabajador; vacío en el resto.', 314),
      ('m.area_act', 'Movimiento · Área actual', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Área actual/anterior (en Alta, el área de incorporación).', 315),
      ('m.cargo_act', 'Movimiento · Cargo actual', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Cargo actual/anterior (en Alta, el cargo de incorporación).', 316),
      ('m.area_nva', 'Movimiento · Área nueva', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Área nueva/posterior. Vacío en Alta y Baja.', 317),
      ('m.cargo_nvo', 'Movimiento · Cargo nuevo', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Cargo nuevo/posterior. Vacío en Alta y Baja.', 318),
      ('m.ge_act', 'Movimiento · Grupo Escala actual', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Grupo Escala actual/anterior (número romano).', 319),
      ('m.sal_act', 'Movimiento · Salario actual', 'Movimiento de Nómina', 'amount', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Salario actual/anterior.', 320),
      ('m.ge_nvo', 'Movimiento · Grupo Escala nuevo', 'Movimiento de Nómina', 'text', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Grupo Escala nuevo/posterior. Vacío en Alta y Baja.', 321),
      ('m.sal_nvo', 'Movimiento · Salario nuevo', 'Movimiento de Nómina', 'amount', 'SOURCE', ARRAY['PAYROLL_MOVEMENT'], 'Salario nuevo/posterior. Vacío en Alta y Baja.', 322)
    ON CONFLICT (key) DO UPDATE
      SET label          = EXCLUDED.label,
          category       = EXCLUDED.category,
          data_type      = EXCLUDED.data_type,
          kind           = EXCLUDED.kind,
          document_types = EXCLUDED.document_types,
          description    = EXCLUDED.description,
          sort_order     = EXCLUDED.sort_order;
  END IF;
END $$;

-- =============================================================================
-- 3. G3 — Unicidad de nombre de área por entidad (insensible a mayúsculas y espacios)
-- =============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id,
           row_number() OVER (
             PARTITION BY organization_entity_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
             ORDER BY is_active DESC, created_at ASC, id ASC
           ) AS rn
      FROM public.organization_areas
  LOOP
    IF r.rn > 1 THEN
      UPDATE public.organization_areas
         SET name = btrim(name) || ' (' || r.rn || ')'
       WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organization_areas_entity_name_unique
  ON public.organization_areas (
    organization_entity_id,
    lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
  );

-- =============================================================================
-- 4. G4 — Desduplicación del catálogo global public.occupational_categories
-- =============================================================================
DO $$
DECLARE
  v_canonical_id uuid;
  v_group record;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'occupational_categories'
  ) THEN
    FOR v_group IN
      SELECT *
        FROM (
          VALUES
            ('CUADRO',         'Cuadro',         10, ARRAY['cuadro','cuadros','cuadro directivo','directivo','directivos']),
            ('TECNICO',        'Técnico',        20, ARRAY['tecnico','técnico','tecnicos','técnicos']),
            ('ADMINISTRATIVO', 'Administrativo', 30, ARRAY['administrativo','administrativos']),
            ('SERVICIO',       'Servicio',       40, ARRAY['servicio','servicios']),
            ('OPERARIO',       'Operario',       50, ARRAY['operario','operarios','obrero','obreros'])
        ) AS t(canonical_code, canonical_name, canonical_order, aliases)
    LOOP
      SELECT oc.id
        INTO v_canonical_id
        FROM public.occupational_categories oc
       WHERE lower(btrim(oc.code)) = lower(v_group.canonical_code)
          OR lower(btrim(oc.name)) = ANY(v_group.aliases)
       ORDER BY oc.is_active DESC, oc.sort_order ASC NULLS LAST, oc.id ASC
       LIMIT 1;

      IF v_canonical_id IS NOT NULL THEN
        UPDATE public.organization_jobs oj
           SET occupational_category_id = v_canonical_id
         WHERE oj.occupational_category_id IN (
           SELECT oc2.id
             FROM public.occupational_categories oc2
            WHERE (lower(btrim(oc2.code)) = lower(v_group.canonical_code)
               OR lower(btrim(oc2.name)) = ANY(v_group.aliases))
              AND oc2.id <> v_canonical_id
         );

        DELETE FROM public.occupational_categories oc2
         WHERE (lower(btrim(oc2.code)) = lower(v_group.canonical_code)
            OR lower(btrim(oc2.name)) = ANY(v_group.aliases))
           AND oc2.id <> v_canonical_id;

        UPDATE public.occupational_categories
           SET code       = v_group.canonical_code,
               name       = v_group.canonical_name,
               sort_order = v_group.canonical_order,
               is_active  = true
         WHERE id = v_canonical_id;
      END IF;
    END LOOP;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS occupational_categories_code_unique
  ON public.occupational_categories (upper(btrim(code)));

CREATE UNIQUE INDEX IF NOT EXISTS occupational_categories_name_unique
  ON public.occupational_categories (lower(btrim(name)));

NOTIFY pgrst, 'reload schema';

COMMIT;
