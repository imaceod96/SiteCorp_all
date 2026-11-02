-- ============================================================================
-- SITECORP · ENTORNO DEMO EMPRESARIAL COMPLETO
-- Cliente demostrativo: «Grupo Empresarial Horizonte»
-- Archivo: src/db/seeds/20261109_demo_grupo_horizonte.sql
-- ============================================================================
-- PROPÓSITO
--   Generar de forma transaccional, segura y no destructiva el ecosistema
--   empresarial demostrativo «Grupo Empresarial Horizonte» directamente sobre
--   el esquema real de SiteCorp en Supabase (PostgreSQL + RLS), permitiendo
--   recorrer todos los módulos con datos coherentes, interconectados y listos
--   para capturas de pantalla comerciales y corporativas.
--
-- GARANTÍAS DE SEGURIDAD, AISLAMIENTO E IDENTIFICADORES
--   1. Transaccionalidad total (BEGIN ... COMMIT): si cualquier restricción o
--      autoverificación interna falla, toda la ejecución hace ROLLBACK automático.
--   2. Política 100 % NO DESTRUCTIVA:
--        - NO contiene sentencias DELETE, TRUNCATE ni `app.workspace_deletion`.
--        - Si el cliente «Grupo Empresarial Horizonte» ya existe, aborta de
--          inmediato con `RAISE EXCEPTION` sin modificar ningún registro.
--   3. Cero alteración de permisos o usuarios:
--        - NO inserta ni modifica `profiles`, `company_client_memberships`,
--          `company_client_user_roles` ni `entity_user_access`.
--   4. Generación nativa de identificadores (`id` y `code`):
--        - NO fuerza UUIDs en claves primarias (`id`): todas las tablas generan
--          sus UUIDs automáticamente mediante `DEFAULT gen_random_uuid()` y se
--          capturan en memoria con `RETURNING id INTO ...`.
--        - Respeta los patrones reales de código de SiteCorp:
--            * `company_clients.code`: `GRUPO-EMPRESARIAL-HORIZONTE-XXXX`
--            * `organization_entities.code`: `GE-XXXXXX`, `EMP-XXXXXX`, `UEB-XXXXXX`
--            * `organization_entities.account_code`: `CUENTA-<code_entidad>`
--            * `workers.code`: `TRB-XXXXXX` (6 caracteres hexadecimales)
--            * `organization_areas`, `organization_jobs`, `organization_positions`:
--              sin columna `code` (conforme a `20261108_01`).
--   5. Verificación previa en catálogo de las migraciones `20261108_01` y
--      `20261108_02` (columnas, funciones, triggers y restricciones).
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '120s';

-- ----------------------------------------------------------------------------
-- TABLAS TEMPORALES DE TRABAJO
-- Se eliminan si existían previamente de la sesión y se crean antes del bloque
-- DO sin cláusula `ON COMMIT DROP` para garantizar persistencia durante toda
-- la transacción y prevenir que cierres/reintentos las destruyan prematuramente.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS tmp_demo_workers CASCADE;
DROP TABLE IF EXISTS tmp_demo_positions CASCADE;
DROP TABLE IF EXISTS tmp_demo_jobs CASCADE;
DROP TABLE IF EXISTS tmp_demo_areas CASCADE;

CREATE TEMP TABLE tmp_demo_areas (
  area_seq integer PRIMARY KEY,
  area_id uuid NOT NULL,
  entity_idx integer NOT NULL,
  entity_id uuid NOT NULL,
  parent_area_id uuid,
  hierarchy_order integer NOT NULL,
  name text NOT NULL,
  description text NOT NULL
);

CREATE TEMP TABLE tmp_demo_jobs (
  job_seq integer PRIMARY KEY,
  job_id uuid NOT NULL,
  entity_idx integer NOT NULL,
  entity_id uuid NOT NULL,
  area_seq integer NOT NULL,
  area_id uuid NOT NULL,
  hierarchy_order integer NOT NULL,
  name text NOT NULL,
  occupational_category_id uuid NOT NULL,
  salary_group_seq integer NOT NULL,
  salary_group_id uuid NOT NULL,
  is_cuadro boolean NOT NULL,
  is_principal_specialist boolean NOT NULL,
  has_abnormal_conditions boolean NOT NULL,
  cla_day_enabled boolean NOT NULL,
  cla_day_hourly_rate numeric(12,2),
  cla_night_enabled boolean NOT NULL,
  required_profession_or_trade text NOT NULL,
  work_content text NOT NULL
);

CREATE TEMP TABLE tmp_demo_positions (
  pos_seq integer PRIMARY KEY,
  pos_id uuid NOT NULL,
  entity_idx integer NOT NULL,
  entity_id uuid NOT NULL,
  job_seq integer NOT NULL,
  job_id uuid NOT NULL,
  position_order integer NOT NULL,
  name text NOT NULL,
  work_location text NOT NULL,
  authorized_quantity integer NOT NULL,
  occupied_target integer NOT NULL
);

CREATE TEMP TABLE tmp_demo_workers (
  worker_seq integer PRIMARY KEY,
  worker_id uuid NOT NULL,
  entity_idx integer NOT NULL,
  entity_id uuid NOT NULL,
  pos_seq integer NOT NULL,
  pos_id uuid NOT NULL,
  job_seq integer NOT NULL,
  job_id uuid NOT NULL,
  area_id uuid NOT NULL,
  assign_id uuid NOT NULL,
  contract_id uuid,
  resolution_id uuid,
  is_principal_specialist boolean NOT NULL,
  full_name text NOT NULL,
  worker_code text NOT NULL,
  identification text NOT NULL,
  hire_date date NOT NULL,
  employment_start_date date NOT NULL,
  salary_group_id uuid NOT NULL,
  salary_group_seq integer NOT NULL,
  salary_scale_id uuid NOT NULL,
  salary_amount numeric(14,2) NOT NULL,
  has_masters boolean NOT NULL,
  has_doctorate boolean NOT NULL
);

DO $demo_horizonte$
DECLARE
  -- Identificadores generados automáticamente por PostgreSQL (`gen_random_uuid()`)
  v_client_id uuid;
  v_ent_osde  uuid;
  v_ent_hsi   uuid;
  v_ent_hlt   uuid;
  v_ent_hmi   uuid;
  v_ent_hgo   uuid;
  v_ent_mmih  uuid;
  v_ent_acar  uuid;
  v_ent_bcfm  uuid;
  v_ent_adco  uuid;
  v_ent_mer   uuid;
  v_ent_cse   uuid;
  v_ent_scch  uuid;
  v_ent_atas  uuid;

  v_entity_ids uuid[] := ARRAY[]::uuid[];
  v_rep_assign_ids uuid[] := ARRAY[]::uuid[];
  v_scale_ids uuid[] := ARRAY[]::uuid[];
  v_training_folder_ids uuid[] := ARRAY[]::uuid[];
  v_training_topic_ids uuid[] := ARRAY[]::uuid[];
  v_sst_risk_ids uuid[] := ARRAY[]::uuid[];
  v_sst_insp_ids uuid[] := ARRAY[]::uuid[];

  -- Catálogos globales resueltos dinámicamente
  v_cat_c uuid;
  v_cat_t uuid;
  v_cat_a uuid;
  v_cat_s uuid;
  v_cat_o uuid;

  v_prep_ns uuid;
  v_prep_tm uuid;
  v_prep_oc uuid;

  v_gender_m uuid;
  v_gender_f uuid;

  v_marital_single   uuid;
  v_marital_married  uuid;
  v_marital_union    uuid;
  v_marital_divorced uuid;

  v_edu_sup uuid;
  v_edu_tm  uuid;
  v_edu_pre uuid;
  v_edu_oc  uuid;

  v_skin_1 uuid;
  v_skin_2 uuid;
  v_skin_3 uuid;

  v_lic_b uuid;
  v_lic_c uuid;
  v_lic_d uuid;
  v_lic_e uuid;

  v_ctype_indet uuid;
  v_ctype_det   uuid;

  v_pay_time uuid;
  v_pay_perf uuid;

  v_sep_resignation uuid;
  v_sep_end_contract uuid;
  v_sep_retirement uuid;
  v_sep_transfer uuid;

  v_actor_user_id uuid;
  v_actor_email   text;

  -- Variables auxiliares de iteración
  v_i integer;
  v_j integer;
  v_k integer;
  v_ent_idx integer;
  v_ent_id uuid;
  v_scale_id uuid;
  v_group_id uuid;
  v_area_id uuid;
  v_parent_area_id uuid;
  v_job_id uuid;
  v_pos_id uuid;
  v_worker_id uuid;
  v_cand_id uuid;
  v_assign_id uuid;
  v_prev_assign_id uuid;
  v_prev_assign_id_2 uuid;
  v_contract_id uuid;
  v_prev_contract_id uuid;
  v_prev_contract_id_2 uuid;
  v_resolution_id uuid;
  v_addendum_id uuid;
  v_hist_id uuid;
  v_doc_id uuid;
  v_vac_id uuid;
  v_folder_id uuid;
  v_topic_id uuid;
  v_session_id uuid;
  v_rec_id uuid;
  v_risk_id uuid;
  v_action_id uuid;
  v_epp_id uuid;
  v_insp_id uuid;
  v_period_oct_id uuid;
  v_period_nov_id uuid;
  v_entry_id uuid;
  v_rep_pos_1 uuid;
  v_rep_pos_2 uuid;
  v_rep_ass_1 uuid;
  v_rep_ass_2 uuid;
  v_plan_id uuid;

  -- Arreglos de nombres y apellidos hispanos/cubanos realistas (100 % ficticios)
  v_male_names text[] := ARRAY[
    'Alejandro', 'Carlos', 'Roberto', 'Miguel', 'Jorge', 'Rafael', 'Daniel', 'Luis',
    'Eduardo', 'Fernando', 'Javier', 'Ricardo', 'Ernesto', 'Héctor', 'Manuel', 'Arturo',
    'Osvaldo', 'Reynaldo', 'Yoel', 'Yordanis', 'Dariel', 'Alain', 'Orestes', 'Lázaro',
    'César', 'Adrián', 'Rubén', 'Marcos', 'Sergio', 'Gabriel', 'Iván', 'Rolando',
    'Armando', 'Camilo', 'Humberto', 'Leandro', 'Mauricio', 'Nelson', 'Orlando', 'Pavel'
  ];
  v_female_names text[] := ARRAY[
    'Laura', 'María', 'Carmen', 'Beatriz', 'Patricia', 'Claudia', 'Elena', 'Adriana',
    'Gabriela', 'Daniela', 'Valeria', 'Natalia', 'Yanet', 'Yisel', 'Dayamí', 'Lisbet',
    'Aymara', 'Misleydis', 'Anabel', 'Rosa', 'Teresa', 'Mónica', 'Silvia', 'Lucía',
    'Camila', 'Mariela', 'Susana', 'Verónica', 'Lilian', 'Gretel', 'Ivonne', 'Alina',
    'Mayra', 'Gladys', 'Sonia', 'Miriam', 'Yolanda', 'Bárbara', 'Raquel', 'Diana'
  ];
  v_surnames text[] := ARRAY[
    'González', 'Rodríguez', 'Pérez', 'Fernández', 'Martínez', 'Hernández', 'Gómez', 'Díaz',
    'Álvarez', 'Moreno', 'Muñoz', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres',
    'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Ramírez', 'Serrano', 'Blanco', 'Molina',
    'Morales', 'Suárez', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín',
    'Sanz', 'Iglesias', 'Medina', 'Cortés', 'Castillo', 'Garrido', 'Santos', 'Guerrero',
    'Lozano', 'Cano', 'Méndez', 'Cruz', 'Prieto', 'Flores', 'Herrera', 'Peña',
    'León', 'Márquez', 'Cabrera', 'Gallego', 'Calvo', 'Vidal', 'Campos', 'Vega',
    'Fuentes', 'Carrasco', 'Diez', 'Caballero', 'Reyes', 'Nieto', 'Aguilar', 'Pascual',
    'Santana', 'Herrero', 'Lorenzo', 'Montero', 'Hidalgo', 'Giménez', 'Ibáñez', 'Ferrer',
    'Durán', 'Santiago', 'Benítez', 'Mora', 'Vicente', 'Vargas', 'Arias', 'Carmona',
    'Crespo', 'Román', 'Pastor', 'Soto', 'Sáez', 'Velasco', 'Soler', 'Moya',
    'Esteban', 'Parra', 'Bravo', 'Gallardo', 'Rojas', 'Pardo', 'Merino', 'Franco'
  ];

  -- Importes base de los 24 grupos salariales (I al XXIV) conforme al diseño aprobado (2 800 a 16 200 CUP)
  v_group_romans text[] := ARRAY[
    'I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII',
    'XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV'
  ];
  v_group_amounts numeric[] := ARRAY[
    2800, 3050, 3300, 3580, 3880, 4200, 4550, 4920, 5320, 5750, 6200, 6700,
    7250, 7850, 8500, 9200, 9950, 10750, 11600, 12500, 13400, 14300, 15250, 16200
  ];

  v_fname text;
  v_surname1 text;
  v_surname2 text;
  v_full_name text;
  v_ci text;
  v_worker_code text;
  v_birth_date date;
  v_hire_date date;
  v_gender uuid;
  v_marital uuid;
  v_edu uuid;
  v_skin uuid;
  v_specialty text;
  v_prof text;
  v_has_master boolean;
  v_has_doctor boolean;
  v_sal_amount numeric;
  v_sal_seq integer;
  v_prev_sal_amount numeric;
  v_prev_sal_seq integer;
  v_is_princ boolean;
  v_ent_name text;
  v_parent_ent_name text;
  v_ent_mun text;
  v_ent_prov text;
  v_ent_addr text;
  v_ent_org text;
  v_ent_branch text;
  v_ent_labor_code text;
  v_ent_rev_year text;
  v_rep_name text;
  v_rep_title text;
  v_area_name text;
  v_job_name text;
  v_pos_name text;
  v_cat_name text;
  v_work_loc text;
  v_work_content text;
  v_prev_pos_id uuid;
  v_prev_area_name text;
  v_prev_job_name text;
  v_prev_pos_name text;
  v_prev_cat_name text;
  v_prev_work_loc text;

  -- Contadores de autoverificación
  v_chk_entities integer;
  v_chk_areas integer;
  v_chk_jobs integer;
  v_chk_positions integer;
  v_chk_authorized integer;
  v_chk_occupied integer;
  v_chk_vacant integer;
  v_chk_active_workers integer;
  v_chk_inactive_workers integer;
  v_chk_candidates integer;

BEGIN
  -- ==========================================================================
  -- 0. GUARDIA DE SEGURIDAD NO DESTRUCTIVA Y VERIFICACIÓN DE MIGRACIONES
  -- ==========================================================================
  -- 0.1 Prohibición de sobrescritura o eliminación automática del cliente DEMO
  IF EXISTS (
    SELECT 1
    FROM public.company_clients
    WHERE lower(btrim(name)) = lower('Grupo Empresarial Horizonte')
       OR upper(btrim(code)) LIKE 'GRUPO-EMPRESARIAL-HORIZONTE%'
       OR upper(btrim(code)) = 'GE-HORIZONTE'
  ) THEN
    RAISE EXCEPTION 'ejecucion_abortada_cliente_demo_existente: El cliente «Grupo Empresarial Horizonte» ya existe en la base de datos. Por política de seguridad no destructiva, este script no elimina ni sobrescribe datos existentes automáticamente.';
  END IF;

  -- 0.2 Verificación integral de la migración 20261108_01_remove_area_job_position_code.sql
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('organization_areas', 'organization_jobs', 'organization_positions')
      AND column_name = 'code'
  ) THEN
    RAISE EXCEPTION 'migracion_20261108_01_incompleta: Aún existe la columna `code` en organization_areas, organization_jobs u organization_positions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'save_position_with_schedule'
      AND p.pronargs = 13
      AND p.prosrc NOT ILIKE '%p_code%'
      AND p.prosrc ILIKE '%p_authorized_quantity%'
  ) THEN
    RAISE EXCEPTION 'migracion_20261108_01_incompleta: No se encontró la función public.save_position_with_schedule con la firma y cuerpo válidos (13 parámetros, sin p_code).';
  END IF;

  -- 0.3 Verificación integral de la migración 20261108_02_fix_area_hierarchy_order.sql
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_organization_area_hierarchy_order'
      AND p.prosrc ILIKE '%v_parent_order > NEW.hierarchy_order%'
  ) THEN
    RAISE EXCEPTION 'migracion_20261108_02_incompleta: No existe la función public.enforce_organization_area_hierarchy_order() con la validación de orden jerárquico.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger tg
    JOIN pg_class t ON t.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE n.nspname = 'public'
      AND t.relname = 'organization_areas'
      AND tg.tgname = 'trg_organization_areas_hierarchy_order'
      AND NOT tg.tgisinternal
      AND p.proname = 'enforce_organization_area_hierarchy_order'
  ) THEN
    RAISE EXCEPTION 'migracion_20261108_02_incompleta: No está activo el trigger trg_organization_areas_hierarchy_order sobre public.organization_areas.';
  END IF;

  -- 0.4 Verificación de disponibilidad de las tablas temporales de soporte en la sesión
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname LIKE 'pg_temp%' AND tablename = 'tmp_demo_areas')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname LIKE 'pg_temp%' AND tablename = 'tmp_demo_jobs')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname LIKE 'pg_temp%' AND tablename = 'tmp_demo_positions')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname LIKE 'pg_temp%' AND tablename = 'tmp_demo_workers') THEN
    RAISE EXCEPTION 'tablas_temporales_no_disponibles: No se detectaron las 4 tablas temporales tmp_demo_* en la sesión activa. Asegúrate de copiar y ejecutar el archivo completo de una sola vez desde la primera línea.';
  END IF;

  -- Identificar usuario existente de la plataforma (si lo hay) únicamente para campos `created_by` / `uploaded_by` de auditoría
  SELECT u.id, u.email
    INTO v_actor_user_id, v_actor_email
  FROM auth.users u
  ORDER BY u.created_at ASC
  LIMIT 1;

  -- ==========================================================================
  -- 1. RESOLUCIÓN E INICIALIZACIÓN SEGURA DE CATÁLOGOS GLOBALES
  -- ==========================================================================
  INSERT INTO public.entity_regimes (id, name)
  VALUES
    ('EMPRESARIAL', 'Empresarial'),
    ('PRESUPUESTADA', 'Presupuestada')
  ON CONFLICT (id) DO NOTHING;

  -- Categorías ocupacionales
  SELECT id INTO v_cat_c FROM public.occupational_categories WHERE upper(code) IN ('C', 'CUADRO', 'DIR') ORDER BY sort_order LIMIT 1;
  IF v_cat_c IS NULL THEN
    INSERT INTO public.occupational_categories (name, code, sort_order, is_active)
    VALUES ('Cuadro', 'C', 1, true) RETURNING id INTO v_cat_c;
  END IF;

  SELECT id INTO v_cat_t FROM public.occupational_categories WHERE upper(code) IN ('T', 'TEC', 'TECNICO') ORDER BY sort_order LIMIT 1;
  IF v_cat_t IS NULL THEN
    INSERT INTO public.occupational_categories (name, code, sort_order, is_active)
    VALUES ('Técnico', 'T', 2, true) RETURNING id INTO v_cat_t;
  END IF;

  SELECT id INTO v_cat_a FROM public.occupational_categories WHERE upper(code) IN ('A', 'ADM', 'ADMINISTRATIVO') ORDER BY sort_order LIMIT 1;
  IF v_cat_a IS NULL THEN
    INSERT INTO public.occupational_categories (name, code, sort_order, is_active)
    VALUES ('Administrativo', 'A', 3, true) RETURNING id INTO v_cat_a;
  END IF;

  SELECT id INTO v_cat_s FROM public.occupational_categories WHERE upper(code) IN ('S', 'SER', 'SERVICIO') ORDER BY sort_order LIMIT 1;
  IF v_cat_s IS NULL THEN
    INSERT INTO public.occupational_categories (name, code, sort_order, is_active)
    VALUES ('Servicio', 'S', 4, true) RETURNING id INTO v_cat_s;
  END IF;

  SELECT id INTO v_cat_o FROM public.occupational_categories WHERE upper(code) IN ('O', 'OP', 'OPERARIO') ORDER BY sort_order LIMIT 1;
  IF v_cat_o IS NULL THEN
    INSERT INTO public.occupational_categories (name, code, sort_order, is_active)
    VALUES ('Operario', 'O', 5, true) RETURNING id INTO v_cat_o;
  END IF;

  -- Niveles de preparación (NS, TM, OC)
  SELECT id INTO v_prep_ns FROM public.preparation_levels WHERE upper(code) = 'NS' LIMIT 1;
  IF v_prep_ns IS NULL THEN
    SELECT id INTO v_prep_ns FROM public.preparation_levels ORDER BY sort_order ASC LIMIT 1;
  END IF;

  SELECT id INTO v_prep_tm FROM public.preparation_levels WHERE upper(code) = 'TM' LIMIT 1;
  IF v_prep_tm IS NULL THEN
    SELECT id INTO v_prep_tm FROM public.preparation_levels ORDER BY sort_order ASC OFFSET 1 LIMIT 1;
  END IF;

  SELECT id INTO v_prep_oc FROM public.preparation_levels WHERE upper(code) IN ('OC', 'OB') LIMIT 1;
  IF v_prep_oc IS NULL THEN
    SELECT id INTO v_prep_oc FROM public.preparation_levels ORDER BY sort_order DESC LIMIT 1;
  END IF;

  -- Géneros
  SELECT id INTO v_gender_m FROM public.genders WHERE lower(code) IN ('male', 'm') OR lower(name) LIKE 'masculino%' LIMIT 1;
  SELECT id INTO v_gender_f FROM public.genders WHERE lower(code) IN ('female', 'f') OR lower(name) LIKE 'femenino%' LIMIT 1;

  -- Estado civil
  SELECT id INTO v_marital_single   FROM public.marital_statuses WHERE lower(name) LIKE 'solter%' LIMIT 1;
  SELECT id INTO v_marital_married  FROM public.marital_statuses WHERE lower(name) LIKE 'casad%' LIMIT 1;
  SELECT id INTO v_marital_union    FROM public.marital_statuses WHERE lower(name) LIKE 'uni%' LIMIT 1;
  SELECT id INTO v_marital_divorced FROM public.marital_statuses WHERE lower(name) LIKE 'divorciad%' LIMIT 1;
  IF v_marital_single IS NULL THEN SELECT id INTO v_marital_single FROM public.marital_statuses LIMIT 1; END IF;
  v_marital_married  := COALESCE(v_marital_married, v_marital_single);
  v_marital_union    := COALESCE(v_marital_union, v_marital_single);
  v_marital_divorced := COALESCE(v_marital_divorced, v_marital_single);

  -- Nivel educacional
  SELECT id INTO v_edu_sup FROM public.education_levels WHERE lower(name) LIKE '%superior%' LIMIT 1;
  SELECT id INTO v_edu_tm  FROM public.education_levels WHERE lower(name) LIKE '%técnico%' OR lower(name) LIKE '%tecnico%' LIMIT 1;
  SELECT id INTO v_edu_pre FROM public.education_levels WHERE lower(name) LIKE '%preuniversitario%' OR lower(name) LIKE '%medio superior%' LIMIT 1;
  SELECT id INTO v_edu_oc  FROM public.education_levels WHERE lower(name) LIKE '%obrero%' LIMIT 1;
  IF v_edu_sup IS NULL THEN SELECT id INTO v_edu_sup FROM public.education_levels LIMIT 1; END IF;
  v_edu_tm  := COALESCE(v_edu_tm, v_edu_sup);
  v_edu_pre := COALESCE(v_edu_pre, v_edu_tm);
  v_edu_oc  := COALESCE(v_edu_oc, v_edu_tm);

  -- Color de piel
  SELECT id INTO v_skin_1 FROM public.skin_colors WHERE is_active = true ORDER BY name ASC LIMIT 1;
  SELECT id INTO v_skin_2 FROM public.skin_colors WHERE is_active = true ORDER BY name ASC OFFSET 1 LIMIT 1;
  SELECT id INTO v_skin_3 FROM public.skin_colors WHERE is_active = true ORDER BY name ASC OFFSET 2 LIMIT 1;
  v_skin_2 := COALESCE(v_skin_2, v_skin_1);
  v_skin_3 := COALESCE(v_skin_3, v_skin_1);

  -- Licencias de conducción
  SELECT id INTO v_lic_b FROM public.driving_license_categories WHERE upper(code) = 'B' LIMIT 1;
  SELECT id INTO v_lic_c FROM public.driving_license_categories WHERE upper(code) IN ('C', 'C1') LIMIT 1;
  SELECT id INTO v_lic_d FROM public.driving_license_categories WHERE upper(code) IN ('D', 'D1') LIMIT 1;
  SELECT id INTO v_lic_e FROM public.driving_license_categories WHERE upper(code) = 'E' LIMIT 1;
  IF v_lic_b IS NULL THEN SELECT id INTO v_lic_b FROM public.driving_license_categories LIMIT 1; END IF;
  v_lic_c := COALESCE(v_lic_c, v_lic_b);
  v_lic_d := COALESCE(v_lic_d, v_lic_b);
  v_lic_e := COALESCE(v_lic_e, v_lic_c);

  -- Tipos de contrato
  SELECT id INTO v_ctype_indet FROM public.employment_contract_types WHERE upper(code) = 'INDETERMINADO' AND is_active = true LIMIT 1;
  SELECT id INTO v_ctype_det   FROM public.employment_contract_types WHERE upper(code) = 'DETERMINADO' AND is_active = true LIMIT 1;
  IF v_ctype_indet IS NULL THEN SELECT id INTO v_ctype_indet FROM public.employment_contract_types WHERE is_active = true ORDER BY name LIMIT 1; END IF;
  IF v_ctype_det IS NULL THEN SELECT id INTO v_ctype_det FROM public.employment_contract_types WHERE is_active = true ORDER BY name DESC LIMIT 1; END IF;

  -- Formas de pago
  SELECT id INTO v_pay_time FROM public.payment_methods WHERE upper(code) IN ('TIEMPO', 'A_TIEMPO', 'TIME') OR lower(name) LIKE '%tiempo%' LIMIT 1;
  SELECT id INTO v_pay_perf FROM public.payment_methods WHERE upper(code) IN ('RENDIMIENTO', 'A_RENDIMIENTO', 'PERFORMANCE') OR lower(name) LIKE '%rendimiento%' LIMIT 1;
  IF v_pay_time IS NULL THEN SELECT id INTO v_pay_time FROM public.payment_methods WHERE is_active = true ORDER BY display_order LIMIT 1; END IF;
  v_pay_perf := COALESCE(v_pay_perf, v_pay_time);

  -- Motivos de baja
  SELECT id INTO v_sep_resignation  FROM public.worker_separation_reasons WHERE is_active = true ORDER BY name ASC LIMIT 1;
  SELECT id INTO v_sep_end_contract FROM public.worker_separation_reasons WHERE is_active = true ORDER BY name ASC OFFSET 1 LIMIT 1;
  SELECT id INTO v_sep_retirement   FROM public.worker_separation_reasons WHERE is_active = true ORDER BY name ASC OFFSET 2 LIMIT 1;
  SELECT id INTO v_sep_transfer     FROM public.worker_separation_reasons WHERE is_active = true ORDER BY name ASC OFFSET 3 LIMIT 1;
  v_sep_end_contract := COALESCE(v_sep_end_contract, v_sep_resignation);
  v_sep_retirement   := COALESCE(v_sep_retirement, v_sep_resignation);
  v_sep_transfer     := COALESCE(v_sep_transfer, v_sep_resignation);

  -- Tipos documentales requeridos
  INSERT INTO public.document_types (id, name, description, sort_order)
  VALUES
    ('CONTRACT', 'Contrato de Trabajo', 'Documento contractual formalizado', 10),
    ('CONTRACT_ADDENDUM', 'Suplemento / Anexo de Contrato', 'Anexo de variación contractual o salarial', 20),
    ('PAYROLL_MOVEMENT', 'Movimiento de Nómina', 'Modelo oficial de movimiento de nómina (Alta, Reubicación, Baja)', 30),
    ('RESOLUTION', 'Resolución de Nombramiento', 'Resolución para cargos de Especialista Principal o Cuadro', 41),
    ('MEDICAL_CERTIFICATE', 'Certificado Médico', 'Constancia documental de incapacidad temporal de trabajo', 50),
    ('PRE_EMPLOYMENT_CHECK', 'Chequeo Médico Preempleo', 'Certificado de aptitud médica preempleo', 60),
    ('CRIMINAL_RECORD', 'Certificado de Antecedentes Penales', 'Verificación oficial de antecedentes', 70),
    ('ACADEMIC_TITLE', 'Título Académico / Certificación', 'Título universitario, técnico medio o diploma de posgrado', 80),
    ('ID_DOCUMENT', 'Documento de Identidad / Carnet', 'Copia verificadora de identificación oficial', 90)
  ON CONFLICT (id) DO NOTHING;

  -- ==========================================================================
  -- 2. CLIENTE PROPIETARIO Y ESTRUCTURA EMPRESARIAL (1 OSDE + 4 EMPRESAS + 8 UEB)
  --    (Generación automática de `id` mediante `DEFAULT gen_random_uuid()`)
  -- ==========================================================================
  INSERT INTO public.company_clients (
    name, code, description, is_active, created_at, updated_at
  ) VALUES (
    'Grupo Empresarial Horizonte',
    'GRUPO-EMPRESARIAL-HORIZONTE-' || upper(substr(md5('Grupo Empresarial Horizonte'::text), 1, 4)),
    'Corporación empresarial multisectorial de servicios industriales, logística pesada, mantenimiento electromecánico e ingeniería de operaciones (Entorno DEMO oficial de SiteCorp).',
    true,
    now() - interval '3 years',
    now()
  )
  RETURNING id INTO v_client_id;

  -- 2.1 Inserción jerárquica de las 13 entidades (OSDE → 4 Empresas → 8 UEB)
  --     usando `DEFAULT gen_random_uuid()` y códigos conforme a `organization-entities.rules.ts`
  --     (`GE-XXXXXX`, `EMP-XXXXXX`, `UEB-XXXXXX`) y `account.rules.ts` (`CUENTA-<code_entidad>`).
  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, NULL, 'business_group',
    'Grupo Empresarial Horizonte', 'GE-HORIZO', 'EMPRESARIAL', 'active',
    'Oficina Central de Dirección y Gobierno Corporativo del Grupo Empresarial Horizonte.',
    'Ave. 5ta No. 4208 e/ 42 y 44, Miramar', 'Playa', 'La Habana', '11300',
    true, true, true, 'CUENTA-GE-HORIZO',
    'Ministerio de Industrias (MINDUS)', 'Servicios Industriales y Logística Integrada',
    'CIL-2200-01001', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_osde;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_osde, 'company',
    'Horizonte Servicios Industriales, S.A.', 'EMP-HSI001', 'EMPRESARIAL', 'active',
    'Empresa especializada en maquinado pesado, calderería, soldadura certificada, montaje industrial y automatización.',
    'Calzada de Vento Km 4 ½, Zona Industrial Alta Habana', 'Boyeros', 'La Habana', '10800',
    true, true, true, 'CUENTA-EMP-HSI001',
    'Ministerio de Industrias (MINDUS)', 'Metalurgia, Montaje y Servicios Industriales',
    'CIL-2200-02101', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_hsi;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_osde, 'company',
    'Horizonte Logística y Transporte, S.A.', 'EMP-HLT002', 'EMPRESARIAL', 'active',
    'Empresa operadora de transporte de carga pesada, contenedores, cadena de frío y centros de distribución.',
    'Vía Blanca Km 3 ½, Zona Portuaria e Industrial', 'Regla', 'La Habana', '11200',
    true, true, true, 'CUENTA-EMP-HLT002',
    'Ministerio de Industrias (MINDUS)', 'Transporte Automotor y Logística de Almacenes',
    'CIL-2200-03201', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_hlt;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_osde, 'company',
    'Horizonte Mantenimiento Integral, S.A.', 'EMP-HMI003', 'EMPRESARIAL', 'active',
    'Empresa de ingeniería de mantenimiento electromecánico, subestaciones eléctricas, redes técnicas y climatización central.',
    'Calle 100 No. 8512 e/ 85 y 89, Zona Industrial Marianao', 'Marianao', 'La Habana', '11400',
    true, true, true, 'CUENTA-EMP-HMI003',
    'Ministerio de Industrias (MINDUS)', 'Mantenimiento Técnico y Servicios Energéticos',
    'CIL-2200-04301', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_hmi;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_osde, 'company',
    'Horizonte Gestión y Operaciones, S.A.', 'EMP-HGO004', 'EMPRESARIAL', 'active',
    'Empresa de servicios corporativos compartidos, administración de capital humano, tecnologías de la información y escuela ramal.',
    'Calle 23 No. 1106 e/ 8 y 10, El Vedado', 'Plaza de la Revolución', 'La Habana', '10400',
    true, true, true, 'CUENTA-EMP-HGO004',
    'Ministerio de Industrias (MINDUS)', 'Servicios Técnicos, Consultoría y Formación',
    'CIL-2200-05401', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_hgo;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hsi, 'ueb',
    'UEB Montaje y Maquinado Industrial Habana', 'UEB-MMIH01', 'EMPRESARIAL', 'active',
    'Talleres centrales de maquinado CNC, pailería pesada y brigadas de montaje en plantas industriales.',
    'Calzada de Dolores No. 1420, Lawton', 'Diez de Octubre', 'La Habana', '10700',
    true, true, true, 'CUENTA-UEB-MMIH01',
    'Ministerio de Industrias (MINDUS)', 'Metalurgia, Montaje y Servicios Industriales',
    'CIL-2200-02102', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_mmih;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hsi, 'ueb',
    'UEB Automatización y Calderería Artemisa', 'UEB-ACAR02', 'EMPRESARIAL', 'active',
    'Planta de integración de tableros de control, instrumentación industrial y calderas de vapor.',
    'Carretera Central Km 58 ½, Zona Industrial', 'Artemisa', 'Artemisa', '33800',
    true, true, true, 'CUENTA-UEB-ACAR02',
    'Ministerio de Industrias (MINDUS)', 'Metalurgia, Montaje y Servicios Industriales',
    'CIL-2200-02103', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_acar;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hlt, 'ueb',
    'UEB Base de Carga y Flota Pesada Mariel', 'UEB-BCFM03', 'EMPRESARIAL', 'active',
    'Base operativa de cuñas tractoras, semirremolques portacontenedores y taller de flota pesada.',
    'Vial Logístico Sector A-4, Zona Especial de Desarrollo', 'Mariel', 'Artemisa', '34200',
    true, true, true, 'CUENTA-UEB-BCFM03',
    'Ministerio de Industrias (MINDUS)', 'Transporte Automotor y Logística de Almacenes',
    'CIL-2200-03202', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_bcfm;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hlt, 'ueb',
    'UEB Almacenes y Distribución Centro-Occidente', 'UEB-ADCO04', 'EMPRESARIAL', 'active',
    'Centro logístico frigorífico, naves de consolidación de carga y distribución interprovincial.',
    'Autopista Nacional Km 14, Complejo Logístico', 'San Miguel del Padrón', 'La Habana', '11000',
    true, true, true, 'CUENTA-UEB-ADCO04',
    'Ministerio de Industrias (MINDUS)', 'Transporte Automotor y Logística de Almacenes',
    'CIL-2200-03203', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_adco;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hmi, 'ueb',
    'UEB Mantenimiento Electromecánico y Redes', 'UEB-MER005', 'EMPRESARIAL', 'active',
    'Brigadas de alta y media tensión, protecciones eléctricas, bobinado de motores y diagnóstico por termografía.',
    'Ave. Independencia Km 6, Complejo Técnico', 'Cerro', 'La Habana', '10600',
    true, true, true, 'CUENTA-UEB-MER005',
    'Ministerio de Industrias (MINDUS)', 'Mantenimiento Técnico y Servicios Energéticos',
    'CIL-2200-04302', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_mer;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hmi, 'ueb',
    'UEB Climatización y Servicios Energéticos', 'UEB-CSE006', 'EMPRESARIAL', 'active',
    'Unidad de mantenimiento de enfriadoras de agua (chillers), torres de enfriamiento y grupos electrógenos.',
    'Calle 41 No. 3410 e/ 34 y 36, Kohly', 'Playa', 'La Habana', '11300',
    true, true, true, 'CUENTA-UEB-CSE006',
    'Ministerio de Industrias (MINDUS)', 'Mantenimiento Técnico y Servicios Energéticos',
    'CIL-2200-04303', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_cse;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hgo, 'ueb',
    'UEB Servicios Corporativos y Capital Humano', 'UEB-SCCH07', 'EMPRESARIAL', 'active',
    'Centro de servicios compartidos de nóminas, administración laboral, archivo central y soporte legal.',
    'Calle L No. 354 e/ 21 y 23, El Vedado', 'Plaza de la Revolución', 'La Habana', '10400',
    true, true, true, 'CUENTA-UEB-SCCH07',
    'Ministerio de Industrias (MINDUS)', 'Servicios Técnicos, Consultoría y Formación',
    'CIL-2200-05402', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_scch;

  INSERT INTO public.organization_entities (
    company_client_id, parent_id, entity_type, name, code, regime_id, status,
    description, address, municipality, province, postal_code,
    is_active, is_sitecorp_account, account_is_active, account_code,
    organism, branch, labor_identification_code, revolution_year
  ) VALUES (
    v_client_id, v_ent_hgo, 'ueb',
    'UEB Aseguramiento Técnico, Academia y SST', 'UEB-ATAS08', 'EMPRESARIAL', 'active',
    'Centro de capacitación técnica ramal, laboratorio de ergonomía, metrología y gestión integral de SST.',
    'Ave. Paseo No. 608 e/ 25 y 27, El Vedado', 'Plaza de la Revolución', 'La Habana', '10400',
    true, true, true, 'CUENTA-UEB-ATAS08',
    'Ministerio de Industrias (MINDUS)', 'Servicios Técnicos, Consultoría y Formación',
    'CIL-2200-05403', 'Año 68 de la Revolución'
  )
  RETURNING id INTO v_ent_atas;

  v_entity_ids := ARRAY[
    v_ent_osde, v_ent_hsi, v_ent_hlt, v_ent_hmi, v_ent_hgo,
    v_ent_mmih, v_ent_acar, v_ent_bcfm, v_ent_adco, v_ent_mer,
    v_ent_cse, v_ent_scch, v_ent_atas
  ];

  -- 2.2 Planes comerciales por entidad (`entity_plans` + `entity_plan_history` = BASIC_FULL)
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];

    INSERT INTO public.entity_plans (
      entity_id, company_client_id,
      package_basic, package_prenomina, package_training_sst,
      plan_combination, created_by, updated_by, created_at, updated_at
    ) VALUES (
      v_ent_id, v_client_id,
      true, true, true,
      'BASIC_FULL', v_actor_user_id, v_actor_user_id,
      now() - interval '18 months', now() - interval '6 months'
    )
    RETURNING id INTO v_plan_id;

    INSERT INTO public.entity_plan_history (
      plan_id, entity_id, operation_type,
      previous_combination, new_combination,
      previous_packages, new_packages,
      added_packages, removed_packages,
      reason, changed_by, changed_by_email, created_at
    ) VALUES
      (
        v_plan_id, v_ent_id, 'CREACION',
        NULL, 'BASIC_PRENOMINA',
        NULL, '{"basic": true, "prenomina": true, "training_sst": false}'::jsonb,
        ARRAY['Paquete Básico', 'Paquete Prenómina'], ARRAY[]::text[],
        'Alta inicial de la cuenta corporativa en el despliegue del Grupo Empresarial Horizonte.',
        v_actor_user_id, COALESCE(v_actor_email, 'soporte@sitecorp.cu'),
        now() - interval '18 months'
      ),
      (
        v_plan_id, v_ent_id, 'AMPLIACION',
        'BASIC_PRENOMINA', 'BASIC_FULL',
        '{"basic": true, "prenomina": true, "training_sst": false}'::jsonb,
        '{"basic": true, "prenomina": true, "training_sst": true}'::jsonb,
        ARRAY['Paquete Capacitación y SST'], ARRAY[]::text[],
        'Incorporación integral de los módulos de Capacitación y Seguridad y Salud en el Trabajo (SST).',
        v_actor_user_id, COALESCE(v_actor_email, 'soporte@sitecorp.cu'),
        now() - interval '6 months'
      );
  END LOOP;

  -- ==========================================================================
  -- 3. REPRESENTANTES FORMALES POR ENTIDAD (2 CARGOS POR ENTIDAD + HISTÓRICO)
  -- ==========================================================================
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];

    INSERT INTO public.organization_representative_positions (
      company_client_id, organization_entity_id, title, display_order, is_active
    ) VALUES (
      v_client_id, v_ent_id,
      CASE
        WHEN v_ent_idx = 1 THEN 'Presidente del Grupo Empresarial'
        WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Director General de Empresa'
        ELSE 'Director de Unidad Empresarial de Base'
      END,
      1, true
    )
    RETURNING id INTO v_rep_pos_1;

    INSERT INTO public.organization_representative_positions (
      company_client_id, organization_entity_id, title, display_order, is_active
    ) VALUES (
      v_client_id, v_ent_id,
      CASE
        WHEN v_ent_idx = 1 THEN 'Director Corporativo de Capital Humano'
        WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Director de Capital Humano'
        ELSE 'Jefe de Grupo de Capital Humano'
      END,
      2, true
    )
    RETURNING id INTO v_rep_pos_2;

    -- Si la entidad pertenece a las primeras 6, agregamos un titular histórico previo cerrado
    IF v_ent_idx <= 6 THEN
      INSERT INTO public.organization_representative_assignments (
        company_client_id, organization_entity_id, representative_position_id,
        person_name, effective_from, effective_to
      ) VALUES (
        v_client_id, v_ent_id, v_rep_pos_1,
        'Ing. ' || v_male_names[v_ent_idx + 10] || ' ' || v_surnames[v_ent_idx * 3] || ' ' || v_surnames[v_ent_idx * 3 + 1],
        DATE '2021-01-15', DATE '2023-12-31'
      );
    END IF;

    -- Asignaciones vigentes de representantes
    INSERT INTO public.organization_representative_assignments (
      company_client_id, organization_entity_id, representative_position_id,
      person_name, effective_from, effective_to
    ) VALUES (
      v_client_id, v_ent_id, v_rep_pos_1,
      'Ing. ' || v_male_names[v_ent_idx] || ' ' || v_surnames[v_ent_idx] || ' ' || v_surnames[v_ent_idx + 13],
      CASE WHEN v_ent_idx <= 6 THEN DATE '2024-01-01' ELSE DATE '2022-03-01' END,
      NULL
    )
    RETURNING id INTO v_rep_ass_1;

    v_rep_assign_ids := array_append(v_rep_assign_ids, v_rep_ass_1);

    INSERT INTO public.organization_representative_assignments (
      company_client_id, organization_entity_id, representative_position_id,
      person_name, effective_from, effective_to
    ) VALUES (
      v_client_id, v_ent_id, v_rep_pos_2,
      'Lic. ' || v_female_names[v_ent_idx] || ' ' || v_surnames[v_ent_idx + 26] || ' ' || v_surnames[v_ent_idx + 39],
      DATE '2022-06-01',
      NULL
    )
    RETURNING id INTO v_rep_ass_2;
  END LOOP;

  -- ==========================================================================
  -- 4. ESCALA SALARIAL EMPRESARIAL (GRUPOS I AL XXIV: 2 800 A 16 200 CUP),
  --    ANTIGÜEDAD Y CATEGORÍA ACADÉMICA
  -- ==========================================================================
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];

    SELECT name INTO v_ent_name FROM public.organization_entities WHERE id = v_ent_id;

    INSERT INTO public.salary_scales (
      scope_type, company_client_id, organization_entity_id, regime_id,
      name, description, currency_code, is_active
    ) VALUES (
      'EMPRESARIAL_ENTITY', v_client_id, v_ent_id, 'EMPRESARIAL',
      'Escala Salarial Empresarial · ' || v_ent_name,
      'Clasificador salarial de complejidad de 24 grupos (I al XXIV: 2 800,00 a 16 200,00 CUP) aprobado para el sistema empresarial Horizonte.',
      'CUP', true
    )
    RETURNING id INTO v_scale_id;

    v_scale_ids := array_append(v_scale_ids, v_scale_id);

    -- 24 grupos salariales (I al XXIV)
    FOR v_i IN 1..24 LOOP
      INSERT INTO public.salary_groups (
        salary_scale_id, sequence_number, description, is_active
      ) VALUES (
        v_scale_id, v_i,
        'Grupo Salarial ' || v_group_romans[v_i] || ' · Complejidad Nivel ' || v_i,
        true
      )
      RETURNING id INTO v_group_id;

      -- Para los grupos VII al XVIII, insertamos una versión histórica previa cerrada en 2024
      IF v_i BETWEEN 7 AND 18 THEN
        INSERT INTO public.salary_group_values (
          salary_group_id, amount, currency_code, effective_from, effective_to, is_active
        ) VALUES (
          v_group_id,
          round(v_group_amounts[v_i] * 0.90, 2),
          'CUP',
          DATE '2022-01-01',
          DATE '2024-06-30',
          false
        );
      END IF;

      -- Valor vigente activo del grupo salarial (2 800,00 a 16 200,00 CUP)
      INSERT INTO public.salary_group_values (
        salary_group_id, amount, currency_code, effective_from, effective_to, is_active
      ) VALUES (
        v_group_id,
        v_group_amounts[v_i],
        'CUP',
        CASE WHEN v_i BETWEEN 7 AND 18 THEN DATE '2024-07-01' ELSE DATE '2022-01-01' END,
        NULL,
        true
      );
    END LOOP;

    -- Escala de pago por antigüedad (`tenure_payment_scales`: 4 tramos por entidad)
    INSERT INTO public.tenure_payment_scales (
      organization_entity_id, from_months, to_months, amount, is_active
    ) VALUES
      (v_ent_id, 12,  36,  350.00, true),
      (v_ent_id, 36,  60,  650.00, true),
      (v_ent_id, 60,  120, 1050.00, true),
      (v_ent_id, 120, NULL, 1550.00, true);

    -- Pago por categoría científica/académica (`academic_category_payments`: MASTER y DOCTOR)
    INSERT INTO public.academic_category_payments (
      scope_type, organization_entity_id, company_client_id, regime_id,
      category, amount, currency_code, is_active, created_by
    ) VALUES
      (
        'EMPRESARIAL_ENTITY', v_ent_id, v_client_id, 'EMPRESARIAL',
        'MASTER', 950.00, 'CUP', true, v_actor_user_id
      ),
      (
        'EMPRESARIAL_ENTITY', v_ent_id, v_client_id, 'EMPRESARIAL',
        'DOCTOR', 1600.00, 'CUP', true, v_actor_user_id
      );
  END LOOP;

  -- ==========================================================================
  -- 5. ESTRUCTURA DE PLANTILLA: 46 ÁREAS, 85 CARGOS Y 111 PUESTOS (200 PLAZAS)
  -- ==========================================================================
  TRUNCATE TABLE tmp_demo_areas, tmp_demo_jobs, tmp_demo_positions;

  -- 5.1 Construcción de las 46 Áreas Organizativas
  v_i := 0;
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];
    v_k := CASE WHEN v_ent_idx IN (1,2,3,4,5,6,8) THEN 4 ELSE 3 END;
    v_parent_area_id := NULL;

    FOR v_j IN 1..v_k LOOP
      v_i := v_i + 1;

      -- Si es área subordinada (v_j > 1), depende del área de orden 1 de su misma entidad
      IF v_j = 1 THEN
        v_parent_area_id := NULL;
      ELSE
        SELECT a.area_id INTO v_parent_area_id
        FROM tmp_demo_areas a
        WHERE a.entity_idx = v_ent_idx AND a.hierarchy_order = 1
        LIMIT 1;
      END IF;

      v_area_name := CASE
        WHEN v_j = 1 THEN
          CASE
            WHEN v_ent_idx = 1 THEN 'Presidencia y Dirección Corporativa'
            WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Dirección General y Estrategia'
            ELSE 'Dirección de Unidad Empresarial'
          END
        WHEN v_j = 2 THEN
          CASE
            WHEN v_ent_idx = 1 THEN 'Dirección Corporativa de Capital Humano y Organización'
            WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Dirección de Capital Humano y Seguridad Laboral'
            ELSE 'Departamento de Capital Humano, Economía y Control'
          END
        WHEN v_j = 3 THEN
          CASE v_ent_idx
            WHEN 1 THEN 'Dirección de Operaciones Industriales y Logística'
            WHEN 2 THEN 'Dirección Técnica de Producción y Montaje Industrial'
            WHEN 3 THEN 'Dirección de Operaciones de Flota y Tráfico'
            WHEN 4 THEN 'Dirección de Ingeniería Electromecánica y Redes'
            WHEN 5 THEN 'Dirección de Servicios Compartidos y Tecnología'
            WHEN 6 THEN 'Taller Central de Maquinado, Soldadura y Pailería'
            WHEN 7 THEN 'Planta de Automatización, Instrumentación y Calderas'
            WHEN 8 THEN 'Base de Operaciones de Tráfico y Flota Pesada'
            WHEN 9 THEN 'Centro de Almacenamiento Frigorífico y Despacho'
            WHEN 10 THEN 'Brigada de Alta Tensión, Protecciones y Bobinado'
            WHEN 11 THEN 'Brigada de Climatización Central y Grupos Electrógenos'
            WHEN 12 THEN 'Centro de Gestión de Nóminas, Contratos y Archivo'
            ELSE 'Centro de Formación Técnica, Metrología y SST'
          END
        ELSE
          CASE v_ent_idx
            WHEN 1 THEN 'Dirección Económico-Financiera y Jurídica'
            WHEN 2 THEN 'Dirección de Aseguramiento Técnico y Calidad'
            WHEN 3 THEN 'Dirección de Mantenimiento Vial y Almacenes'
            WHEN 4 THEN 'Dirección de Energética y Aseguramiento'
            WHEN 5 THEN 'Dirección de Consultoría Organizacional y Capacitación'
            WHEN 6 THEN 'Brigada de Montaje Industrial y Mantenimiento'
            ELSE 'Taller de Mantenimiento de Cuñas y Remolques'
          END
      END;

      INSERT INTO public.organization_areas (
        organization_entity_id, parent_area_id, name, description, hierarchy_order, is_active
      ) VALUES (
        v_ent_id, v_parent_area_id, v_area_name,
        'Estructura funcional de ' || v_area_name || ' integrada en la plantilla aprobada.',
        v_j, true
      )
      RETURNING id INTO v_area_id;

      INSERT INTO tmp_demo_areas VALUES (
        v_i, v_area_id, v_ent_idx, v_ent_id, v_parent_area_id, v_j,
        v_area_name,
        'Estructura funcional de ' || v_area_name || ' integrada en la plantilla aprobada.'
      );
    END LOOP;
  END LOOP;

  -- 5.2 Construcción de los 85 Cargos (`organization_jobs`)
  v_i := 0;
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];
    v_scale_id := v_scale_ids[v_ent_idx];
    v_k := CASE v_ent_idx
      WHEN 1 THEN 5
      WHEN 2 THEN 6 WHEN 3 THEN 6 WHEN 4 THEN 6 WHEN 5 THEN 6
      WHEN 6 THEN 8 WHEN 7 THEN 7 WHEN 8 THEN 8 WHEN 9 THEN 7
      WHEN 10 THEN 7 WHEN 11 THEN 6 WHEN 12 THEN 7 ELSE 6
    END;

    FOR v_j IN 1..v_k LOOP
      v_i := v_i + 1;

      SELECT a.area_seq, a.area_id
        INTO v_chk_areas, v_area_id
      FROM tmp_demo_areas a
      WHERE a.entity_idx = v_ent_idx
      ORDER BY
        CASE
          WHEN v_j = 1 THEN (CASE WHEN a.hierarchy_order = 1 THEN 0 ELSE 1 END)
          WHEN v_j IN (2, 3) THEN (CASE WHEN a.hierarchy_order = 2 THEN 0 ELSE 1 END)
          WHEN v_j IN (4, 5, 6) THEN (CASE WHEN a.hierarchy_order = 3 THEN 0 ELSE 1 END)
          ELSE (CASE WHEN a.hierarchy_order = 4 THEN 0 WHEN a.hierarchy_order = 3 THEN 1 ELSE 2 END)
        END,
        a.hierarchy_order ASC
      LIMIT 1;

      IF v_j = 1 THEN
        v_job_name := CASE
          WHEN v_ent_idx = 1 THEN 'Presidente del Grupo Empresarial'
          WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Director General de Empresa'
          ELSE 'Director de Unidad Empresarial de Base'
        END;
        v_sal_seq := CASE WHEN v_ent_idx = 1 THEN 24 WHEN v_ent_idx BETWEEN 2 AND 5 THEN 22 ELSE 20 END;
      ELSIF v_j = 2 THEN
        v_job_name := CASE
          WHEN v_ent_idx = 1 THEN 'Especialista Superior en Gestión de Capital Humano'
          WHEN v_ent_idx BETWEEN 2 AND 9 THEN 'Especialista Principal en Organización del Trabajo y Salarios'
          ELSE 'Especialista B en Gestión de Recursos Humanos'
        END;
        v_sal_seq := CASE WHEN v_ent_idx BETWEEN 2 AND 9 THEN 18 ELSE 16 END;
      ELSIF v_j = 3 THEN
        v_job_name := 'Especialista en Seguridad y Salud en el Trabajo y Capacitación';
        v_sal_seq := 16;
      ELSIF v_j = 4 THEN
        v_job_name := CASE
          WHEN v_ent_idx IN (1, 5, 12) THEN 'Analista Económico y de Control de Prenómina'
          WHEN v_ent_idx IN (2, 6, 7) THEN 'Ingeniero de Procesos Industriales y Control de Calidad'
          WHEN v_ent_idx IN (3, 8, 9) THEN 'Especialista en Tráfico, Logística y Cadena de Suministro'
          WHEN v_ent_idx IN (4, 10, 11) THEN 'Ingeniero Electricista de Mantenimiento y Protecciones'
          ELSE 'Especialista en Formación Técnica y Evaluación Ocupacional'
        END;
        v_sal_seq := 15;
      ELSIF v_j = 5 THEN
        v_job_name := CASE
          WHEN v_ent_idx = 1 THEN 'Asesor Jurídico y de Contratación Corporativa'
          WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Técnico en Gestión Documental y Control de Personal'
          WHEN v_ent_idx IN (6, 7) THEN 'Operario Integral de Maquinado CNC y Soldadura Especializada'
          WHEN v_ent_idx IN (8, 9) THEN 'Chofer de Cuña Tractora y Transporte de Carga Pesada'
          WHEN v_ent_idx IN (10, 11) THEN 'Electromecánico de Mantenimiento Industrial y Redes'
          ELSE 'Técnico en Administración Laboral y Expedientes'
        END;
        v_sal_seq := CASE WHEN v_ent_idx = 1 THEN 17 WHEN v_ent_idx BETWEEN 6 AND 11 THEN 12 ELSE 11 END;
      ELSIF v_j = 6 THEN
        v_job_name := CASE
          WHEN v_ent_idx BETWEEN 2 AND 5 THEN 'Auxiliar Administrativo y de Atención Corporativa'
          WHEN v_ent_idx IN (6, 7) THEN 'Pailero Soldador de Estructuras y Recipientes a Presión'
          WHEN v_ent_idx IN (8, 9) THEN 'Operador de Montacargas y Almacenes de Distribución'
          WHEN v_ent_idx IN (10, 11) THEN 'Técnico de Climatización Central y Grupos Electrógenos'
          ELSE 'Gestor de Archivo Técnico y Documentación'
        END;
        v_sal_seq := CASE WHEN v_ent_idx BETWEEN 2 AND 5 THEN 7 WHEN v_ent_idx IN (6,7,8,9,10,11) THEN 11 ELSE 8 END;
      ELSIF v_j = 7 THEN
        v_job_name := CASE
          WHEN v_ent_idx IN (6, 7) THEN 'Mecánico Ajustador Montador de Equipos Industriales'
          WHEN v_ent_idx IN (8, 9) THEN 'Mecánico Automotriz de Flota Pesada'
          WHEN v_ent_idx = 10 THEN 'Liniero Electricista de Redes y Subestaciones'
          ELSE 'Asistente de Control de Nóminas y Seguridad Social'
        END;
        v_sal_seq := CASE WHEN v_ent_idx = 12 THEN 9 ELSE 10 END;
      ELSE
        v_job_name := CASE
          WHEN v_ent_idx = 6 THEN 'Auxiliar de Taller Industrial y Pañol de Herramientas'
          ELSE 'Auxiliar de Operaciones Portuarias y Patio de Contenedores'
        END;
        v_sal_seq := 6;
      END IF;

      SELECT sg.id INTO v_group_id
      FROM public.salary_groups sg
      WHERE sg.salary_scale_id = v_scale_id
        AND sg.sequence_number = v_sal_seq
      LIMIT 1;

      v_is_princ := (v_j = 2 AND v_ent_idx BETWEEN 2 AND 9);

      INSERT INTO public.organization_jobs (
        organization_entity_id, area_id, name, description,
        salary_group_id, hierarchy_order, is_active, occupational_category_id,
        required_profession_or_trade, work_content,
        has_abnormal_conditions, cla_day_enabled, cla_day_hourly_rate, cla_night_enabled,
        is_cuadro, is_principal_specialist
      ) VALUES (
        v_ent_id, v_area_id, v_job_name,
        'Cargo estructural de la plantilla aprobada: ' || v_job_name,
        v_group_id, v_j, true,
        CASE
          WHEN v_j = 1 THEN v_cat_c
          WHEN v_j IN (2, 3, 4) OR (v_j = 5 AND v_ent_idx IN (1,2,3,4,5,12,13)) THEN v_cat_t
          WHEN (v_j = 6 AND v_ent_idx BETWEEN 2 AND 5) OR (v_j = 6 AND v_ent_idx IN (12,13)) OR (v_j = 7 AND v_ent_idx = 12) THEN v_cat_a
          WHEN v_j = 8 THEN v_cat_s
          ELSE v_cat_o
        END,
        CASE
          WHEN v_j = 1 THEN 'Ingeniería Industrial, Economía o Licenciatura afín con experiencia directiva'
          WHEN v_j IN (2, 3, 4) THEN 'Graduado de Nivel Superior en Ingeniería, Economía, Derecho o Recursos Humanos'
          WHEN v_j >= 5 AND v_ent_idx BETWEEN 6 AND 11 THEN 'Técnico Medio u Obrero Calificado en Maquinado, Soldadura, Transporte o Electromecánica'
          ELSE 'Técnico Medio en Gestión Administrativa, Economía o Servicios Corporativos'
        END,
        'Planificar, ejecutar y controlar las actividades inherentes al cargo de ' || v_job_name || ', cumpliendo las normas de calidad, disciplina laboral y seguridad y salud en el trabajo vigentes en el Grupo Empresarial Horizonte.',
        (v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5),
        (v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5),
        CASE WHEN v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5 THEN 18.50 ELSE NULL END,
        (v_ent_idx BETWEEN 6 AND 11 AND v_j IN (5, 6)),
        (v_j = 1),
        v_is_princ
      )
      RETURNING id INTO v_job_id;

      INSERT INTO tmp_demo_jobs VALUES (
        v_i, v_job_id, v_ent_idx, v_ent_id, v_chk_areas, v_area_id, v_j,
        v_job_name,
        CASE
          WHEN v_j = 1 THEN v_cat_c
          WHEN v_j IN (2, 3, 4) OR (v_j = 5 AND v_ent_idx IN (1,2,3,4,5,12,13)) THEN v_cat_t
          WHEN (v_j = 6 AND v_ent_idx BETWEEN 2 AND 5) OR (v_j = 6 AND v_ent_idx IN (12,13)) OR (v_j = 7 AND v_ent_idx = 12) THEN v_cat_a
          WHEN v_j = 8 THEN v_cat_s
          ELSE v_cat_o
        END,
        v_sal_seq,
        v_group_id,
        (v_j = 1),
        v_is_princ,
        (v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5),
        (v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5),
        CASE WHEN v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5 THEN 18.50 ELSE NULL END,
        (v_ent_idx BETWEEN 6 AND 11 AND v_j IN (5, 6)),
        CASE
          WHEN v_j = 1 THEN 'Ingeniería Industrial, Economía o Licenciatura afín con experiencia directiva'
          WHEN v_j IN (2, 3, 4) THEN 'Graduado de Nivel Superior en Ingeniería, Economía, Derecho o Recursos Humanos'
          WHEN v_j >= 5 AND v_ent_idx BETWEEN 6 AND 11 THEN 'Técnico Medio u Obrero Calificado en Maquinado, Soldadura, Transporte o Electromecánica'
          ELSE 'Técnico Medio en Gestión Administrativa, Economía o Servicios Corporativos'
        END,
        'Planificar, ejecutar y controlar las actividades inherentes al cargo de ' || v_job_name || ', cumpliendo las normas de calidad, disciplina laboral y seguridad y salud en el trabajo vigentes en el Grupo Empresarial Horizonte.'
      );

      IF v_prep_ns IS NOT NULL AND v_j <= 4 THEN
        INSERT INTO public.organization_job_preparation_levels (organization_job_id, preparation_level_id)
        VALUES (v_job_id, v_prep_ns) ON CONFLICT DO NOTHING;
      END IF;
      IF v_prep_tm IS NOT NULL AND v_j >= 3 THEN
        INSERT INTO public.organization_job_preparation_levels (organization_job_id, preparation_level_id)
        VALUES (v_job_id, v_prep_tm) ON CONFLICT DO NOTHING;
      END IF;
      IF v_prep_oc IS NOT NULL AND v_j >= 5 AND v_ent_idx BETWEEN 6 AND 11 THEN
        INSERT INTO public.organization_job_preparation_levels (organization_job_id, preparation_level_id)
        VALUES (v_job_id, v_prep_oc) ON CONFLICT DO NOTHING;
      END IF;

      IF v_ent_idx BETWEEN 6 AND 11 AND v_j IN (5, 6) THEN
        INSERT INTO public.organization_job_cla_night_segments (
          organization_job_id, organization_entity_id, segment_order,
          start_time, end_time, hourly_rate
        ) VALUES
          (v_job_id, v_ent_id, 1, TIME '19:00', TIME '23:00', 22.00),
          (v_job_id, v_ent_id, 2, TIME '23:00', TIME '07:00', 28.50);
      END IF;
    END LOOP;
  END LOOP;

  -- 5.3 Construcción de los 111 Puestos (`organization_positions`) con 200 plazas autorizadas
  --     y 165 plazas ocupadas (35 vacantes).
  v_i := 0;
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];
    SELECT address, municipality INTO v_ent_addr, v_ent_mun
    FROM public.organization_entities WHERE id = v_ent_id;

    v_k := CASE v_ent_idx
      WHEN 1 THEN 6
      WHEN 2 THEN 8 WHEN 3 THEN 8 WHEN 4 THEN 8 WHEN 5 THEN 8
      WHEN 6 THEN 11 WHEN 7 THEN 9 WHEN 8 THEN 11 WHEN 9 THEN 9
      WHEN 10 THEN 10 WHEN 11 THEN 8 WHEN 12 THEN 8 ELSE 7
    END;

    SELECT count(*) INTO v_chk_jobs FROM tmp_demo_jobs WHERE entity_idx = v_ent_idx;

    FOR v_j IN 1..v_k LOOP
      v_i := v_i + 1;

      SELECT j.job_seq, j.job_id, j.name
        INTO v_sal_seq, v_job_id, v_job_name
      FROM tmp_demo_jobs j
      WHERE j.entity_idx = v_ent_idx
      ORDER BY j.hierarchy_order ASC
      OFFSET (
        CASE
          WHEN v_j <= v_chk_jobs THEN v_j - 1
          ELSE LEAST(v_chk_jobs - 1, 3 + ((v_j - v_chk_jobs) % 3))
        END
      )
      LIMIT 1;

      v_pos_name := CASE
        WHEN v_j <= v_chk_jobs THEN v_job_name
        ELSE v_job_name || ' · Brigada / Turno ' || (v_j - v_chk_jobs + 1)
      END;

      v_work_loc := CASE
        WHEN v_j = 1 THEN 'Sede de Dirección · ' || v_ent_mun
        WHEN v_j IN (2, 3) THEN 'Oficina Técnica de Capital Humano y SST · ' || v_ent_mun
        WHEN v_ent_idx BETWEEN 6 AND 11 AND v_j >= 5 THEN 'Planta / Taller de Operaciones #' || (v_j - 3) || ' · ' || v_ent_mun
        ELSE 'Área Funcional Operativa · ' || v_ent_mun
      END;

      DECLARE
        v_ent_auth_total integer := CASE v_ent_idx
          WHEN 1 THEN 8
          WHEN 2 THEN 12 WHEN 3 THEN 12 WHEN 4 THEN 12 WHEN 5 THEN 12
          WHEN 6 THEN 22 WHEN 7 THEN 16 WHEN 8 THEN 22 WHEN 9 THEN 18
          WHEN 10 THEN 20 WHEN 11 THEN 16 WHEN 12 THEN 16 ELSE 14
        END;
        v_ent_occ_total integer := CASE v_ent_idx
          WHEN 1 THEN 7
          WHEN 2 THEN 10 WHEN 3 THEN 10 WHEN 4 THEN 10 WHEN 5 THEN 10
          WHEN 6 THEN 18 WHEN 7 THEN 13 WHEN 8 THEN 18 WHEN 9 THEN 15
          WHEN 10 THEN 17 WHEN 11 THEN 13 WHEN 12 THEN 13 ELSE 11
        END;
        v_rem_positions integer := v_k - 2;
        v_rem_auth integer := v_ent_auth_total - 2;
        v_rem_occ  integer := v_ent_occ_total - 2;
        v_idx_in_rem integer := v_j - 2;
        v_pos_auth integer;
        v_pos_occ  integer;
      BEGIN
        IF v_j IN (1, 2) THEN
          v_pos_auth := 1;
          v_pos_occ  := 1;
        ELSE
          v_pos_auth := (v_rem_auth / v_rem_positions)
                        + CASE WHEN v_idx_in_rem <= (v_rem_auth % v_rem_positions) THEN 1 ELSE 0 END;
          v_pos_occ  := (v_rem_occ / v_rem_positions)
                        + CASE WHEN v_idx_in_rem <= (v_rem_occ % v_rem_positions) THEN 1 ELSE 0 END;
        END IF;

        INSERT INTO public.organization_positions (
          organization_entity_id, job_id, name, description,
          position_order, is_active, authorized_quantity,
          work_location, daily_hours, weekly_hours, monthly_hours,
          break_minutes, schedule_notes
        ) VALUES (
          v_ent_id, v_job_id, v_pos_name,
          'Plaza estructural correspondiente al cargo ' || v_job_name || ' en ' || v_work_loc,
          v_j, true, v_pos_auth,
          v_work_loc, 8, 44, 190.6,
          30, 'Lunes a viernes de 08:00 a 17:00 (30 min almuerzo) y sábados alternos de 08:00 a 12:00 (44 h semanales / 190,6 h mensuales).'
        )
        RETURNING id INTO v_pos_id;

        INSERT INTO tmp_demo_positions VALUES (
          v_i, v_pos_id, v_ent_idx, v_ent_id, v_sal_seq, v_job_id, v_j,
          v_pos_name, v_work_loc, v_pos_auth, v_pos_occ
        );

        INSERT INTO public.position_schedule_segments (
          position_id, organization_entity_id, day_of_week,
          start_time, end_time, crosses_midnight, display_order
        ) VALUES
          (v_pos_id, v_ent_id, 1, TIME '08:00', TIME '17:00', false, 1),
          (v_pos_id, v_ent_id, 2, TIME '08:00', TIME '17:00', false, 2),
          (v_pos_id, v_ent_id, 3, TIME '08:00', TIME '17:00', false, 3),
          (v_pos_id, v_ent_id, 4, TIME '08:00', TIME '17:00', false, 4),
          (v_pos_id, v_ent_id, 5, TIME '08:00', TIME '17:00', false, 5),
          (v_pos_id, v_ent_id, 6, TIME '08:00', TIME '12:00', false, 6);
      END;
    END LOOP;
  END LOOP;

  -- ==========================================================================
  -- 6. PERSONAS, TRABAJADORES ACTIVOS (165), REINGRESOS (6+2), PROMOCIONES (10),
  --    RESOLUCIONES DE ESPECIALISTA PRINCIPAL (8), INACTIVOS (8) Y CANDIDATOS (14)
  -- ==========================================================================
  TRUNCATE TABLE tmp_demo_workers;

  -- 6.1 Crear los 165 trabajadores ACTIVOS ocupando exactamente las 165 plazas previstas
  v_i := 0;
  FOR v_k IN
    SELECT p.pos_seq
    FROM tmp_demo_positions p
    WHERE p.occupied_target > 0
    ORDER BY p.pos_seq ASC
  LOOP
    SELECT p.occupied_target INTO v_chk_occupied FROM tmp_demo_positions p WHERE p.pos_seq = v_k;

    FOR v_j IN 1..v_chk_occupied LOOP
      v_i := v_i + 1;

      SELECT
        p.entity_idx, p.entity_id, p.pos_id, p.name, p.work_location,
        j.job_seq, j.job_id, j.name, j.area_id, j.is_principal_specialist,
        j.salary_group_id, j.salary_group_seq,
        a.name, oc.name
      INTO
        v_ent_idx, v_ent_id, v_pos_id, v_pos_name, v_work_loc,
        v_chk_jobs, v_job_id, v_job_name, v_area_id, v_is_princ,
        v_group_id, v_sal_seq,
        v_area_name, v_cat_name
      FROM tmp_demo_positions p
      JOIN tmp_demo_jobs j ON j.job_seq = p.job_seq
      JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
      LEFT JOIN public.occupational_categories oc ON oc.id = j.occupational_category_id
      WHERE p.pos_seq = v_k;

      v_scale_id := v_scale_ids[v_ent_idx];
      v_sal_amount := v_group_amounts[v_sal_seq];

      IF (v_i % 2) = 1 THEN
        v_fname := v_male_names[((v_i - 1) % array_length(v_male_names, 1)) + 1];
        v_gender := v_gender_m;
      ELSE
        v_fname := v_female_names[((v_i - 1) % array_length(v_female_names, 1)) + 1];
        v_gender := v_gender_f;
      END IF;
      v_surname1 := v_surnames[((v_i * 3 - 2) % array_length(v_surnames, 1)) + 1];
      v_surname2 := v_surnames[((v_i * 7 + 5) % array_length(v_surnames, 1)) + 1];
      v_full_name := v_fname || ' ' || v_surname1 || ' ' || v_surname2;

      v_birth_date := DATE '1968-01-10' + ((v_i * 83) % 10500);
      v_ci := to_char(v_birth_date, 'YYMMDD') || lpad((40000 + v_i)::text, 5, '0');
      -- Patrón de código oficial de `public.migration_create_worker` (`TRB-` + 6 caracteres hexadecimales)
      v_worker_code := 'TRB-' || upper(substr(md5('horizonte-demo-worker-' || v_i::text), 1, 6));

      v_hire_date := CASE
        WHEN v_i BETWEEN 15 AND 20 THEN DATE '2024-03-01'
        WHEN v_i BETWEEN 25 AND 26 THEN DATE '2024-09-01'
        WHEN v_i >= 152 THEN (CURRENT_DATE - ((170 - v_i) * 4))::date
        ELSE DATE '2016-02-01' + ((v_i * 19) % 2800)
      END;

      v_has_doctor := (v_sal_seq >= 20 AND (v_i % 9) = 0);
      v_has_master := (NOT v_has_doctor AND v_sal_seq >= 15 AND (v_i % 4) = 0);

      v_marital := CASE (v_i % 4)
        WHEN 0 THEN v_marital_married
        WHEN 1 THEN v_marital_single
        WHEN 2 THEN v_marital_union
        ELSE v_marital_divorced
      END;

      v_edu := CASE
        WHEN v_sal_seq >= 15 THEN v_edu_sup
        WHEN v_sal_seq >= 10 THEN v_edu_tm
        ELSE v_edu_oc
      END;

      v_skin := CASE (v_i % 3)
        WHEN 0 THEN v_skin_1
        WHEN 1 THEN v_skin_2
        ELSE v_skin_3
      END;

      v_specialty := CASE
        WHEN v_sal_seq >= 18 THEN 'Ingeniería Industrial y Dirección Empresarial'
        WHEN v_sal_seq >= 15 THEN 'Economía, Contabilidad y Gestión del Capital Humano'
        WHEN v_ent_idx IN (3, 8, 9) THEN 'Explotación del Transporte Automotor y Logística'
        WHEN v_ent_idx IN (4, 10, 11) THEN 'Sistemas Eléctricos, Electromecánica y Climatización'
        ELSE 'Tecnología de Maquinado, Soldadura y Mantenimiento Industrial'
      END;
      v_prof := v_specialty;

      SELECT name, organism, branch, labor_identification_code, address, province, municipality, revolution_year
        INTO v_ent_name, v_ent_org, v_ent_branch, v_ent_labor_code, v_ent_addr, v_ent_prov, v_ent_mun, v_ent_rev_year
      FROM public.organization_entities WHERE id = v_ent_id;

      INSERT INTO public.workers (
        company_client_id, organization_entity_id, code,
        first_name, first_surname, second_surname, identification,
        birth_date, gender_id, marital_status_id, education_level_id,
        specialty, has_masters_degree, has_doctorate_degree,
        profession_or_trade, skin_color_id,
        address, province, municipality, phone, email,
        hire_date, employment_start_date, employment_status
      ) VALUES (
        v_client_id, v_ent_id, v_worker_code,
        v_fname, v_surname1, v_surname2, v_ci,
        v_birth_date, v_gender, v_marital, v_edu,
        v_specialty, v_has_master, v_has_doctor,
        v_prof, v_skin,
        'Calle ' || (10 + (v_i % 70)) || ' No. ' || (100 + v_i * 3) || ', Reparto Residencial',
        v_ent_prov, v_ent_mun,
        '+53 5' || lpad((2100000 + v_i * 137)::text, 7, '0'),
        lower(regexp_replace(v_fname || '.' || v_surname1 || v_i::text, '[^a-zA-Z0-9.]', '', 'g')) || '@horizonte-demo.cu',
        v_hire_date,
        CASE
          WHEN v_i BETWEEN 15 AND 20 THEN DATE '2019-02-01'
          WHEN v_i BETWEEN 25 AND 26 THEN DATE '2017-04-01'
          ELSE v_hire_date
        END,
        'active'
      )
      RETURNING id INTO v_worker_id;

      IF v_lic_b IS NOT NULL AND ((v_i % 3) = 0 OR v_ent_idx IN (3, 8, 9)) THEN
        INSERT INTO public.worker_driving_license_categories (worker_id, driving_license_category_id)
        VALUES (v_worker_id, v_lic_b) ON CONFLICT DO NOTHING;
      END IF;
      IF v_lic_c IS NOT NULL AND v_ent_idx IN (3, 8, 9) THEN
        INSERT INTO public.worker_driving_license_categories (worker_id, driving_license_category_id)
        VALUES (v_worker_id, v_lic_c) ON CONFLICT DO NOTHING;
      END IF;
      IF v_lic_e IS NOT NULL AND v_ent_idx = 8 AND v_sal_seq BETWEEN 10 AND 14 THEN
        INSERT INTO public.worker_driving_license_categories (worker_id, driving_license_category_id)
        VALUES (v_worker_id, v_lic_e) ON CONFLICT DO NOTHING;
      END IF;

      v_rep_ass_1 := v_rep_assign_ids[v_ent_idx];
      SELECT a.person_name, p.title
        INTO v_rep_name, v_rep_title
      FROM public.organization_representative_assignments a
      JOIN public.organization_representative_positions p ON p.id = a.representative_position_id
      WHERE a.id = v_rep_ass_1;

      -- ======================================================================
      -- CASOS ESPECIALES DE TRAYECTORIA HISTÓRICA (REINGRESOS Y DOBLE REINGRESO)
      -- ======================================================================
      IF v_i BETWEEN 15 AND 20 THEN
        -- 6 trabajadores con 1 reingreso previo (Período 1: 2019-02-01 al 2023-08-31)
        INSERT INTO public.worker_position_assignments (
          worker_id, position_id, start_date, end_date, is_current
        ) VALUES (
          v_worker_id, v_pos_id, DATE '2019-02-01', DATE '2023-08-31', false
        )
        RETURNING id INTO v_prev_assign_id;

        INSERT INTO public.employment_contracts (
          company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
          start_date, end_date, actual_end_date, is_current,
          salary_amount, salary_currency_code, salary_effective_date, salary_snapshot_status,
          representative_name_snapshot, representative_position_snapshot, representative_captured_at,
          entity_name_snapshot, entity_organism_snapshot, entity_branch_snapshot,
          entity_labor_code_snapshot, entity_address_snapshot, entity_province_snapshot, entity_municipality_snapshot,
          area_name_snapshot, job_name_snapshot, occupational_category_snapshot,
          position_name_snapshot, work_location_snapshot,
          work_jornada_snapshot, work_schedule_snapshot,
          daily_hours_snapshot, weekly_hours_snapshot, monthly_hours_snapshot, break_minutes_snapshot,
          profession_or_trade_snapshot, structure_captured_at,
          signature_date, signature_place, payment_method_id, payment_schedule_text,
          total_compensation_snapshot, conditions_captured_at
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_prev_assign_id, v_ctype_indet,
          DATE '2019-02-01', NULL, DATE '2023-08-31', false,
          round(v_sal_amount * 0.88, 2), 'CUP', DATE '2019-02-01', 'CAPTURED',
          v_rep_name, v_rep_title, TIMESTAMPTZ '2019-02-01 09:00:00+00',
          v_ent_name, v_ent_org, v_ent_branch, v_ent_labor_code, v_ent_addr, v_ent_prov, v_ent_mun,
          v_area_name, v_job_name, v_cat_name, v_pos_name, v_work_loc,
          '8 h/día · 44 h/semana · 190,6 h/mes · descanso 30 min',
          'Lunes a viernes 08:00–17:00 · Sábado 08:00–12:00',
          8, 44, 190.6, 30, v_prof, TIMESTAMPTZ '2019-02-01 09:00:00+00',
          DATE '2019-02-01', v_ent_mun, v_pay_time, 'Mensual, los días 5 de cada mes',
          round(v_sal_amount * 0.88, 2), TIMESTAMPTZ '2019-02-01 09:00:00+00'
        )
        RETURNING id INTO v_prev_contract_id;

        INSERT INTO public.worker_employment_movements (
          worker_id, movement_type, previous_assignment_id, new_assignment_id,
          effective_date, separation_reason_id, reason, notes, created_by
        ) VALUES (
          v_worker_id, 'BAJA', v_prev_assign_id, NULL,
          DATE '2023-08-31', v_sep_resignation, 'Baja a solicitud propia del trabajador',
          'Finalización del primer vínculo laboral conservando expediente único en la entidad.',
          v_actor_user_id
        );

        INSERT INTO public.worker_payroll_movements (
          company_client_id, organization_entity_id, worker_id, assignment_id, position_id,
          event_type, event_id, effective_date,
          organism_snapshot, company_snapshot, unit_snapshot,
          identification_snapshot, worker_name_snapshot, first_name_snapshot, first_surname_snapshot, second_surname_snapshot,
          area_act_snapshot, cargo_act_snapshot, ge_act_sequence, sal_act_snapshot, currency_snapshot,
          description, created_by
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_prev_assign_id, v_pos_id,
          'BAJA', v_prev_assign_id, DATE '2023-08-31',
          v_ent_org, v_ent_name, v_ent_name,
          v_ci, v_full_name, v_fname, v_surname1, v_surname2,
          v_area_name, v_job_name, v_sal_seq, round(v_sal_amount * 0.88, 2), 'CUP',
          'Baja del primer período laboral', v_actor_user_id
        );

      ELSIF v_i BETWEEN 25 AND 26 THEN
        -- 2 trabajadores con DOBLE REINGRESO previo (3 períodos laborales en total)
        INSERT INTO public.worker_position_assignments (
          worker_id, position_id, start_date, end_date, is_current
        ) VALUES (
          v_worker_id, v_pos_id, DATE '2017-04-01', DATE '2020-05-31', false
        )
        RETURNING id INTO v_prev_assign_id_2;

        INSERT INTO public.employment_contracts (
          company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
          start_date, end_date, actual_end_date, is_current,
          salary_amount, salary_currency_code, salary_effective_date, salary_snapshot_status,
          representative_name_snapshot, representative_position_snapshot, representative_captured_at,
          entity_name_snapshot, signature_date, signature_place, payment_method_id,
          total_compensation_snapshot, conditions_captured_at
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_prev_assign_id_2, v_ctype_det,
          DATE '2017-04-01', DATE '2020-05-31', DATE '2020-05-31', false,
          round(v_sal_amount * 0.80, 2), 'CUP', DATE '2017-04-01', 'CAPTURED',
          v_rep_name, v_rep_title, TIMESTAMPTZ '2017-04-01 09:00:00+00',
          v_ent_name, DATE '2017-04-01', v_ent_mun, v_pay_time,
          round(v_sal_amount * 0.80, 2), TIMESTAMPTZ '2017-04-01 09:00:00+00'
        )
        RETURNING id INTO v_prev_contract_id_2;

        INSERT INTO public.worker_employment_movements (
          worker_id, movement_type, previous_assignment_id, new_assignment_id,
          effective_date, separation_reason_id, reason, notes, created_by
        ) VALUES (
          v_worker_id, 'BAJA', v_prev_assign_id_2, NULL,
          DATE '2020-05-31', v_sep_end_contract, 'Terminación del término contractual inicial',
          'Primera baja histórica registrada en el expediente único.', v_actor_user_id
        );

        -- Período 2 (1er Reingreso): 2021-02-01 al 2023-11-30
        INSERT INTO public.worker_position_assignments (
          worker_id, position_id, start_date, end_date, is_current
        ) VALUES (
          v_worker_id, v_pos_id, DATE '2021-02-01', DATE '2023-11-30', false
        )
        RETURNING id INTO v_prev_assign_id;

        INSERT INTO public.employment_contracts (
          company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
          start_date, end_date, actual_end_date, is_current,
          salary_amount, salary_currency_code, salary_effective_date, salary_snapshot_status,
          representative_name_snapshot, representative_position_snapshot, representative_captured_at,
          entity_name_snapshot, signature_date, signature_place, payment_method_id,
          total_compensation_snapshot, conditions_captured_at
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_prev_assign_id, v_ctype_indet,
          DATE '2021-02-01', NULL, DATE '2023-11-30', false,
          round(v_sal_amount * 0.90, 2), 'CUP', DATE '2021-02-01', 'CAPTURED',
          v_rep_name, v_rep_title, TIMESTAMPTZ '2021-02-01 09:00:00+00',
          v_ent_name, DATE '2021-02-01', v_ent_mun, v_pay_time,
          round(v_sal_amount * 0.90, 2), TIMESTAMPTZ '2021-02-01 09:00:00+00'
        )
        RETURNING id INTO v_prev_contract_id;

        INSERT INTO public.worker_employment_movements (
          worker_id, movement_type, previous_assignment_id, new_assignment_id,
          effective_date, reason, notes, created_by
        ) VALUES (
          v_worker_id, 'REINCORPORACION', v_prev_assign_id_2, v_prev_assign_id,
          DATE '2021-02-01', 'Primera reincorporación laboral a la entidad',
          'Reincorporación aprobada por necesidad productiva de la unidad.', v_actor_user_id
        );

        INSERT INTO public.worker_employment_movements (
          worker_id, movement_type, previous_assignment_id, new_assignment_id,
          effective_date, separation_reason_id, reason, notes, created_by
        ) VALUES (
          v_worker_id, 'BAJA', v_prev_assign_id, NULL,
          DATE '2023-11-30', v_sep_transfer, 'Traslado temporal por misión técnica externa',
          'Segunda baja histórica registrada en el expediente único.', v_actor_user_id
        );
      END IF;

      -- ======================================================================
      -- CASO ESPECIAL: 10 TRABAJADORES CON PROMOCIÓN / CAMBIO DE PUESTO (worker_seq 30..39)
      -- ======================================================================
      IF v_i BETWEEN 30 AND 39 AND NOT v_is_princ THEN
        SELECT p2.pos_id, p2.name, p2.work_location, j2.name, j2.salary_group_seq, a2.name, oc2.name
          INTO v_prev_pos_id, v_prev_pos_name, v_prev_work_loc, v_prev_job_name, v_prev_sal_seq, v_prev_area_name, v_prev_cat_name
        FROM tmp_demo_positions p2
        JOIN tmp_demo_jobs j2 ON j2.job_seq = p2.job_seq
        JOIN tmp_demo_areas a2 ON a2.area_seq = j2.area_seq
        LEFT JOIN public.occupational_categories oc2 ON oc2.id = j2.occupational_category_id
        WHERE p2.entity_idx = v_ent_idx
          AND p2.pos_id <> v_pos_id
        ORDER BY p2.position_order DESC
        LIMIT 1;

        v_prev_sal_amount := v_group_amounts[COALESCE(v_prev_sal_seq, GREATEST(1, v_sal_seq - 2))];

        INSERT INTO public.worker_position_assignments (
          worker_id, position_id, start_date, end_date, is_current
        ) VALUES (
          v_worker_id, v_prev_pos_id, v_hire_date, DATE '2025-02-28', false
        )
        RETURNING id INTO v_prev_assign_id;
      END IF;

      -- ======================================================================
      -- ASIGNACIÓN DE PUESTO VIGENTE (LOS 165 TRABAJADORES ACTIVOS)
      -- ======================================================================
      INSERT INTO public.worker_position_assignments (
        worker_id, position_id, start_date, end_date, is_current
      ) VALUES (
        v_worker_id,
        v_pos_id,
        CASE WHEN v_i BETWEEN 30 AND 39 AND NOT v_is_princ THEN DATE '2025-03-01' ELSE v_hire_date END,
        NULL,
        true
      )
      RETURNING id INTO v_assign_id;

      IF (v_i BETWEEN 15 AND 20) OR (v_i BETWEEN 25 AND 26) THEN
        INSERT INTO public.worker_employment_movements (
          worker_id, movement_type, previous_assignment_id, new_assignment_id,
          effective_date, reason, notes, created_by
        ) VALUES (
          v_worker_id, 'REINCORPORACION', v_prev_assign_id, v_assign_id,
          v_hire_date,
          CASE WHEN v_i BETWEEN 25 AND 26 THEN 'Segunda reincorporación al puesto operativo' ELSE 'Reincorporación desde bandeja de Reingresos' END,
          'Reincorporación formalizada conservando historial íntegro de períodos anteriores.',
          v_actor_user_id
        );
      END IF;

      -- ======================================================================
      -- FORMALIZACIÓN: 8 ESPECIALISTAS PRINCIPALES (RESOLUCIÓN) vs 157 CONTRATOS
      -- ======================================================================
      IF v_is_princ THEN
        v_contract_id := NULL;

        INSERT INTO public.worker_documents (
          worker_id, document_type_id, employment_contract_id,
          file_name, storage_path, mime_type, file_size,
          description, source, uploaded_by
        ) VALUES (
          v_worker_id, 'RESOLUTION', NULL,
          'Resolucion_Nombramiento_GEH_' || lpad(v_i::text, 4, '0') || '.pdf',
          'demo/resolutions/' || v_worker_id::text || '/Resolucion_GEH_' || lpad(v_i::text, 4, '0') || '.pdf',
          'application/pdf', 248600,
          'Resolución oficial de nombramiento en cargo de Especialista Principal',
          'GENERATED', v_actor_user_id
        )
        RETURNING id INTO v_doc_id;

        SELECT oe_parent.name INTO v_parent_ent_name
        FROM public.organization_entities oe
        LEFT JOIN public.organization_entities oe_parent ON oe_parent.id = oe.parent_id
        WHERE oe.id = v_ent_id;

        INSERT INTO public.worker_resolutions (
          company_client_id, organization_entity_id, worker_id,
          assignment_id, position_id, job_id, event_type, resolution_date,
          worker_name_snapshot, worker_identification_snapshot,
          entity_name_snapshot, parent_company_name_snapshot,
          municipality_snapshot, revolution_year_snapshot,
          job_name_snapshot, salary_group_sequence_snapshot,
          salary_amount_snapshot, salary_currency_snapshot,
          work_content_snapshot, representative_assignment_id,
          representative_name_snapshot, representative_position_snapshot,
          worker_document_id, status, generated_at, created_by
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id,
          v_assign_id, v_pos_id, v_job_id, 'HIRE', v_hire_date,
          v_full_name, v_ci,
          v_ent_name, v_parent_ent_name,
          v_ent_mun, v_ent_rev_year,
          v_job_name, v_sal_seq,
          v_sal_amount, 'CUP',
          'Dirigir metodológicamente los estudios de organización del trabajo, ingeniería de métodos, plantillas de cargos y sistemas de pago de la entidad.',
          v_rep_ass_1, v_rep_name, v_rep_title,
          v_doc_id, 'GENERATED', now() - interval '60 days', v_actor_user_id
        )
        RETURNING id INTO v_resolution_id;
      ELSE
        v_resolution_id := NULL;

        INSERT INTO public.employment_contracts (
          company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
          start_date, end_date, actual_end_date, is_current,
          salary_amount, salary_currency_code, salary_effective_date, salary_snapshot_status,
          representative_name_snapshot, representative_position_snapshot, representative_captured_at,
          entity_name_snapshot, entity_organism_snapshot, entity_branch_snapshot,
          entity_labor_code_snapshot, entity_address_snapshot, entity_province_snapshot, entity_municipality_snapshot,
          area_name_snapshot, job_name_snapshot, occupational_category_snapshot,
          position_name_snapshot, work_location_snapshot,
          work_jornada_snapshot, work_schedule_snapshot,
          daily_hours_snapshot, weekly_hours_snapshot, monthly_hours_snapshot, break_minutes_snapshot,
          profession_or_trade_snapshot, structure_captured_at,
          signature_date, signature_place, payment_method_id, payment_schedule_text,
          total_compensation_snapshot, conditions_captured_at
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_assign_id,
          CASE WHEN v_i BETWEEN 140 AND 151 OR (v_i % 9) = 0 THEN v_ctype_det ELSE v_ctype_indet END,
          v_hire_date,
          CASE
            WHEN v_i BETWEEN 140 AND 151 THEN (CURRENT_DATE + ((v_i - 139) * 3 + 4))::date
            WHEN (v_i % 9) = 0 THEN (CURRENT_DATE + interval '8 months')::date
            ELSE NULL
          END,
          NULL, true,
          v_sal_amount, 'CUP',
          CASE WHEN v_i BETWEEN 30 AND 39 THEN DATE '2025-03-01' ELSE v_hire_date END,
          'CAPTURED',
          v_rep_name, v_rep_title, now() - interval '90 days',
          v_ent_name, v_ent_org, v_ent_branch, v_ent_labor_code, v_ent_addr, v_ent_prov, v_ent_mun,
          v_area_name, v_job_name, v_cat_name,
          v_pos_name, v_work_loc,
          '8 h/día · 44 h/semana · 190,6 h/mes · descanso 30 min',
          'Lunes a viernes 08:00–17:00 · Sábado 08:00–12:00',
          8, 44, 190.6, 30,
          v_prof, now() - interval '90 days',
          v_hire_date, v_ent_mun,
          CASE WHEN v_ent_idx BETWEEN 6 AND 11 AND (v_i % 4) = 0 THEN v_pay_perf ELSE v_pay_time END,
          'Mensual, dentro de los primeros 5 días hábiles de cada mes vencido',
          v_sal_amount + CASE WHEN (v_i % 3) = 0 THEN 650.00 ELSE 0 END,
          now() - interval '90 days'
        )
        RETURNING id INTO v_contract_id;

        IF (v_i % 3) = 0 THEN
          INSERT INTO public.employment_contract_compensation_components (
            employment_contract_id, component_type, description, amount, display_order
          ) VALUES (
            v_contract_id, 'ADDITIONAL_PAYMENT',
            'Coeficiente de interés económico-social y alta responsabilidad técnica',
            650.00, 1
          );
        END IF;

        INSERT INTO public.worker_documents (
          worker_id, document_type_id, employment_contract_id,
          file_name, storage_path, mime_type, file_size,
          description, source, uploaded_by
        ) VALUES (
          v_worker_id, 'CONTRACT', v_contract_id,
          'Contrato_Trabajo_GEH_' || lpad(v_i::text, 4, '0') || '.pdf',
          'demo/contracts/' || v_worker_id::text || '/Contrato_GEH_' || lpad(v_i::text, 4, '0') || '.pdf',
          'application/pdf', 312400,
          'Contrato de trabajo formalizado y firmado por las partes',
          'GENERATED', v_actor_user_id
        );
      END IF;

      -- Histórico salarial (`worker_salary_history`) y Movimiento de Nómina ALTA
      INSERT INTO public.worker_salary_history (
        organization_entity_id,
        worker_id, employment_contract_id, assignment_id,
        salary_group_id, salary_scale_id,
        previous_amount, new_amount, currency_code,
        effective_date, change_type, source, notes
      ) VALUES (
        v_ent_id,
        v_worker_id, v_contract_id,
        CASE WHEN v_i BETWEEN 30 AND 39 AND NOT v_is_princ THEN v_prev_assign_id ELSE v_assign_id END,
        v_group_id, v_scale_id,
        NULL,
        CASE WHEN v_i BETWEEN 30 AND 39 AND NOT v_is_princ THEN v_prev_sal_amount ELSE v_sal_amount END,
        'CUP',
        v_hire_date,
        CASE WHEN (v_i BETWEEN 15 AND 20) OR (v_i BETWEEN 25 AND 26) THEN 'REINCORPORATION' ELSE 'INITIAL_CONTRACT' END,
        CASE WHEN (v_i BETWEEN 15 AND 20) OR (v_i BETWEEN 25 AND 26) THEN 'REINCORPORATION' ELSE 'INITIAL_CONTRACT' END,
        'Captura salarial inicial al formalizar relación laboral en Grupo Empresarial Horizonte.'
      )
      RETURNING id INTO v_hist_id;

      INSERT INTO public.worker_payroll_movements (
        company_client_id, organization_entity_id, worker_id, assignment_id, position_id,
        event_type, event_id, effective_date,
        organism_snapshot, company_snapshot, unit_snapshot,
        identification_snapshot, worker_name_snapshot, first_name_snapshot, first_surname_snapshot, second_surname_snapshot,
        area_act_snapshot, cargo_act_snapshot, ge_act_sequence, sal_act_snapshot, currency_snapshot,
        description, created_by
      ) VALUES (
        v_client_id, v_ent_id, v_worker_id, v_assign_id, v_pos_id,
        'ALTA', v_assign_id, v_hire_date,
        v_ent_org, v_ent_name, v_ent_name,
        v_ci, v_full_name, v_fname, v_surname1, v_surname2,
        v_area_name, v_job_name, v_sal_seq, v_sal_amount, 'CUP',
        'Movimiento de nómina de alta en plantilla', v_actor_user_id
      );

      -- Para los 10 trabajadores promovidos / reubicados (`worker_seq` 30..39):
      IF v_i BETWEEN 30 AND 39 AND NOT v_is_princ THEN
        INSERT INTO public.worker_employment_movements (
          worker_id, movement_type, previous_assignment_id, new_assignment_id,
          effective_date, reason, notes, created_by
        ) VALUES (
          v_worker_id, 'CAMBIO_PUESTO', v_prev_assign_id, v_assign_id,
          DATE '2025-03-01',
          'Promoción a cargo de mayor calificación y complejidad técnica',
          'Evaluación satisfactoria del comité de expertos y disponibilidad de plaza vacante.',
          v_actor_user_id
        );

        INSERT INTO public.worker_salary_history (
          organization_entity_id,
          worker_id, employment_contract_id, assignment_id,
          salary_group_id, salary_scale_id,
          previous_amount, new_amount, currency_code,
          effective_date, change_type, source, notes
        ) VALUES (
          v_ent_id,
          v_worker_id, v_contract_id, v_assign_id,
          v_group_id, v_scale_id,
          v_prev_sal_amount, v_sal_amount, 'CUP',
          DATE '2025-03-01', 'POSITION_CHANGE', 'POSITION_CHANGE',
          'Actualización salarial por promoción de puesto.'
        )
        RETURNING id INTO v_hist_id;

        INSERT INTO public.contract_addendums (
          addendum_number, company_client_id, organization_entity_id,
          worker_id, employment_contract_id,
          addendum_type, document_type_id, status, effective_date,
          reason_code, reason, notes,
          source_type, source_id, salary_history_id,
          signature_date, signature_place, representative_assignment_id,
          representative_name_snapshot, representative_position_snapshot, representative_captured_at,
          previous_amount, new_amount, total_before, total_after, currency_code,
          created_by, formalized_by, formalized_at
        ) VALUES (
          1, v_client_id, v_ent_id,
          v_worker_id, v_contract_id,
          'CONTRACT_VARIATION_ADDENDUM', 'CONTRACT_ADDENDUM', 'FORMALIZED', DATE '2025-03-01',
          'POSITION_CHANGE', 'Promoción a plaza de mayor complejidad técnica',
          'Suplemento contractual formalizado por reubicación definitiva.',
          'POSITION_CHANGE', v_assign_id, v_hist_id,
          DATE '2025-03-01', v_ent_mun, v_rep_ass_1,
          v_rep_name, v_rep_title, TIMESTAMPTZ '2025-03-01 10:00:00+00',
          v_prev_sal_amount, v_sal_amount,
          v_prev_sal_amount + CASE WHEN (v_i % 3) = 0 THEN 650.00 ELSE 0 END,
          v_sal_amount + CASE WHEN (v_i % 3) = 0 THEN 650.00 ELSE 0 END,
          'CUP',
          v_actor_user_id, v_actor_user_id, TIMESTAMPTZ '2025-03-01 10:15:00+00'
        )
        RETURNING id INTO v_addendum_id;

        INSERT INTO public.employment_contract_addendum_changes (
          company_client_id, organization_entity_id, addendum_id, field_code,
          old_value, new_value, old_display_value, new_display_value,
          old_reference_id, new_reference_id, display_order
        ) VALUES
          (
            v_client_id, v_ent_id, v_addendum_id, 'JOB',
            v_prev_job_name, v_job_name, v_prev_job_name, v_job_name,
            NULL, v_job_id, 1
          ),
          (
            v_client_id, v_ent_id, v_addendum_id, 'POSITION',
            v_prev_pos_name, v_pos_name, v_prev_pos_name, v_pos_name,
            v_prev_pos_id, v_pos_id, 2
          ),
          (
            v_client_id, v_ent_id, v_addendum_id, 'SALARY_GROUP',
            v_group_romans[COALESCE(v_prev_sal_seq, GREATEST(1, v_sal_seq - 2))],
            v_group_romans[v_sal_seq],
            'Grupo ' || v_group_romans[COALESCE(v_prev_sal_seq, GREATEST(1, v_sal_seq - 2))],
            'Grupo ' || v_group_romans[v_sal_seq],
            NULL, v_group_id, 3
          ),
          (
            v_client_id, v_ent_id, v_addendum_id, 'SALARY',
            v_prev_sal_amount::text, v_sal_amount::text,
            v_prev_sal_amount::text || ' CUP', v_sal_amount::text || ' CUP',
            NULL, NULL, 4
          );

        INSERT INTO public.worker_payroll_movements (
          company_client_id, organization_entity_id, worker_id, assignment_id, position_id,
          event_type, event_id, effective_date,
          organism_snapshot, company_snapshot, unit_snapshot,
          identification_snapshot, worker_name_snapshot, first_name_snapshot, first_surname_snapshot, second_surname_snapshot,
          area_act_snapshot, cargo_act_snapshot, area_nva_snapshot, cargo_nva_snapshot,
          ge_act_sequence, sal_act_snapshot, ge_nva_sequence, sal_nva_snapshot, currency_snapshot,
          description, created_by
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_assign_id, v_pos_id,
          'REUBICACION', v_assign_id, DATE '2025-03-01',
          v_ent_org, v_ent_name, v_ent_name,
          v_ci, v_full_name, v_fname, v_surname1, v_surname2,
          v_prev_area_name, v_prev_job_name, v_area_name, v_job_name,
          COALESCE(v_prev_sal_seq, GREATEST(1, v_sal_seq - 2)), v_prev_sal_amount,
          v_sal_seq, v_sal_amount, 'CUP',
          'Promoción interna con anexo formalizado', v_actor_user_id
        );
      END IF;

      INSERT INTO tmp_demo_workers VALUES (
        v_i, v_worker_id, v_ent_idx, v_ent_id, v_k, v_pos_id, v_chk_jobs, v_job_id, v_area_id,
        v_assign_id, v_contract_id, v_resolution_id,
        v_is_princ, v_full_name, v_worker_code, v_ci,
        v_hire_date,
        CASE
          WHEN v_i BETWEEN 15 AND 20 THEN DATE '2019-02-01'
          WHEN v_i BETWEEN 25 AND 26 THEN DATE '2017-04-01'
          ELSE v_hire_date
        END,
        v_group_id, v_sal_seq, v_scale_id, v_sal_amount,
        v_has_master, v_has_doctor
      );
    END LOOP;
  END LOOP;

  -- 6.2 Crear los 8 expedientes de trabajadores INACTIVOS disponibles en la bandeja de Reingresos
  FOR v_j IN 1..8 LOOP
    v_i := 165 + v_j;
    v_ent_idx := 5 + v_j;
    v_ent_id := v_entity_ids[v_ent_idx];

    SELECT p.pos_id, p.name, p.work_location, j.name, j.salary_group_seq, a.name
      INTO v_pos_id, v_pos_name, v_work_loc, v_job_name, v_sal_seq, v_area_name
    FROM tmp_demo_positions p
    JOIN tmp_demo_jobs j ON j.job_seq = p.job_seq
    JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
    WHERE p.entity_idx = v_ent_idx
      AND p.authorized_quantity > p.occupied_target
    ORDER BY p.position_order ASC
    LIMIT 1;

    v_fname := CASE WHEN (v_j % 2) = 1 THEN v_male_names[20 + v_j] ELSE v_female_names[20 + v_j] END;
    v_surname1 := v_surnames[40 + v_j * 2];
    v_surname2 := v_surnames[50 + v_j * 2];
    v_full_name := v_fname || ' ' || v_surname1 || ' ' || v_surname2;
    v_birth_date := DATE '1978-04-12' + (v_j * 240);
    v_ci := to_char(v_birth_date, 'YYMMDD') || lpad((50000 + v_j)::text, 5, '0');
    v_worker_code := 'TRB-' || upper(substr(md5('horizonte-demo-worker-' || v_i::text), 1, 6));

    SELECT name, organism, province, municipality
      INTO v_ent_name, v_ent_org, v_ent_prov, v_ent_mun
    FROM public.organization_entities WHERE id = v_ent_id;

    INSERT INTO public.workers (
      company_client_id, organization_entity_id, code,
      first_name, first_surname, second_surname, identification,
      birth_date, gender_id, marital_status_id, education_level_id,
      specialty, has_masters_degree, has_doctorate_degree,
      profession_or_trade, skin_color_id,
      address, province, municipality, phone, email,
      hire_date, employment_start_date, employment_status
    ) VALUES (
      v_client_id, v_ent_id, v_worker_code,
      v_fname, v_surname1, v_surname2, v_ci,
      v_birth_date,
      CASE WHEN (v_j % 2) = 1 THEN v_gender_m ELSE v_gender_f END,
      v_marital_married, v_edu_tm,
      'Especialidad Técnica Industrial y Mantenimiento', false, false,
      'Técnico Operativo Industrial', v_skin_1,
      'Ave. Central No. ' || (300 + v_j * 15), v_ent_prov, v_ent_mun,
      '+53 5' || lpad((3800000 + v_j * 411)::text, 7, '0'),
      lower(regexp_replace(v_fname || '.' || v_surname1 || v_i::text, '[^a-zA-Z0-9.]', '', 'g')) || '@horizonte-demo.cu',
      DATE '2021-05-01', DATE '2021-05-01', 'inactive'
    )
    RETURNING id INTO v_worker_id;

    INSERT INTO public.worker_position_assignments (
      worker_id, position_id, start_date, end_date, is_current
    ) VALUES (
      v_worker_id, v_pos_id, DATE '2021-05-01', DATE '2025-06-30', false
    )
    RETURNING id INTO v_prev_assign_id;

    INSERT INTO public.employment_contracts (
      company_client_id, organization_entity_id, worker_id, assignment_id, contract_type_id,
      start_date, end_date, actual_end_date, is_current,
      salary_amount, salary_currency_code, salary_effective_date, salary_snapshot_status,
      entity_name_snapshot, area_name_snapshot, job_name_snapshot, position_name_snapshot,
      work_location_snapshot, signature_date, signature_place, payment_method_id,
      total_compensation_snapshot, conditions_captured_at
    ) VALUES (
      v_client_id, v_ent_id, v_worker_id, v_prev_assign_id, v_ctype_indet,
      DATE '2021-05-01', NULL, DATE '2025-06-30', false,
      v_group_amounts[v_sal_seq], 'CUP', DATE '2021-05-01', 'CAPTURED',
      v_ent_name, v_area_name, v_job_name, v_pos_name,
      v_work_loc, DATE '2021-05-01', v_ent_mun, v_pay_time,
      v_group_amounts[v_sal_seq], TIMESTAMPTZ '2021-05-01 09:00:00+00'
    )
    RETURNING id INTO v_prev_contract_id;

    INSERT INTO public.worker_employment_movements (
      worker_id, movement_type, previous_assignment_id, new_assignment_id,
      effective_date, separation_reason_id, reason, notes, created_by
    ) VALUES (
      v_worker_id, 'BAJA', v_prev_assign_id, NULL,
      DATE '2025-06-30',
      CASE (v_j % 3) WHEN 0 THEN v_sep_resignation WHEN 1 THEN v_sep_end_contract ELSE v_sep_transfer END,
      'Finalización de relación laboral (disponible para reincorporación en bandeja de Reingresos)',
      'Trabajador evaluado satisfactoriamente; apto para recontratación.',
      v_actor_user_id
    );

    INSERT INTO public.worker_payroll_movements (
      company_client_id, organization_entity_id, worker_id, assignment_id, position_id,
      event_type, event_id, effective_date,
      organism_snapshot, company_snapshot, unit_snapshot,
      identification_snapshot, worker_name_snapshot, first_name_snapshot, first_surname_snapshot, second_surname_snapshot,
      area_act_snapshot, cargo_act_snapshot, ge_act_sequence, sal_act_snapshot, currency_snapshot,
      description, created_by
    ) VALUES (
      v_client_id, v_ent_id, v_worker_id, v_prev_assign_id, v_pos_id,
      'BAJA', v_prev_assign_id, DATE '2025-06-30',
      v_ent_org, v_ent_name, v_ent_name,
      v_ci, v_full_name, v_fname, v_surname1, v_surname2,
      v_area_name, v_job_name, v_sal_seq, v_group_amounts[v_sal_seq], 'CUP',
      'Baja laboral con expediente disponible en Reingresos', v_actor_user_id
    );
  END LOOP;

  -- 6.3 Crear los 14 CANDIDATOS en bolsa de selección (`candidates` con `worker_id IS NULL`)
  FOR v_j IN 1..14 LOOP
    v_ent_idx := ((v_j - 1) % 13) + 1;
    v_ent_id := v_entity_ids[v_ent_idx];

    SELECT a.area_id INTO v_area_id
    FROM tmp_demo_areas a
    WHERE a.entity_idx = v_ent_idx
    ORDER BY a.hierarchy_order DESC
    LIMIT 1;

    SELECT province, municipality INTO v_ent_prov, v_ent_mun
    FROM public.organization_entities WHERE id = v_ent_id;

    v_fname := CASE WHEN (v_j % 2) = 1 THEN v_male_names[25 + v_j] ELSE v_female_names[25 + v_j] END;
    v_surname1 := v_surnames[60 + v_j];
    v_surname2 := v_surnames[75 + v_j];
    v_birth_date := DATE '1990-02-14' + (v_j * 165);
    v_ci := to_char(v_birth_date, 'YYMMDD') || lpad((60000 + v_j)::text, 5, '0');

    INSERT INTO public.candidates (
      company_client_id, organization_entity_id,
      first_name, first_surname, second_surname, identification,
      birth_date, gender_id, marital_status_id,
      phone, email, address, municipality, province,
      education_level_id, specialty, status,
      skin_color_id, profession_or_trade,
      has_masters_degree, has_doctorate_degree,
      is_retired_or_rehired, has_disciplinary_measures,
      worker_id
    ) VALUES (
      v_client_id, v_ent_id,
      v_fname, v_surname1, v_surname2, v_ci,
      v_birth_date,
      CASE WHEN (v_j % 2) = 1 THEN v_gender_m ELSE v_gender_f END,
      CASE WHEN (v_j % 2) = 0 THEN v_marital_single ELSE v_marital_married END,
      '+53 5' || lpad((4900000 + v_j * 523)::text, 7, '0'),
      lower(regexp_replace(v_fname || '.' || v_surname1 || '.cand' || v_j::text, '[^a-zA-Z0-9.]', '', 'g')) || '@horizonte-demo.cu',
      'Calle ' || (20 + v_j * 2) || ' No. ' || (410 + v_j * 7),
      v_ent_mun, v_ent_prov,
      CASE WHEN (v_j % 3) = 0 THEN v_edu_sup ELSE v_edu_tm END,
      CASE WHEN (v_j % 3) = 0 THEN 'Ingeniería Mecánica y Mantenimiento Industrial' ELSE 'Técnico Medio en Electromecánica y Logística' END,
      'active',
      v_skin_2,
      CASE WHEN (v_j % 3) = 0 THEN 'Ingeniero Mecánico' ELSE 'Técnico Electromecánico' END,
      (v_j = 3 OR v_j = 9), false,
      false, false,
      NULL
    )
    RETURNING id INTO v_cand_id;

    INSERT INTO public.candidate_documents (
      candidate_id, document_type_id, original_file_name, storage_path,
      mime_type, file_size, description, is_primary, uploaded_by
    ) VALUES
      (
        v_cand_id, 'PRE_EMPLOYMENT_CHECK',
        'Chequeo_Medico_Preempleo_Cand_' || lpad(v_j::text, 2, '0') || '.pdf',
        'demo/candidates/' || v_cand_id::text || '/Chequeo_Preempleo.pdf',
        'application/pdf', 184200,
        'Certificado médico preempleo apto sin restricciones para la plaza vacante',
        true, v_actor_user_id
      ),
      (
        v_cand_id, 'CRIMINAL_RECORD',
        'Antecedentes_Penales_Cand_' || lpad(v_j::text, 2, '0') || '.pdf',
        'demo/candidates/' || v_cand_id::text || '/Antecedentes_Penales.pdf',
        'application/pdf', 142800,
        'Certificación oficial sin antecedentes penales vigente',
        false, v_actor_user_id
      );

    INSERT INTO public.candidate_work_experiences (
      candidate_id, organization_entity_id, job_title, company_name,
      start_date, end_date, is_current, description
    ) VALUES (
      v_cand_id, v_ent_id,
      CASE WHEN (v_j % 3) = 0 THEN 'Ingeniero de Mantenimiento de Planta' ELSE 'Técnico Operativo de Taller y Logística' END,
      'Empresa Metalmecánica del Occidente',
      DATE '2021-03-01', DATE '2025-08-31', false,
      'Ejecución de planes de mantenimiento preventivo, control de órdenes técnicas y aseguramiento de calidad.'
    );

    INSERT INTO public.candidate_academic_formations (
      candidate_id, organization_entity_id, program_name,
      start_date, end_date, is_studying, document_id
    ) VALUES (
      v_cand_id, v_ent_id,
      CASE WHEN (v_j % 3) = 0 THEN 'Ingeniería Mecánica · CUJAE' ELSE 'Técnico Medio en Mantenimiento Electromecánico · Politécnico Industrial' END,
      DATE '2016-09-01', DATE '2021-07-15', false, NULL
    );

    INSERT INTO public.candidate_notes (
      candidate_id, organization_entity_id, note_text, created_by
    ) VALUES (
      v_cand_id, v_ent_id,
      'Entrevista técnica superada con calificación sobresaliente (94/100). Expediente listo para contratación inmediata en plaza vacante.',
      v_actor_user_id
    );

    INSERT INTO public.candidate_additional_info (
      candidate_id, organization_entity_id, info_text, created_by
    ) VALUES
      (
        v_cand_id, v_ent_id,
        '__SITECORP_CANDIDATE_META__:' || json_build_object('area_id', v_area_id)::text,
        v_actor_user_id
      ),
      (
        v_cand_id, v_ent_id,
        'Disponibilidad inmediata para incorporación a turnos rotativos y brigadas de servicio.',
        v_actor_user_id
      );

    IF v_lic_b IS NOT NULL AND (v_j % 2) = 0 THEN
      INSERT INTO public.candidate_driving_license_categories (candidate_id, driving_license_category_id)
      VALUES (v_cand_id, v_lic_b) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- ==========================================================================
  -- 7. VACACIONES (165 CUENTAS + 85 PERÍODOS) Y CERTIFICADOS MÉDICOS (34)
  --    Movimientos en `worker_vacation_movements` usando los valores reales del
  --    CHECK constraint (`20261003_01_vacations.sql`):
  --      'INITIAL_BALANCE', 'ACCRUAL', 'VACATION_USAGE', 'REVERSAL', 'ADJUSTMENT'
  -- ==========================================================================
  FOR v_i IN 1..165 LOOP
    SELECT w.worker_id, w.entity_id, w.pos_id, w.assign_id
      INTO v_worker_id, v_ent_id, v_pos_id, v_assign_id
    FROM tmp_demo_workers w
    WHERE w.worker_seq = v_i;

    -- Movimiento INITIAL_BALANCE (corte de apertura)
    INSERT INTO public.worker_vacation_movements (
      company_client_id, organization_entity_id, worker_id, assignment_id,
      movement_type, amount, calculated_amount, effective_date,
      position_id, schedule_weekdays,
      description, reason, created_by
    ) VALUES (
      v_client_id, v_ent_id, v_worker_id, v_assign_id,
      'INITIAL_BALANCE',
      CASE
        WHEN (v_i % 15) = 0 THEN 20.0000
        WHEN (v_i % 7) = 0  THEN 18.0000
        ELSE 10.0000
      END,
      10.0000,
      DATE '2026-07-31',
      v_pos_id, ARRAY[1,2,3,4,5,6],
      'Saldo inicial reconocido al cierre del corte semestral',
      'Apertura auditada del libro mayor de vacaciones',
      v_actor_user_id
    );

    -- Devengos mensuales cerrados de Agosto, Septiembre y Octubre 2026 (`ACCRUAL`)
    INSERT INTO public.worker_vacation_movements (
      company_client_id, organization_entity_id, worker_id, assignment_id,
      movement_type, amount, calculated_amount, effective_date,
      accrual_year, accrual_month, working_days_month, working_days_year,
      position_id, schedule_weekdays,
      description, reason, created_by
    ) VALUES
      (
        v_client_id, v_ent_id, v_worker_id, v_assign_id,
        'ACCRUAL', 2.0000, 2.0000, DATE '2026-08-31',
        2026, 8, 26, 312, v_pos_id, ARRAY[1,2,3,4,5,6],
        'Devengo mensual automático 2026-08', 'Cierre mensual', v_actor_user_id
      ),
      (
        v_client_id, v_ent_id, v_worker_id, v_assign_id,
        'ACCRUAL', 2.0000, 2.0000, DATE '2026-09-30',
        2026, 9, 26, 312, v_pos_id, ARRAY[1,2,3,4,5,6],
        'Devengo mensual automático 2026-09', 'Cierre mensual', v_actor_user_id
      ),
      (
        v_client_id, v_ent_id, v_worker_id, v_assign_id,
        'ACCRUAL',
        CASE WHEN (v_i % 15) = 0 THEN 0.0000 ELSE 2.0000 END,
        2.0000, DATE '2026-10-31',
        2026, 10, 27, 312, v_pos_id, ARRAY[1,2,3,4,5,6],
        'Devengo mensual automático 2026-10', 'Cierre mensual', v_actor_user_id
      );

    -- 85 Períodos de vacaciones (`worker_vacations`) para los primeros 85 trabajadores activos:
    --   * v_i 1..48:  48 períodos `TAKEN` con movimiento `VACATION_USAGE`
    --   * v_i 49..77: 29 períodos `SCHEDULED` con movimiento `VACATION_USAGE`
    --   * v_i 78..85:  8 períodos `CANCELLED` con movimiento `VACATION_USAGE` + `REVERSAL`
    IF v_i <= 85 THEN
      IF v_i <= 48 THEN
        INSERT INTO public.worker_vacations (
          company_client_id, organization_entity_id, worker_id, assignment_id,
          start_date, end_date, natural_days, sundays_count, charged_days,
          status, notes, created_by
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_assign_id,
          DATE '2026-08-10' + ((v_i % 6) * 7),
          DATE '2026-08-16' + ((v_i % 6) * 7),
          7, 1, 6.0000,
          'TAKEN', 'Período vacacional disfrutado según plan anual de vacaciones.', v_actor_user_id
        )
        RETURNING id INTO v_vac_id;

        INSERT INTO public.worker_vacation_movements (
          company_client_id, organization_entity_id, worker_id, assignment_id,
          movement_type, amount, calculated_amount, effective_date,
          position_id, vacation_id, description, reason, created_by
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_assign_id,
          'VACATION_USAGE', -6.0000, -6.0000, DATE '2026-08-10' + ((v_i % 6) * 7),
          v_pos_id, v_vac_id,
          'Consumo de vacaciones disfrutadas (6 días laborables)', 'Plan anual de vacaciones', v_actor_user_id
        );

      ELSIF v_i <= 77 THEN
        -- 29 períodos vacacionales programados para fechas futuras (noviembre/diciembre 2026).
        -- En la lógica de SiteCorp, una vacación SCHEDULED solo planifica fechas; no deduce saldo en el
        -- ledger contable de movimientos (worker_vacation_movements) hasta que sea disfrutada/registrada.
        INSERT INTO public.worker_vacations (
          company_client_id, organization_entity_id, worker_id, assignment_id,
          start_date, end_date, natural_days, sundays_count, charged_days,
          status, notes, created_by
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_assign_id,
          DATE '2026-11-16' + (((v_i - 49) % 5) * 7),
          DATE '2026-11-22' + (((v_i - 49) % 5) * 7),
          7, 1, 6.0000,
          'SCHEDULED', 'Vacaciones programadas y aprobadas por el jefe de área.', v_actor_user_id
        )
        RETURNING id INTO v_vac_id;

      ELSE
        INSERT INTO public.worker_vacations (
          company_client_id, organization_entity_id, worker_id, assignment_id,
          start_date, end_date, natural_days, sundays_count, charged_days,
          status, notes, created_by, cancelled_by, cancelled_at, cancel_reason
        ) VALUES (
          v_client_id, v_ent_id, v_worker_id, v_assign_id,
          DATE '2026-09-07', DATE '2026-09-12',
          6, 0, 6.0000,
          'CANCELLED', 'Solicitud reprogramada por parada de mantenimiento de planta.',
          v_actor_user_id, v_actor_user_id, TIMESTAMPTZ '2026-09-04 14:00:00+00',
          'Reprogramación acordada con el trabajador por parada técnica imprevista.'
        )
        RETURNING id INTO v_vac_id;

        INSERT INTO public.worker_vacation_movements (
          company_client_id, organization_entity_id, worker_id, assignment_id,
          movement_type, amount, calculated_amount, effective_date,
          position_id, vacation_id, description, reason, created_by
        ) VALUES
          (
            v_client_id, v_ent_id, v_worker_id, v_assign_id,
            'VACATION_USAGE', -6.0000, -6.0000, DATE '2026-09-07',
            v_pos_id, v_vac_id,
            'Descuento por solicitud vacacional', 'Registro original', v_actor_user_id
          ),
          (
            v_client_id, v_ent_id, v_worker_id, v_assign_id,
            'REVERSAL', 6.0000, 6.0000, DATE '2026-09-07',
            v_pos_id, v_vac_id,
            'Reversión por cancelación de período vacacional',
            'Reprogramación acordada con el trabajador por parada técnica imprevista.',
            v_actor_user_id
          );
      END IF;
    END IF;

    -- Ajustes manuales auditados (`ADJUSTMENT`) para 4 trabajadores (`worker_seq` 10, 20, 30, 40)
    IF v_i IN (10, 20, 30, 40) THEN
      INSERT INTO public.worker_vacation_movements (
        company_client_id, organization_entity_id, worker_id, assignment_id,
        movement_type, amount, calculated_amount, effective_date,
        position_id, schedule_weekdays,
        description, reason, created_by
      ) VALUES (
        v_client_id, v_ent_id, v_worker_id, v_assign_id,
        'ADJUSTMENT', 1.5000, 1.5000, DATE '2026-09-15',
        v_pos_id, ARRAY[1,2,3,4,5,6],
        'Ajuste positivo de saldo vacacional por conciliación de expediente',
        'Acta de conciliación de tiempo de servicio y acumulado vacacional',
        v_actor_user_id
      );
    END IF;
  END LOOP;

  -- 7.2 Certificados Médicos (`worker_medical_certificates`: 34 certificados con soporte documental)
  FOR v_j IN 1..34 LOOP
    SELECT w.worker_id, w.entity_id
      INTO v_worker_id, v_ent_id
    FROM tmp_demo_workers w
    WHERE w.worker_seq = v_j * 4;

    INSERT INTO public.worker_documents (
      worker_id, document_type_id, employment_contract_id,
      file_name, storage_path, mime_type, file_size,
      description, source, uploaded_by
    ) VALUES (
      v_worker_id, 'MEDICAL_CERTIFICATE', NULL,
      'Certificado_Medico_GEH_' || lpad(v_j::text, 3, '0') || '.pdf',
      'demo/medical/' || v_worker_id::text || '/Certificado_' || lpad(v_j::text, 3, '0') || '.pdf',
      'application/pdf', 162400,
      'Certificado médico administrativo registrado en el expediente laboral',
      'MANUAL', v_actor_user_id
    )
    RETURNING id INTO v_doc_id;

    INSERT INTO public.worker_medical_certificates (
      company_client_id, organization_entity_id, worker_id,
      start_date, return_date, days, document_id, created_by
    ) VALUES (
      v_client_id, v_ent_id, v_worker_id,
      DATE '2026-04-05' + (v_j * 5),
      DATE '2026-04-05' + (v_j * 5) + ((v_j % 6) + 2),
      (v_j % 6) + 2,
      v_doc_id,
      v_actor_user_id
    );
  END LOOP;

  -- ==========================================================================
  -- 8. PRENÓMINA MENSUAL (OCTUBRE 2026 CERRADA + NOVIEMBRE 2026 EN BORRADOR)
  -- ==========================================================================
  FOR v_ent_idx IN 1..13 LOOP
    v_ent_id := v_entity_ids[v_ent_idx];

    INSERT INTO public.prenomina_periods (
      company_client_id, organization_entity_id,
      period_year, period_month, status,
      created_by, closed_at, closed_by
    ) VALUES (
      v_client_id, v_ent_id,
      2026, 10, 'CERRADA',
      v_actor_user_id, TIMESTAMPTZ '2026-10-31 17:30:00+00', v_actor_user_id
    )
    RETURNING id INTO v_period_oct_id;

    INSERT INTO public.prenomina_periods (
      company_client_id, organization_entity_id,
      period_year, period_month, status,
      created_by, closed_at, closed_by
    ) VALUES (
      v_client_id, v_ent_id,
      2026, 11, 'BORRADOR',
      v_actor_user_id, NULL, NULL
    )
    RETURNING id INTO v_period_nov_id;

    FOR v_i IN
      SELECT w.worker_seq
      FROM tmp_demo_workers w
      WHERE w.entity_idx = v_ent_idx
      ORDER BY w.worker_seq
    LOOP
      DECLARE
        w_rec record;
        j_rec record;
        p_rec record;
        a_rec record;
        v_tenure_months integer;
        v_tenure_years integer;
        v_tenure_rem integer;
        v_tenure_band_id uuid;
        v_tenure_amount numeric(14,2);
        v_tenure_label text;
        v_acad_cat text;
        v_acad_amount numeric(14,2);
        v_hourly_rate numeric(14,6);
        v_scale_pay numeric(14,2);
        v_tenure_pay numeric(14,2);
        v_cla_day_pay numeric(14,2);
        v_night_pay numeric(14,2);
        v_total_pay numeric(14,2);
      BEGIN
        SELECT * INTO w_rec FROM tmp_demo_workers WHERE worker_seq = v_i;
        SELECT * INTO j_rec FROM tmp_demo_jobs WHERE job_seq = w_rec.job_seq;
        SELECT * INTO p_rec FROM tmp_demo_positions WHERE pos_seq = w_rec.pos_seq;
        SELECT * INTO a_rec FROM tmp_demo_areas WHERE area_seq = j_rec.area_seq;

        v_tenure_years  := date_part('year', age(DATE '2026-10-31', w_rec.employment_start_date))::int;
        v_tenure_rem    := date_part('month', age(DATE '2026-10-31', w_rec.employment_start_date))::int;
        v_tenure_months := v_tenure_years * 12 + v_tenure_rem;

        SELECT t.id, t.amount,
               CASE WHEN t.to_months IS NULL THEN 'Desde ' || t.from_months::int || ' meses'
                    ELSE t.from_months::int || '–' || t.to_months::int || ' meses' END
          INTO v_tenure_band_id, v_tenure_amount, v_tenure_label
        FROM public.tenure_payment_scales t
        WHERE t.organization_entity_id = v_ent_id
          AND t.is_active = true
          AND v_tenure_months >= t.from_months
          AND (t.to_months IS NULL OR v_tenure_months < t.to_months)
        ORDER BY t.from_months DESC
        LIMIT 1;

        v_acad_cat := CASE
          WHEN w_rec.has_doctorate THEN 'DOCTOR'
          WHEN w_rec.has_masters THEN 'MASTER'
          ELSE NULL
        END;
        v_acad_amount := CASE
          WHEN w_rec.has_doctorate THEN 1600.00
          WHEN w_rec.has_masters THEN 950.00
          ELSE 0.00
        END;

        v_hourly_rate := round(w_rec.salary_amount / 190.6, 6);
        v_scale_pay   := round(v_hourly_rate * 190.6, 2);
        v_tenure_pay  := COALESCE(v_tenure_amount, 0.00);
        v_cla_day_pay := CASE WHEN j_rec.cla_day_enabled THEN round(40 * COALESCE(j_rec.cla_day_hourly_rate, 18.50), 2) ELSE 0.00 END;
        v_night_pay   := CASE WHEN j_rec.cla_night_enabled THEN 126.00 ELSE 0.00 END;
        v_total_pay   := v_scale_pay + v_tenure_pay + v_acad_amount + v_cla_day_pay + v_night_pay;

        -- Entrada Octubre 2026 (CERRADA)
        INSERT INTO public.prenomina_worker_entries (
          period_id, organization_entity_id, worker_id,
          assignment_id, employment_contract_id,
          worker_name_snapshot, identification_snapshot,
          area_name_snapshot, job_name_snapshot, position_name_snapshot,
          salary_group_id, salary_group_sequence, salary_scale_id,
          salary_scale_amount, salary_currency, workday_hours,
          worked_days, worked_hours, hourly_scale_rate, scale_salary_payment,
          employment_start_date_snapshot, tenure_reference_date,
          tenure_years, tenure_months, tenure_total_months,
          tenure_band_id, tenure_band_label, tenure_base_amount,
          tenure_hourly_rate, tenure_payment, tenure_status,
          has_masters_degree_snapshot, has_doctorate_degree_snapshot,
          academic_category, academic_monthly_amount, academic_hourly_rate,
          academic_payment, academic_status,
          cla_applied, cla_day_enabled, cla_day_hourly_rate,
          cla_day_minutes, cla_day_hours, cla_day_payment,
          cla_night_enabled, cla_total_payment,
          night_payment_19_23, night_payment_23_07, total_night_payment,
          total_payment
        ) VALUES (
          v_period_oct_id, v_ent_id, w_rec.worker_id,
          w_rec.assign_id, w_rec.contract_id,
          w_rec.full_name, w_rec.identification,
          a_rec.name, j_rec.name, p_rec.name,
          w_rec.salary_group_id, w_rec.salary_group_seq, w_rec.salary_scale_id,
          w_rec.salary_amount, 'CUP', 8.00,
          23.825, 190.6000, v_hourly_rate, v_scale_pay,
          w_rec.employment_start_date, DATE '2026-10-31',
          v_tenure_years, v_tenure_rem, v_tenure_months,
          v_tenure_band_id, v_tenure_label, v_tenure_amount,
          round(v_tenure_pay / 190.6, 6), v_tenure_pay,
          CASE WHEN v_tenure_band_id IS NULL THEN 'NO_BAND' ELSE 'OK' END,
          w_rec.has_masters, w_rec.has_doctorate,
          v_acad_cat, CASE WHEN v_acad_cat IS NOT NULL THEN v_acad_amount ELSE NULL END,
          round(v_acad_amount / 190.6, 6), v_acad_amount, 'OK',
          j_rec.cla_day_enabled, j_rec.cla_day_enabled, j_rec.cla_day_hourly_rate,
          CASE WHEN j_rec.cla_day_enabled THEN 2400 ELSE 0 END,
          CASE WHEN j_rec.cla_day_enabled THEN 40 ELSE 0 END,
          v_cla_day_pay,
          j_rec.cla_night_enabled, v_cla_day_pay,
          CASE WHEN j_rec.cla_night_enabled THEN 36.00 ELSE 0.00 END,
          CASE WHEN j_rec.cla_night_enabled THEN 90.00 ELSE 0.00 END,
          v_night_pay,
          v_total_pay
        )
        RETURNING id INTO v_entry_id;

        IF j_rec.cla_night_enabled THEN
          INSERT INTO public.prenomina_night_entries (
            worker_entry_id, organization_entity_id,
            start_time, end_time, nights_worked,
            hours_19_23_per_night, hours_23_07_per_night,
            payment_19_23, payment_23_07, total_payment, display_order
          ) VALUES (
            v_entry_id, v_ent_id,
            TIME '19:00', TIME '03:00', 15,
            4.00, 4.00, 36.00, 90.00, 126.00, 1
          );
        END IF;

        -- Entrada Noviembre 2026 (BORRADOR en curso)
        INSERT INTO public.prenomina_worker_entries (
          period_id, organization_entity_id, worker_id,
          assignment_id, employment_contract_id,
          worker_name_snapshot, identification_snapshot,
          area_name_snapshot, job_name_snapshot, position_name_snapshot,
          salary_group_id, salary_group_sequence, salary_scale_id,
          salary_scale_amount, salary_currency, workday_hours,
          worked_days, worked_hours, hourly_scale_rate, scale_salary_payment,
          employment_start_date_snapshot, tenure_reference_date,
          tenure_years, tenure_months, tenure_total_months,
          tenure_band_id, tenure_band_label, tenure_base_amount,
          tenure_hourly_rate, tenure_payment, tenure_status,
          has_masters_degree_snapshot, has_doctorate_degree_snapshot,
          academic_category, academic_monthly_amount, academic_hourly_rate,
          academic_payment, academic_status,
          cla_applied, cla_day_enabled, cla_day_hourly_rate,
          cla_night_enabled, total_payment
        ) VALUES (
          v_period_nov_id, v_ent_id, w_rec.worker_id,
          w_rec.assign_id, w_rec.contract_id,
          w_rec.full_name, w_rec.identification,
          a_rec.name, j_rec.name, p_rec.name,
          w_rec.salary_group_id, w_rec.salary_group_seq, w_rec.salary_scale_id,
          w_rec.salary_amount, 'CUP', 8.00,
          12.00, 96.0000, v_hourly_rate, round(v_hourly_rate * 96.0, 2),
          w_rec.employment_start_date, DATE '2026-11-30',
          v_tenure_years, v_tenure_rem, v_tenure_months,
          v_tenure_band_id, v_tenure_label, v_tenure_amount,
          round(v_tenure_pay / 190.6, 6), round((v_tenure_pay / 190.6) * 96.0, 2),
          CASE WHEN v_tenure_band_id IS NULL THEN 'NO_BAND' ELSE 'OK' END,
          w_rec.has_masters, w_rec.has_doctorate,
          v_acad_cat, CASE WHEN v_acad_cat IS NOT NULL THEN v_acad_amount ELSE NULL END,
          round(v_acad_amount / 190.6, 6), round((v_acad_amount / 190.6) * 96.0, 2), 'OK',
          false, j_rec.cla_day_enabled, j_rec.cla_day_hourly_rate,
          j_rec.cla_night_enabled,
          round(v_hourly_rate * 96.0, 2) + round((v_tenure_pay / 190.6) * 96.0, 2) + round((v_acad_amount / 190.6) * 96.0, 2)
        );
      END;
    END LOOP;
  END LOOP;

  -- ==========================================================================
  -- 9. CAPACITACIÓN (46 CARPETAS, 32 TEMAS, 45 DOCUMENTOS, 68 SESIONES,
  --    PARTICIPACIONES Y 14 NOTIFICACIONES DE CAPACITACIÓN INICIAL PENDIENTES)
  -- ==========================================================================
  -- 9.1 46 Carpetas de capacitación (`training_folders`: 1 por cada área organizativa)
  FOR v_i IN 1..46 LOOP
    SELECT a.area_id, a.entity_id, a.name
      INTO v_area_id, v_ent_id, v_area_name
    FROM tmp_demo_areas a
    WHERE a.area_seq = v_i;

    INSERT INTO public.training_folders (
      organization_entity_id, area_id, area_name_snapshot, description, created_by
    ) VALUES (
      v_ent_id, v_area_id, v_area_name,
      'Carpeta anual de planes temáticos, guías didácticas y sesiones formativas del área ' || v_area_name,
      v_actor_user_id
    )
    RETURNING id INTO v_folder_id;

    v_training_folder_ids := array_append(v_training_folder_ids, v_folder_id);
  END LOOP;

  -- 9.2 32 Temas de capacitación (`training_topics`) y 45 Documentos didácticos (`training_topic_documents`)
  DECLARE
    v_topic_titles text[] := ARRAY[
      'Gestión Estratégica y Gobierno Corporativo Empresarial',
      'Administración de Plantillas de Cargos y Calificadores Ramales',
      'Sistemas de Pago por Rendimiento y Prenómina Integral',
      'Legislación Laboral Cubana y Contratación Económica',
      'Control Interno, Auditoría de Gestión y Prevención de Riesgos',
      'Tecnología Avanzada de Soldadura de Arco Sumergido y TIG/MIG',
      'Programación y Operación Segura de Centros de Maquinado CNC',
      'Mantenimiento Preventivo Planificado de Calderas de Vapor',
      'Instrumentación Industrial, Lazos de Control PLC y SCADA',
      'Ensayos No Destructivos y Control Dimensional de Piezas',
      'Conducción Defensiva y Eficiencia Energética en Flota Pesada',
      'Tráfico Portuario, Estiba y Sujeción Segura de Contenedores',
      'Gestión de Almacenes, Inventarios Rotativos y Cadena de Frío',
      'Mantenimiento de Sistemas de Inyección Electrónica Diésel',
      'Trazabilidad Logística y Despacho de Carga Interprovincial',
      'Protecciones Eléctricas y Maniobras en Subestaciones de Media Tensión',
      'Diagnóstico por Termografía Infrarroja y Análisis de Vibraciones',
      'Tecnología de Bobinado y Rehabilitación de Motores Asíncronos',
      'Eficiencia Energética en Sistemas Centralizados de Climatización (Chillers)',
      'Operación y Sincronización de Grupos Electrógenos de Emergencia',
      'Digitalización de Expedientes Laborales y Archivo Técnico en SiteCorp',
      'Cálculo de Devengo Vacacional, Licencias y Seguridad Social',
      'Metodología de Identificación de Peligros y Evaluación de Riesgos (IPER)',
      'Investigación Técnica de Incidentes y Accidentes de Trabajo',
      'Metrología Dimensional, Calibración y Aseguramiento de Calidad',
      'Formación de Instructores Internos y Tutores de Recién Graduados',
      'Liderazgo Operativo para Jefes de Brigada y Maestros de Taller',
      'Gestión Ambiental Industrial y Manejo de Desechos Peligrosos',
      'Mantenimiento de Puentes Grúa, Polipastos y Elementos de Izaje',
      'Seguridad Informática y Protección de Datos en Entornos Corporativos',
      'Optimización de Procesos y Organización Científica del Trabajo',
      'Inducción General Corporativa del Grupo Empresarial Horizonte'
    ];
    v_freqs text[] := ARRAY['ANUAL', 'SEMESTRAL', 'TRIMESTRAL', 'MENSUAL', 'UNICA', 'SEGUN_NECESIDAD'];
  BEGIN
    FOR v_i IN 1..32 LOOP
      v_j := ((v_i - 1) % 46) + 1;
      SELECT a.area_id, a.entity_id, a.name
        INTO v_area_id, v_ent_id, v_area_name
      FROM tmp_demo_areas a WHERE a.area_seq = v_j;

      v_folder_id := v_training_folder_ids[v_j];

      INSERT INTO public.training_topics (
        organization_entity_id, folder_id, area_id,
        title, description, frequency, created_by
      ) VALUES (
        v_ent_id, v_folder_id, v_area_id,
        v_topic_titles[v_i],
        'Programa técnico-metodológico homologado por la Dirección de Capacitación de Grupo Empresarial Horizonte para ' || v_area_name || '.',
        v_freqs[((v_i - 1) % 6) + 1],
        v_actor_user_id
      )
      RETURNING id INTO v_topic_id;

      v_training_topic_ids := array_append(v_training_topic_ids, v_topic_id);

      -- Primer documento del tema (32 documentos)
      INSERT INTO public.training_topic_documents (
        organization_entity_id, topic_id, file_name, storage_path,
        mime_type, file_size, uploaded_by
      ) VALUES (
        v_ent_id, v_topic_id,
        'Manual_Didactico_Tema_' || lpad(v_i::text, 2, '0') || '.pdf',
        'demo/training/' || v_topic_id::text || '/Manual_Tema_' || lpad(v_i::text, 2, '0') || '.pdf',
        'application/pdf', 420000 + (v_i * 12500), v_actor_user_id
      );

      -- Segundo documento complementario en los primeros 13 temas (32 + 13 = 45 documentos exactos)
      IF v_i <= 13 THEN
        INSERT INTO public.training_topic_documents (
          organization_entity_id, topic_id, file_name, storage_path,
          mime_type, file_size, uploaded_by
        ) VALUES (
          v_ent_id, v_topic_id,
          'Guia_Evaluacion_Practica_Tema_' || lpad(v_i::text, 2, '0') || '.docx',
          'demo/training/' || v_topic_id::text || '/Guia_Evaluacion_Tema_' || lpad(v_i::text, 2, '0') || '.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          195000 + (v_i * 6400), v_actor_user_id
        );
      END IF;
    END LOOP;
  END;

  -- 9.3 68 Sesiones Formativas (`training_sessions`: 42 REALIZADA, 20 PROGRAMADA, 6 NO_REALIZADA)
  --     y registros de participación en `worker_training_records` (> 380).
  DECLARE
    v_participants uuid[];
    v_part_worker uuid;
    v_topic_title text;
    v_sched_date date;
    v_sess_status text;
  BEGIN
    FOR v_i IN 1..68 LOOP
      v_j := ((v_i - 1) % 32) + 1;
      v_topic_id := v_training_topic_ids[v_j];

      SELECT t.organization_entity_id, t.folder_id, t.area_id, t.title, f.area_name_snapshot
        INTO v_ent_id, v_folder_id, v_area_id, v_topic_title, v_area_name
      FROM public.training_topics t
      JOIN public.training_folders f ON f.id = t.folder_id
      WHERE t.id = v_topic_id;

      IF v_i <= 42 THEN
        v_sess_status := 'REALIZADA';
        v_sched_date  := DATE '2026-01-15' + (v_i * 6);
      ELSIF v_i <= 62 THEN
        v_sess_status := 'PROGRAMADA';
        v_sched_date  := DATE '2026-11-05' + ((v_i - 42) * 2);
      ELSE
        v_sess_status := 'NO_REALIZADA';
        v_sched_date  := DATE '2026-05-10' + ((v_i - 62) * 14);
      END IF;

      IF v_sess_status = 'REALIZADA' THEN
        SELECT array_agg(sub.worker_id)
          INTO v_participants
        FROM (
          SELECT w.worker_id
          FROM tmp_demo_workers w
          WHERE w.entity_id = v_ent_id
          ORDER BY ((w.worker_seq + v_i) % 19), w.worker_seq
          LIMIT (CASE WHEN (v_i % 2) = 0 THEN 10 ELSE 9 END)
        ) sub;
      ELSE
        v_participants := '{}'::uuid[];
      END IF;

      INSERT INTO public.training_sessions (
        organization_entity_id, folder_id, area_id, topic_id,
        scheduled_date, status, notes, participant_worker_ids,
        completed_at, created_by
      ) VALUES (
        v_ent_id, v_folder_id, v_area_id, v_topic_id,
        v_sched_date, v_sess_status,
        CASE v_sess_status
          WHEN 'REALIZADA' THEN 'Sesión impartida conforme al programa metodológico con asistencia certificada y evaluación satisfactoria.'
          WHEN 'PROGRAMADA' THEN 'Convocatoria emitida a los jefes de área y participantes seleccionados.'
          ELSE 'Sesión pospuesta por afectación operativa de planta; pendiente de reprogramación.'
        END,
        COALESCE(v_participants, '{}'::uuid[]),
        CASE WHEN v_sess_status = 'REALIZADA' THEN (v_sched_date + time '16:00')::timestamptz ELSE NULL END,
        v_actor_user_id
      )
      RETURNING id INTO v_session_id;

      IF v_sess_status = 'REALIZADA' AND v_participants IS NOT NULL THEN
        FOREACH v_part_worker IN ARRAY v_participants LOOP
          INSERT INTO public.worker_training_records (
            organization_entity_id, worker_id, session_id, topic_id,
            topic_title_snapshot, area_id_snapshot, area_name_snapshot,
            received_date, status, kind, notes, created_by
          ) VALUES (
            v_ent_id, v_part_worker, v_session_id, v_topic_id,
            v_topic_title, v_area_id, v_area_name,
            v_sched_date, 'RECIBIDA', 'SESION',
            'Participación aprobada en sesión del calendario anual de capacitación.',
            v_actor_user_id
          );
        END LOOP;
      END IF;
    END LOOP;

    -- 9.4 Gestión NO DESTRUCTIVA de `training_initial_notifications`:
    --     El trigger `worker_assignment_training_notification_trg` creó una notificación por cada
    --     trabajador asignado. Sin utilizar DELETE:
    --       - Marcamos como `COMPLETADA` las notificaciones históricas de los trabajadores antiguos
    --         (`worker_seq` 1..151).
    --       - Para las 14 contrataciones recientes (`worker_seq` 152..165), modelamos la distribución
    --         operativa del diseño: 5 completadas con registro formal de inducción (`worker_seq` 152..156)
    --         y 9 pendientes activas (`worker_seq` 157..165) en la bandeja de Capacitación Inicial.
    UPDATE public.training_initial_notifications tin
    SET status = 'COMPLETADA',
        completed_at = (tin.hire_date + 2 + time '15:00')::timestamptz
    WHERE tin.organization_entity_id = ANY(v_entity_ids)
      AND tin.worker_id NOT IN (
        SELECT w.worker_id FROM tmp_demo_workers w WHERE w.worker_seq BETWEEN 157 AND 165
      );

    FOR v_i IN 152..156 LOOP
      SELECT w.worker_id, w.entity_id, w.area_id, w.hire_date, a.name
        INTO v_worker_id, v_ent_id, v_area_id, v_hire_date, v_area_name
      FROM tmp_demo_workers w
      JOIN tmp_demo_areas a ON a.area_id = w.area_id
      WHERE w.worker_seq = v_i;

      INSERT INTO public.worker_training_records (
        organization_entity_id, worker_id, session_id, topic_id,
        topic_title_snapshot, area_id_snapshot, area_name_snapshot,
        received_date, status, kind, notes, created_by
      ) VALUES (
        v_ent_id, v_worker_id, NULL, NULL,
        'Capacitación Inicial de Incorporación al Puesto y Normas Internas',
        v_area_id, v_area_name,
        v_hire_date + 2, 'RECIBIDA', 'CAPACITACION_INICIAL',
        'Inducción inicial completada y firmada en el expediente del trabajador.',
        v_actor_user_id
      )
      RETURNING id INTO v_rec_id;

      UPDATE public.training_initial_notifications
      SET status = 'COMPLETADA',
          completed_at = (v_hire_date + 2 + time '15:00')::timestamptz,
          completed_record_id = v_rec_id
      WHERE organization_entity_id = v_ent_id
        AND worker_id = v_worker_id;
    END LOOP;
  END;

  -- ==========================================================================
  -- 10. SEGURIDAD Y SALUD EN EL TRABAJO (SST) — LOS 10 SUBMÓDULOS COMPLETOS
  -- ==========================================================================

  -- 10.1 Capacitaciones de SST por Cargo (`sst_job_folders`, `sst_training_topics`,
  --      `sst_topic_documents`, `sst_training_sessions`, `sst_worker_training_records`)
  --      y actualización no destructiva de `sst_onboarding_notifications`
  FOR v_i IN 1..40 LOOP
    SELECT j.job_id, j.entity_id, j.name, j.area_id, a.name
      INTO v_job_id, v_ent_id, v_job_name, v_area_id, v_area_name
    FROM tmp_demo_jobs j
    JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
    WHERE j.job_seq = v_i * 2;

    INSERT INTO public.sst_job_folders (
      organization_entity_id, job_id, job_name_snapshot,
      area_id_snapshot, area_name_snapshot, created_by
    ) VALUES (
      v_ent_id, v_job_id, v_job_name,
      v_area_id, v_area_name, v_actor_user_id
    )
    RETURNING id INTO v_folder_id;

    IF v_i <= 30 THEN
      INSERT INTO public.sst_training_topics (
        organization_entity_id, folder_id, job_id,
        title, description, frequency, created_by
      ) VALUES (
        v_ent_id, v_folder_id, v_job_id,
        'Instrucción de Seguridad Ocupacional y Prevención de Riesgos · ' || v_job_name,
        'Requisitos obligatorios de seguridad, uso de EPP, bloqueo de energías peligrosas (LOTO) y actuación ante emergencias en el cargo.',
        CASE WHEN (v_i % 2) = 0 THEN 'SEMESTRAL' ELSE 'ANUAL' END,
        v_actor_user_id
      )
      RETURNING id INTO v_topic_id;

      INSERT INTO public.sst_topic_documents (
        organization_entity_id, topic_id, file_name, storage_path,
        mime_type, file_size, uploaded_by
      ) VALUES (
        v_ent_id, v_topic_id,
        'Instructivo_SST_Cargo_' || lpad(v_i::text, 2, '0') || '.pdf',
        'demo/sst/topics/' || v_topic_id::text || '/Instructivo_SST_' || lpad(v_i::text, 2, '0') || '.pdf',
        'application/pdf', 298000 + (v_i * 5100), v_actor_user_id
      );

      INSERT INTO public.sst_training_sessions (
        organization_entity_id, folder_id, job_id, topic_id,
        scheduled_date, status, notes,
        participant_worker_ids, completed_at, created_by
      ) VALUES (
        v_ent_id, v_folder_id, v_job_id, v_topic_id,
        CASE WHEN v_i <= 22 THEN DATE '2026-03-10' + (v_i * 7) ELSE DATE '2026-11-12' + (v_i - 22) END,
        CASE WHEN v_i <= 22 THEN 'REALIZADA' ELSE 'PROGRAMADA' END,
        'Capacitación periódica reglamentaria de SST conforme a la Ley 189/2026 y Resolución 57/2026 del MTSS.',
        ARRAY(
          SELECT w.worker_id FROM tmp_demo_workers w WHERE w.entity_id = v_ent_id ORDER BY w.worker_seq LIMIT 6
        ),
        CASE WHEN v_i <= 22 THEN TIMESTAMPTZ '2026-08-20 15:00:00+00' ELSE NULL END,
        v_actor_user_id
      )
      RETURNING id INTO v_session_id;

      IF v_i <= 22 THEN
        INSERT INTO public.sst_worker_training_records (
          organization_entity_id, worker_id, session_id, topic_id,
          topic_title_snapshot, job_id_snapshot, job_name_snapshot,
          area_id_snapshot, area_name_snapshot,
          received_date, status, kind, notes, created_by
        )
        SELECT
          v_ent_id, w.worker_id, v_session_id, v_topic_id,
          'Instrucción de Seguridad Ocupacional y Prevención de Riesgos · ' || v_job_name,
          v_job_id, v_job_name, v_area_id, v_area_name,
          DATE '2026-03-10' + (v_i * 7), 'RECIBIDA', 'SESION_SST',
          'Evaluación teórico-práctica de seguridad aprobada satisfactoriamente.',
          v_actor_user_id
        FROM tmp_demo_workers w
        WHERE w.entity_id = v_ent_id
        ORDER BY w.worker_seq
        LIMIT 6;
      END IF;
    END IF;
  END LOOP;

  -- Actualizar `sst_onboarding_notifications` sin ningún DELETE:
  --   * Trabajadores históricos -> `COMPLETADA`
  --   * Los 10 cambios de cargo (`trigger_type = 'CAMBIO_CARGO'`) -> `EN_PROCESO`
  --   * Las 14 contrataciones recientes (`worker_seq` 152..165) -> permanecen en `PENDIENTE`
  UPDATE public.sst_onboarding_notifications son
  SET status = 'COMPLETADA',
      completed_at = (son.effective_date + 2 + time '16:00')::timestamptz
  WHERE son.organization_entity_id = ANY(v_entity_ids)
    AND son.trigger_type = 'NUEVA_CONTRATACION'
    AND son.worker_id NOT IN (
      SELECT w.worker_id FROM tmp_demo_workers w WHERE w.worker_seq BETWEEN 152 AND 165
    );

  UPDATE public.sst_onboarding_notifications
  SET status = 'EN_PROCESO'
  WHERE organization_entity_id = ANY(v_entity_ids)
    AND trigger_type = 'CAMBIO_CARGO';

  -- 10.2 28 Evaluaciones de Riesgos Laborales (`sst_risk_assessments`)
  --      y 36 Acciones Preventivas y Correctivas (`sst_preventive_actions`)
  DECLARE
    v_risk_types text[] := ARRAY['MECANICO', 'ELECTRICO', 'ERGONOMICO', 'FISICO', 'QUIMICO', 'LOCATIVO', 'PSICOSOCIAL', 'VIAL'];
    v_hazards text[] := ARRAY[
      'Atrapamiento por órganos móviles en tornos y fresadoras CNC sin resguardo enclavado',
      'Contacto eléctrico directo o arco eléctrico en maniobras de celdas de media tensión',
      'Sobreesfuerzo biomecánico lumbar en manipulación manual de cargas y piezas fundidas',
      'Exposición a niveles de ruido continuo superiores a 85 dB(A) en nave de calderería',
      'Inhalación de humos metálicos de soldadura en espacios con ventilación localizada insuficiente',
      'Caída a distinto nivel en trabajos sobre plataformas de montaje y puentes grúa',
      'Fatiga visual y carga mental en monitoreo prolongado de sistemas de control y despacho',
      'Colisión vial o vuelco en transporte de contenedores pesados en rutas interprovinciales'
    ];
    v_probs text[] := ARRAY['ALTA', 'MEDIA', 'MEDIA', 'ALTA', 'MEDIA', 'BAJA', 'BAJA', 'MEDIA'];
    v_sevs  text[] := ARRAY['GRAVE', 'EXTREMA', 'MODERADA', 'MODERADA', 'GRAVE', 'GRAVE', 'LEVE', 'EXTREMA'];
    v_lvls  text[] := ARRAY['IMPORTANTE', 'CRITICO', 'MODERADO', 'IMPORTANTE', 'IMPORTANTE', 'MODERADO', 'BAJO', 'CRITICO'];
    v_resp_worker_id uuid;
    v_resp_worker_name text;
  BEGIN
    FOR v_i IN 1..28 LOOP
      v_ent_idx := ((v_i - 1) % 13) + 1;
      v_ent_id  := v_entity_ids[v_ent_idx];

      SELECT p.pos_id, p.name, p.work_location, j.job_id, j.name, a.area_id, a.name
        INTO v_pos_id, v_pos_name, v_work_loc, v_job_id, v_job_name, v_area_id, v_area_name
      FROM tmp_demo_positions p
      JOIN tmp_demo_jobs j ON j.job_seq = p.job_seq
      JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
      WHERE p.entity_idx = v_ent_idx
      ORDER BY p.position_order DESC
      OFFSET ((v_i - 1) / 13)
      LIMIT 1;

      v_k := ((v_i - 1) % 8) + 1;

      INSERT INTO public.sst_risk_assessments (
        organization_entity_id,
        area_id, area_name_snapshot,
        job_id, job_name_snapshot,
        position_id, position_name_snapshot,
        facility_name, risk_type, hazard_description,
        cause_description, consequences,
        probability_level, severity_level, risk_level,
        existing_controls, status, evaluated_at, review_date, created_by
      ) VALUES (
        v_ent_id,
        v_area_id, v_area_name,
        v_job_id, v_job_name,
        v_pos_id, v_pos_name,
        v_work_loc, v_risk_types[v_k],
        v_hazards[v_k] || ' (' || v_area_name || ')',
        'Desgaste operativo de barreras físicas, exigencia del proceso productivo o exposición ambiental inherente a la operación.',
        'Lesiones osteomioarticulares, traumatismos mecánicos, quemaduras, hipoacusia inducida por ruido o afectación respiratoria.',
        v_probs[v_k], v_sevs[v_k], v_lvls[v_k],
        'Señalización normalizada, procedimiento de trabajo seguro vigente, supervisión pre-turno y dotación de EPP certificado.',
        CASE WHEN (v_i % 4) = 0 THEN 'CONTROLADO' WHEN v_i = 28 THEN 'CERRADO' ELSE 'ACTIVO' END,
        DATE '2026-02-10' + (v_i * 5),
        DATE '2027-02-10' + (v_i * 5),
        v_actor_user_id
      )
      RETURNING id INTO v_risk_id;

      v_sst_risk_ids := array_append(v_sst_risk_ids, v_risk_id);
    END LOOP;

    -- 36 Acciones Preventivas y Correctivas (`sst_preventive_actions`)
    FOR v_i IN 1..36 LOOP
      v_ent_idx   := ((v_i - 1) % 13) + 1;
      v_ent_id    := v_entity_ids[v_ent_idx];

      SELECT j.job_id, j.name, a.area_id, a.name
        INTO v_job_id, v_job_name, v_area_id, v_area_name
      FROM tmp_demo_jobs j
      JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
      WHERE j.entity_idx = v_ent_idx
      ORDER BY j.hierarchy_order DESC
      LIMIT 1;

      SELECT w.worker_id, w.full_name
        INTO v_resp_worker_id, v_resp_worker_name
      FROM tmp_demo_workers w
      WHERE w.entity_idx = v_ent_idx
      ORDER BY w.worker_seq ASC
      LIMIT 1;

      v_risk_id := CASE
        WHEN v_i <= 28 THEN v_sst_risk_ids[v_i]
        ELSE NULL
      END;

      INSERT INTO public.sst_preventive_actions (
        organization_entity_id,
        origin_type, origin_id, origin_label,
        description,
        area_id, area_name_snapshot,
        job_id, job_name_snapshot,
        responsible_worker_id, responsible_name_snapshot,
        priority, due_date, completed_date, status,
        cancellation_justification, verification_notes, created_by
      ) VALUES (
        v_ent_id,
        CASE
          WHEN v_i <= 20 THEN 'RIESGO'
          WHEN v_i <= 28 THEN 'INSPECCION'
          WHEN v_i <= 32 THEN 'ACCIDENTE'
          WHEN v_i <= 34 THEN 'COMITE'
          ELSE 'SIMULACRO'
        END,
        v_risk_id,
        'Medida técnica #' || lpad(v_i::text, 2, '0') || ' del Plan Anual de Prevención SST',
        'Instalar resguardos con microinterruptor de enclavamiento, recalibrar protecciones diferenciales y verificar cumplimiento del PTS en ' || v_area_name || '.',
        v_area_id, v_area_name,
        v_job_id, v_job_name,
        v_resp_worker_id, v_resp_worker_name,
        CASE (v_i % 4) WHEN 0 THEN 'INMEDIATA' WHEN 1 THEN 'ALTA' WHEN 2 THEN 'MEDIA' ELSE 'BAJA' END,
        CASE
          WHEN v_i <= 16 THEN DATE '2026-08-15' + v_i
          WHEN v_i <= 26 THEN DATE '2026-12-05' + (v_i - 16)
          WHEN v_i <= 31 THEN DATE '2026-11-28' + (v_i - 26)
          WHEN v_i <= 34 THEN DATE '2026-09-25'
          ELSE DATE '2026-10-10'
        END,
        CASE WHEN v_i <= 16 THEN DATE '2026-08-12' + v_i ELSE NULL END,
        CASE
          WHEN v_i <= 16 THEN 'COMPLETADA'
          WHEN v_i <= 26 THEN 'EN_EJECUCION'
          WHEN v_i <= 31 THEN 'PENDIENTE'
          WHEN v_i <= 34 THEN 'VENCIDA'
          ELSE 'CANCELADA'
        END,
        CASE
          WHEN v_i > 34 THEN 'Línea tecnológica sustituida íntegramente por equipamiento nuevo con cabina insonorizada de fábrica.'
          ELSE NULL
        END,
        CASE
          WHEN v_i <= 16 THEN 'Efectividad comprobada en inspección de seguimiento por el Especialista de SST.'
          ELSE 'En seguimiento quincenal por la comisión de seguridad.'
        END,
        v_actor_user_id
      );
    END LOOP;
  END;

  -- 10.3 Catálogo de EPP (`sst_epp_catalog`: 15 equipos),
  --      Requisitos de EPP por Cargo (`sst_job_epp_requirements`: 40 requisitos)
  --      y Entregas individuales de EPP (`sst_worker_epp_deliveries`: 190 entregas)
  DECLARE
    v_epp_names text[] := ARRAY[
      'Casco Dieléctrico Clase E con Barbuquejo',
      'Botas de Seguridad con Puntera de Acero y Suela Antiperforante',
      'Guantes de Cuero Cromo Reforzados para Soldadura y Pailería',
      'Guantes Dieléctricos Clase 2 (hasta 17 kV)',
      'Espejuelos de Seguridad Policarbonato Antiempañante ANSI Z87.1',
      'Careta Electrónica Fotosensible para Soldadura TIG/MIG',
      'Protector Auditivo Tipo Orejera de Copa (SNR 31 dB)',
      'Arnés Integral Anticaídas de Cuerpo Completo con Doble Cabo de Vida',
      'Chaleco Reflectivo de Alta Visibilidad para Operaciones Logísticas',
      'Mascarilla Respirador de Media Cara con Filtros para Humos Metálicos',
      'Peto y Polainas de Cuero Ignífugo para Corte y Soldadura',
      'Botas Dieléctricas sin Componentes Metálicos para Subestaciones',
      'Faja Ergonómica de Soporte Lumbar para Manipulación de Cargas',
      'Pantalla Facial de Protección contra Impactos y Esmerilado',
      'Ropa de Trabajo Ignífuga en Algodón Tratado para Mantenimiento Eléctrico'
    ];
    v_epp_cats text[] := ARRAY[
      'PROTECCION_CRANEAL', 'CALZADO_SEGURIDAD', 'PROTECCION_MANOS', 'PROTECCION_ELECTRICA',
      'PROTECCION_OCULAR', 'PROTECCION_FACIAL', 'PROTECCION_AUDITIVA', 'TRABAJO_ALTURAS',
      'ALTA_VISIBILIDAD', 'PROTECCION_RESPIRATORIA', 'ROPA_ESPECIAL', 'CALZADO_SEGURIDAD',
      'ERGONOMIA', 'PROTECCION_FACIAL', 'ROPA_ESPECIAL'
    ];
  BEGIN
    FOR v_i IN 1..15 LOOP
      v_ent_idx := ((v_i - 1) % 13) + 1;
      v_ent_id  := v_entity_ids[v_ent_idx];

      INSERT INTO public.sst_epp_catalog (
        organization_entity_id, name, category, description,
        default_lifespan_days, stock_quantity, min_stock_alert
      ) VALUES (
        v_ent_id,
        v_epp_names[v_i], v_epp_cats[v_i],
        'Equipo de protección personal certificado según norma cubana NC-ISO para operaciones de ' || v_epp_cats[v_i] || '.',
        CASE WHEN (v_i % 3) = 0 THEN 365 ELSE 180 END,
        CASE WHEN v_i IN (4, 8, 12) THEN 3 ELSE 28 + (v_i * 2) END,
        6
      );
    END LOOP;

    -- 40 Requisitos de EPP por Cargo (`sst_job_epp_requirements`)
    FOR v_i IN 1..40 LOOP
      SELECT j.job_id, j.entity_id, j.name
        INTO v_job_id, v_ent_id, v_job_name
      FROM tmp_demo_jobs j
      WHERE j.job_seq = ((v_i - 1) % 85) + 1;

      SELECT c.id, c.name
        INTO v_epp_id, v_area_name
      FROM public.sst_epp_catalog c
      WHERE c.organization_entity_id = v_ent_id
      ORDER BY c.name ASC
      OFFSET ((v_i - 1) / 13)
      LIMIT 1;

      IF v_epp_id IS NULL THEN
        SELECT c.id, c.name INTO v_epp_id, v_area_name
        FROM public.sst_epp_catalog c ORDER BY c.id LIMIT 1;
      END IF;

      INSERT INTO public.sst_job_epp_requirements (
        organization_entity_id, job_id, job_name_snapshot,
        epp_id, epp_name_snapshot, is_mandatory, renewal_months, notes
      ) VALUES (
        v_ent_id, v_job_id, v_job_name,
        v_epp_id, v_area_name, true,
        CASE WHEN (v_i % 2) = 0 THEN 6 ELSE 12 END,
        'Uso obligatorio durante toda la jornada operativa en planta, taller o vía.'
      )
      ON CONFLICT (organization_entity_id, job_id, epp_id) DO NOTHING;
    END LOOP;

    -- 190 Entregas de EPP a trabajadores (`sst_worker_epp_deliveries`)
    FOR v_i IN 1..190 LOOP
      SELECT w.worker_id, w.full_name, w.entity_id, w.job_id, j.name
        INTO v_worker_id, v_full_name, v_ent_id, v_job_id, v_job_name
      FROM tmp_demo_workers w
      JOIN tmp_demo_jobs j ON j.job_seq = w.job_seq
      WHERE w.worker_seq = ((v_i - 1) % 165) + 1;

      SELECT c.id, c.name
        INTO v_epp_id, v_area_name
      FROM public.sst_epp_catalog c
      WHERE c.organization_entity_id = v_ent_id
      LIMIT 1;

      IF v_epp_id IS NULL THEN
        SELECT c.id, c.name INTO v_epp_id, v_area_name
        FROM public.sst_epp_catalog c
        OFFSET (v_i % 15) LIMIT 1;
      END IF;

      INSERT INTO public.sst_worker_epp_deliveries (
        organization_entity_id, worker_id, worker_name_snapshot,
        job_id, job_name_snapshot, epp_id, epp_name_snapshot,
        quantity, delivery_date, renewal_due_date,
        status, signed_receipt, notes, created_by
      ) VALUES (
        v_ent_id, v_worker_id, v_full_name,
        v_job_id, v_job_name, v_epp_id, v_area_name,
        1,
        DATE '2026-04-01' + ((v_i * 3) % 190),
        CASE
          WHEN (v_i % 11) = 0 THEN DATE '2026-10-15'
          ELSE DATE '2026-04-01' + ((v_i * 3) % 190) + 180
        END,
        CASE
          WHEN (v_i % 11) = 0 THEN 'PENDIENTE_REPOSICION'
          WHEN (v_i % 19) = 0 THEN 'REPUESTO'
          ELSE 'ENTREGADO'
        END,
        true,
        'Entrega registrada con firma de conformidad en tarjeta individual de control de EPP.',
        v_actor_user_id
      );
    END LOOP;
  END;

  -- 10.4 18 Inspecciones de Seguridad (`sst_inspections`) y 42 Hallazgos (`sst_inspection_findings`)
  FOR v_i IN 1..18 LOOP
    v_ent_idx := ((v_i - 1) % 13) + 1;
    v_ent_id  := v_entity_ids[v_ent_idx];

    SELECT a.area_id, a.name
      INTO v_area_id, v_area_name
    FROM tmp_demo_areas a
    WHERE a.entity_idx = v_ent_idx
    ORDER BY a.hierarchy_order DESC
    LIMIT 1;

    INSERT INTO public.sst_inspections (
      organization_entity_id, area_id, area_name_snapshot,
      facility_name, inspection_type, inspector_name,
      scheduled_date, executed_date, status, summary_notes, created_by
    ) VALUES (
      v_ent_id, v_area_id, v_area_name,
      'Instalación Operativa Principal · ' || v_area_name,
      CASE (v_i % 3) WHEN 0 THEN 'ORDINARIA' WHEN 1 THEN 'ESPECIALIZADA_EPP' ELSE 'EXTRAORDINARIA' END,
      'Ing. ' || v_male_names[v_i] || ' ' || v_surnames[v_i + 15] || ' (Especialista SST)',
      DATE '2026-03-05' + (v_i * 12),
      CASE WHEN v_i <= 15 THEN DATE '2026-03-05' + (v_i * 12) ELSE NULL END,
      CASE
        WHEN v_i <= 10 THEN 'CERRADA'
        WHEN v_i <= 14 THEN 'EN_SEGUIMIENTO'
        WHEN v_i = 15  THEN 'ABIERTA'
        ELSE 'PROGRAMADA'
      END,
      'Verificación de orden y limpieza (5S), estado de extintores, señalización, tableros eléctricos y uso efectivo de EPP.',
      v_actor_user_id
    )
    RETURNING id INTO v_insp_id;

    v_sst_insp_ids := array_append(v_sst_insp_ids, v_insp_id);
  END LOOP;

  -- 42 Hallazgos distribuidos en las inspecciones
  FOR v_i IN 1..42 LOOP
    v_j := ((v_i - 1) % 15) + 1;
    v_insp_id := v_sst_insp_ids[v_j];

    SELECT organization_entity_id INTO v_ent_id
    FROM public.sst_inspections WHERE id = v_insp_id;

    SELECT id INTO v_action_id
    FROM public.sst_preventive_actions
    WHERE organization_entity_id = v_ent_id
    ORDER BY created_at ASC
    LIMIT 1;

    INSERT INTO public.sst_inspection_findings (
      organization_entity_id, inspection_id,
      item_checked, conforms, finding_description,
      severity, preventive_action_id
    ) VALUES (
      v_ent_id, v_insp_id,
      CASE (v_i % 5)
        WHEN 0 THEN 'Pasillos de circulación y vías de evacuación despejadas y demarcadas'
        WHEN 1 THEN 'Extintores de CO2 y PQS presurizados y con tarjeta de inspección vigente'
        WHEN 2 THEN 'Tableros eléctricos identificados, cerrados y con barra de puesta a tierra'
        WHEN 3 THEN 'Uso completo de equipos de protección personal obligatorios por el puesto'
        ELSE 'Resguardos fijos y móviles instalados en máquinas herramientas y equipos rotativos'
      END,
      ((v_i % 3) = 0),
      CASE
        WHEN (v_i % 3) = 0 THEN 'Cumple íntegramente con los parámetros de la lista de chequeo.'
        ELSE 'Se detecta señalización desgastada u obstrucción parcial que requiere acción correctiva inmediata.'
      END,
      CASE (v_i % 4) WHEN 0 THEN 'LEVE' WHEN 1 THEN 'MODERADO' WHEN 2 THEN 'GRAVE' ELSE 'CRITICO' END,
      CASE WHEN (v_i % 3) <> 0 THEN v_action_id ELSE NULL END
    );
  END LOOP;

  -- 10.5 140 Evaluaciones Administrativas de Aptitud Ocupacional (`sst_worker_health_aptitude`)
  FOR v_i IN 1..140 LOOP
    SELECT w.worker_id, w.full_name, w.entity_id, w.job_id, j.name
      INTO v_worker_id, v_full_name, v_ent_id, v_job_id, v_job_name
    FROM tmp_demo_workers w
    JOIN tmp_demo_jobs j ON j.job_seq = w.job_seq
    WHERE w.worker_seq = v_i;

    INSERT INTO public.sst_worker_health_aptitude (
      organization_entity_id, worker_id, worker_name_snapshot,
      job_id, job_name_snapshot, evaluation_type,
      evaluation_date, next_review_date, aptitude_status,
      administrative_restrictions, administrative_notes, created_by
    ) VALUES (
      v_ent_id, v_worker_id, v_full_name,
      v_job_id, v_job_name,
      CASE
        WHEN v_i BETWEEN 30 AND 39 THEN 'CAMBIO_CARGO'
        WHEN v_i BETWEEN 15 AND 20 THEN 'REINTEGRO'
        WHEN (v_i % 5) = 0 THEN 'PRE_EMPLEO'
        ELSE 'PERIODICO'
      END,
      DATE '2026-01-20' + ((v_i * 2) % 260),
      DATE '2027-01-20' + ((v_i * 2) % 260),
      CASE
        WHEN (v_i % 18) = 0 THEN 'APTO_CON_RESTRICCIONES'
        WHEN v_i = 139      THEN 'NO_APTO_TEMPORAL'
        WHEN v_i = 140      THEN 'PENDIENTE'
        ELSE 'APTO'
      END,
      CASE
        WHEN (v_i % 18) = 0 THEN 'No realizar levantamiento manual de cargas superiores a 15 kg ni trabajo en alturas mayores a 3 metros.'
        WHEN v_i = 139      THEN 'Reubicación administrativa temporal en tareas de gabinete durante 30 días.'
        ELSE NULL
      END,
      'Dictamen administrativo de aptitud laboral emitido por comisión médica ocupacional autorizada.',
      v_actor_user_id
    );
  END LOOP;

  -- 10.6 9 Accidentes e Incidentes de Trabajo (`sst_accidents_incidents`)
  FOR v_i IN 1..9 LOOP
    v_ent_idx := 4 + v_i;
    v_ent_id  := v_entity_ids[v_ent_idx];

    SELECT w.worker_id, w.full_name, w.job_id, j.name, w.area_id, a.name
      INTO v_worker_id, v_full_name, v_job_id, v_job_name, v_area_id, v_area_name
    FROM tmp_demo_workers w
    JOIN tmp_demo_jobs j ON j.job_seq = w.job_seq
    JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
    WHERE w.entity_idx = v_ent_idx
    ORDER BY w.worker_seq DESC
    LIMIT 1;

    INSERT INTO public.sst_accidents_incidents (
      organization_entity_id, event_type, occurred_at,
      area_id, area_name_snapshot, job_id, job_name_snapshot,
      affected_worker_id, affected_worker_name, witness_names,
      description, immediate_causes, basic_causes,
      severity, days_lost, immediate_actions,
      investigation_conclusions, status
    ) VALUES (
      v_ent_id,
      CASE WHEN v_i IN (2, 5, 8) THEN 'ACCIDENTE_CON_LESION' ELSE 'INCIDENTE_SIN_LESION' END,
      DATE '2026-02-18' + (v_i * 25),
      v_area_id, v_area_name, v_job_id, v_job_name,
      v_worker_id, v_full_name,
      'Ing. Roberto Gómez · Téc. Yoel Hernández (Testigos presenciales del turno)',
      CASE
        WHEN v_i IN (2, 5, 8) THEN 'Contusión leve en miembro superior al manipular pieza metálica durante ajuste de mordaza en banco de taller.'
        ELSE 'Desprendimiento de eslinga auxiliar durante maniobra de izaje en vacío, sin impacto sobre trabajadores ni equipos.'
      END,
      'Posicionamiento inadecuado de la herramienta de sujeción y falta de verificación previa del pestillo de seguridad.',
      'Supervisión insuficiente de la maniobra rutinaria y necesidad de actualización del procedimiento de izaje.',
      CASE WHEN v_i IN (2, 5, 8) THEN 'MODERADA' ELSE 'LEVE' END,
      CASE WHEN v_i = 2 THEN 4 WHEN v_i = 5 THEN 6 WHEN v_i = 8 THEN 3 ELSE 0 END,
      'Detención inmediata de la operación, primeros auxilios en posta médica, acordonamiento del área y sustitución del accesorio.',
      'Comisión investigadora concluyó plan de medidas correctivas y charla de recapacitación obligatoria a toda la brigada.',
      CASE WHEN v_i <= 6 THEN 'CERRADO' WHEN v_i IN (7, 8) THEN 'EN_INVESTIGACION' ELSE 'REPORTADO' END
    );
  END LOOP;

  -- 10.7 10 Planes de Emergencia y Simulacros (`sst_emergency_plans`)
  FOR v_i IN 1..10 LOOP
    v_ent_idx := ((v_i - 1) % 13) + 1;
    v_ent_id  := v_entity_ids[v_ent_idx];

    SELECT a.area_id, a.name
      INTO v_area_id, v_area_name
    FROM tmp_demo_areas a
    WHERE a.entity_idx = v_ent_idx
    ORDER BY a.hierarchy_order ASC
    LIMIT 1;

    INSERT INTO public.sst_emergency_plans (
      organization_entity_id, area_id, area_name_snapshot,
      title, plan_type, version, valid_until,
      brigade_members_notes, equipment_notes,
      last_drill_date, drill_result_notes
    ) VALUES (
      v_ent_id, v_area_id, v_area_name,
      CASE (v_i % 4)
        WHEN 0 THEN 'Plan de Emergencia contra Incendios y Evacuación de Planta Industrial'
        WHEN 1 THEN 'Plan de Contingencia ante Eventos Hidrometeorológicos Extremos (Ciclones)'
        WHEN 2 THEN 'Protocolo de Respuesta ante Derrames de Combustibles y Lubricantes'
        ELSE 'Plan de Rescate Técnico en Alturas y Espacios Confinados'
      END,
      CASE (v_i % 4)
        WHEN 0 THEN 'INCENDIO_EVACUACION'
        WHEN 1 THEN 'METEOROLOGICO'
        WHEN 2 THEN 'DERRAME_QUIMICO'
        ELSE 'EMERGENCIA_GENERAL'
      END,
      '2.1',
      DATE '2027-06-30',
      'Brigada contra incendios y primeros auxilios integrada por 12 trabajadores certificados con jefe de brigada por turno.',
      'Red de hidrantes presurizada, 24 extintores portátiles ABC/CO2, alarma acústica estroboscópica, camilla rígida y botiquines tipo A.',
      DATE '2026-05-15' + (v_i * 11),
      'Simulacro ejecutado en 3 min 40 s (meta < 4 min). Participación del 98 % de la plantilla presente; funcionamiento óptimo de alarmas.'
    );
  END LOOP;

  -- 10.8 12 Actas y Registros del Comité SST (`sst_committee_records`)
  FOR v_i IN 1..12 LOOP
    v_ent_idx := ((v_i - 1) % 12) + 2;
    v_ent_id  := v_entity_ids[v_ent_idx];

    SELECT w.worker_id, w.full_name
      INTO v_worker_id, v_full_name
    FROM tmp_demo_workers w
    WHERE w.entity_idx = v_ent_idx
    ORDER BY w.worker_seq ASC
    LIMIT 1;

    INSERT INTO public.sst_committee_records (
      organization_entity_id, record_type, title, record_date,
      member_worker_id, member_name, member_role,
      agreements_or_notes, status
    ) VALUES (
      v_ent_id,
      CASE (v_i % 3) WHEN 0 THEN 'CONSTITUCION' WHEN 1 THEN 'REUNION' ELSE 'ACUERDO' END,
      'Acta Oficial No. ' || lpad(v_i::text, 2, '0') || '/2026 · Comité Paritario de Seguridad y Salud en el Trabajo',
      DATE '2026-01-25' + (v_i * 22),
      v_worker_id, v_full_name,
      CASE (v_i % 3) WHEN 0 THEN 'Presidente del Comité SST' WHEN 1 THEN 'Secretario Técnico SST' ELSE 'Representante Sindical de Seguridad' END,
      'Se revisa el cumplimiento del presupuesto de EPP del trimestre, los índices de accidentalidad cero y el cierre de hallazgos de inspección.',
      'VIGENTE'
    );
  END LOOP;

  -- 10.9 16 Procedimientos de Trabajo Seguro (`sst_safe_work_procedures`)
  DECLARE
    v_pts_titles text[] := ARRAY[
      'Procedimiento de Bloqueo y Etiquetado de Energías Peligrosas (LOTO)',
      'Procedimiento de Trabajo Seguro en Caliente (Soldadura, Oxicorte y Esmerilado)',
      'Procedimiento para Trabajos en Altura sobre Andamios y Plataformas Elevadoras',
      'Procedimiento de Entrada y Rescate en Espacios Confinados (Calderas y Tanques)',
      'Procedimiento de Izaje Mecánico de Cargas con Puentes Grúa y Polipastos',
      'Procedimiento de Maniobras en Celdas y Subestaciones de Media Tensión',
      'Procedimiento de Operación Segura de Tornos, Fresadoras y Centros CNC',
      'Procedimiento de Estiba, Trincaje y Transporte de Contenedores Pesados',
      'Procedimiento de Operación Segura de Montacargas Eléctricos y de Combustión',
      'Procedimiento de Mantenimiento de Enfriadoras de Agua (Chillers) y Gases Refrigerantes',
      'Procedimiento de Pruebas Hidrostáticas en Recipientes a Presión y Tuberías',
      'Procedimiento de Manipulación, Almacenamiento y Trasiego de Combustibles y Aceites',
      'Procedimiento de Mantenimiento y Prueba en Carga de Grupos Electrógenos',
      'Procedimiento de Seguridad en Almacenes Frigoríficos y Cámaras de Congelación',
      'Procedimiento de Ergonomía e Higiene Postural en Oficinas y Puestos de Videoterminales',
      'Procedimiento de Inspección Pre-Viaje y Seguridad Vial para Flota Pesada'
    ];
  BEGIN
    FOR v_i IN 1..16 LOOP
      v_ent_idx := ((v_i - 1) % 13) + 1;
      v_ent_id  := v_entity_ids[v_ent_idx];

      SELECT j.job_id, j.name, a.area_id, a.name
        INTO v_job_id, v_job_name, v_area_id, v_area_name
      FROM tmp_demo_jobs j
      JOIN tmp_demo_areas a ON a.area_seq = j.area_seq
      WHERE j.entity_idx = v_ent_idx
      ORDER BY j.hierarchy_order DESC
      LIMIT 1;

      INSERT INTO public.sst_safe_work_procedures (
        organization_entity_id, code, title,
        area_id, area_name_snapshot, job_id, job_name_snapshot,
        version, status, requires_special_permit, summary
      ) VALUES (
        v_ent_id,
        'PTS-GEH-' || lpad(v_i::text, 3, '0'),
        v_pts_titles[v_i],
        v_area_id, v_area_name, v_job_id, v_job_name,
        '3.0', 'VIGENTE',
        (v_i IN (1, 2, 3, 4, 5, 6, 11)),
        'Establece la secuencia operativa segura, los equipos de protección personal obligatorios, las verificaciones previas y las prohibiciones expresas para ' || lower(v_pts_titles[v_i]) || '.'
      );
    END LOOP;
  END;

  -- ==========================================================================
  -- 11. AUTOVERIFICACIÓN INTERNA ESTRICTA ANTES DE CONFIRMAR LA TRANSACCIÓN
  -- ==========================================================================
  SELECT count(*) INTO v_chk_entities
  FROM public.organization_entities WHERE company_client_id = v_client_id;

  SELECT count(*) INTO v_chk_areas
  FROM public.organization_areas WHERE organization_entity_id = ANY(v_entity_ids);

  SELECT count(*) INTO v_chk_jobs
  FROM public.organization_jobs WHERE organization_entity_id = ANY(v_entity_ids);

  SELECT count(*), COALESCE(sum(authorized_quantity), 0)
    INTO v_chk_positions, v_chk_authorized
  FROM public.organization_positions
  WHERE organization_entity_id = ANY(v_entity_ids) AND is_active = true;

  SELECT count(*) INTO v_chk_occupied
  FROM public.worker_position_assignments a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE w.company_client_id = v_client_id
    AND w.employment_status = 'active'
    AND a.is_current = true
    AND a.end_date IS NULL;

  v_chk_vacant := v_chk_authorized - v_chk_occupied;

  SELECT count(*) FILTER (WHERE employment_status = 'active'),
         count(*) FILTER (WHERE employment_status = 'inactive')
    INTO v_chk_active_workers, v_chk_inactive_workers
  FROM public.workers
  WHERE company_client_id = v_client_id;

  SELECT count(*) INTO v_chk_candidates
  FROM public.candidates
  WHERE company_client_id = v_client_id AND worker_id IS NULL;

  IF v_chk_entities <> 13 THEN
    RAISE EXCEPTION 'Verificación DEMO fallida: se esperaban 13 entidades y se crearon %', v_chk_entities;
  END IF;
  IF v_chk_areas <> 46 THEN
    RAISE EXCEPTION 'Verificación DEMO fallida: se esperaban 46 áreas y se crearon %', v_chk_areas;
  END IF;
  IF v_chk_jobs <> 85 THEN
    RAISE EXCEPTION 'Verificación DEMO fallida: se esperaban 85 cargos y se crearon %', v_chk_jobs;
  END IF;
  IF v_chk_positions <> 111 THEN
    RAISE EXCEPTION 'Verificación DEMO fallida: se esperaban 111 puestos y se crearon %', v_chk_positions;
  END IF;
  IF v_chk_authorized <> 200 OR v_chk_occupied <> 165 OR v_chk_vacant <> 35 THEN
    RAISE EXCEPTION 'Verificación DEMO fallida en plantilla: aprobadas=% (esp 200), ocupadas=% (esp 165), vacantes=% (esp 35)',
      v_chk_authorized, v_chk_occupied, v_chk_vacant;
  END IF;
  IF v_chk_active_workers <> 165 OR v_chk_inactive_workers <> 8 OR v_chk_candidates <> 14 THEN
    RAISE EXCEPTION 'Verificación DEMO fallida en personas: activos=% (esp 165), inactivos=% (esp 8), candidatos=% (esp 14)',
      v_chk_active_workers, v_chk_inactive_workers, v_chk_candidates;
  END IF;

  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'ENTORNO DEMO «GRUPO EMPRESARIAL HORIZONTE» GENERADO EXITOSAMENTE';
  RAISE NOTICE '  Cliente ID: %', v_client_id;
  RAISE NOTICE '  Entidades:  % (1 Grupo + 4 Empresas + 8 UEB)', v_chk_entities;
  RAISE NOTICE '  Estructura: % áreas · % cargos · % puestos', v_chk_areas, v_chk_jobs, v_chk_positions;
  RAISE NOTICE '  Plantilla:  % plazas aprobadas = % ocupadas + % vacantes', v_chk_authorized, v_chk_occupied, v_chk_vacant;
  RAISE NOTICE '  Personas:   % activos · % en Reingresos · % Candidatos', v_chk_active_workers, v_chk_inactive_workers, v_chk_candidates;
  RAISE NOTICE '====================================================================';
END
$demo_horizonte$;

COMMIT;

-- ============================================================================
-- LIMPIEZA FINAL DE TABLAS TEMPORALES
-- Una vez confirmada la transacción, se eliminan las tablas temporales de trabajo
-- para dejar la sesión de base de datos en estado limpio.
-- ============================================================================
DROP TABLE IF EXISTS tmp_demo_workers CASCADE;
DROP TABLE IF EXISTS tmp_demo_positions CASCADE;
DROP TABLE IF EXISTS tmp_demo_jobs CASCADE;
DROP TABLE IF EXISTS tmp_demo_areas CASCADE;
