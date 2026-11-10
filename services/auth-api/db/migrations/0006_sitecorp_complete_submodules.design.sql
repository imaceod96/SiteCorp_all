-- =============================================================================
-- SITECORP COMPLETE SUBMODULES & FULL SCHEMA RECONCILIATION — POSTGRESQL DDL (FASE 4G.7)
-- =============================================================================
-- Migración: 0006_sitecorp_complete_submodules
-- Esquema: public
-- Descripción:
--   Completa las 24 tablas funcionales pendientes y el conjunto de catálogos y
--   tablas operativas de los submódulos de SiteCorp:
--   1. Cuadros y reservas (cadre_reserves, cadre_evaluations, cadre_movements)
--   2. Plantillas documentales avanzadas y generación por lotes (template_variables,
--      template_sections, generated_documents, document_template_types,
--      document_template_versions, document_types, document_variables,
--      document_generation_events, document_batches, document_batch_items,
--      worker_documents, governing_documents, platform_document_folders,
--      platform_documents)
--   3. Invitaciones y notificaciones (client_invitations, company_client_invitations,
--      entity_invitations, notification_preferences, user_notifications)
--   4. Nómina, prenómina avanzada y escalas (salary_bonuses, salary_deductions,
--      payroll_closures, prenomina_night_entries, worker_payroll_movements,
--      worker_salary_history, salary_group_values, academic_category_payments,
--      tenure_payment_scales, employment_contract_compensation_components,
--      employment_contract_addendum_changes)
--   5. Capacitación y SST ampliado (training_courses, worker_trainings,
--      training_folders, training_topics, training_topic_documents,
--      training_sessions, training_initial_notifications, worker_training_records,
--      ppe_deliveries, work_accidents, sst_epp_catalog, sst_job_epp_requirements,
--      sst_worker_epp_deliveries, sst_risk_assessments, sst_preventive_actions,
--      sst_safe_work_procedures, sst_emergency_plans, sst_committee_records,
--      sst_inspection_findings, sst_job_folders, sst_onboarding_notifications,
--      sst_training_topics, sst_topic_documents, sst_training_sessions,
--      sst_worker_training_records, sst_worker_health_aptitude)
--   6. Comisiones de evaluación, disciplina, resoluciones y planes de entidad
--      (evaluation_committees, disciplinary_measures, worker_resolutions,
--      entity_plans, entity_plan_history, organization_representative_positions,
--      organization_representative_assignments)
--   7. Reportes, importación/exportación, expediente de candidatos y catálogos
--      (custom_reports, report_schedules, import_batches, export_jobs,
--      webhook_subscriptions, candidate_*, genders, skin_colors, education_levels,
--      marital_statuses, political_affiliations, payment_methods, rehire_statuses,
--      preparation_levels, driving_license_categories, employment_contract_types,
--      employment_types, entity_regimes, worker_separation_reasons,
--      organization_job_preparation_levels, organization_job_cla_night_segments,
--      position_schedule_segments, worker_driving_license_categories,
--      platform_founder, platform_roles, platform_permissions,
--      platform_role_permissions, platform_user_roles, company_client_roles,
--      company_client_permissions, company_client_role_permissions,
--      company_client_user_roles, user_password_lifecycle, user_sessions)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CUADROS Y RESERVAS (CADRES & RESERVES)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cadre_reserves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    target_position_id UUID NULL REFERENCES public.organization_positions(id) ON DELETE SET NULL,
    reserve_category VARCHAR(64) NOT NULL DEFAULT 'RESERVA_INMEDIATA',
    readiness_level VARCHAR(32) NOT NULL DEFAULT 'EN_PREPARACION',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    designated_at DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cadre_reserves_company ON public.cadre_reserves(company_client_id);
CREATE INDEX IF NOT EXISTS idx_cadre_reserves_worker ON public.cadre_reserves(worker_id);

CREATE TABLE IF NOT EXISTS public.cadre_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    cadre_reserve_id UUID NULL REFERENCES public.cadre_reserves(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    evaluation_period VARCHAR(32) NOT NULL,
    evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    rating VARCHAR(32) NOT NULL DEFAULT 'SATISFACTORIO',
    score NUMERIC(5,2) NULL,
    evaluator_name VARCHAR(255) NULL,
    recommendations TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cadre_eval_company ON public.cadre_evaluations(company_client_id);

CREATE TABLE IF NOT EXISTS public.cadre_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    cadre_reserve_id UUID NULL REFERENCES public.cadre_reserves(id) ON DELETE SET NULL,
    movement_type VARCHAR(64) NOT NULL DEFAULT 'PROMOCION_CUADRO',
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    from_position_id UUID NULL REFERENCES public.organization_positions(id) ON DELETE SET NULL,
    to_position_id UUID NULL REFERENCES public.organization_positions(id) ON DELETE SET NULL,
    resolution_number VARCHAR(64) NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cadre_mov_company ON public.cadre_movements(company_client_id);

-- =============================================================================
-- 2. PLANTILLAS DOCUMENTALES AVANZADAS Y GENERACIÓN POR LOTES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.document_template_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'CONTRACT',
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    scope VARCHAR(64) NOT NULL DEFAULT 'WORKER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.document_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(128) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    source_module VARCHAR(64) NOT NULL DEFAULT 'workers',
    data_type VARCHAR(32) NOT NULL DEFAULT 'text',
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.template_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
    variable_key VARCHAR(128) NOT NULL,
    label VARCHAR(255) NOT NULL,
    data_type VARCHAR(32) NOT NULL DEFAULT 'string',
    default_value TEXT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_template_vars_template ON public.template_variables(template_id);

CREATE TABLE IF NOT EXISTS public.template_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
    section_code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    section_order INT NOT NULL DEFAULT 1,
    content_template TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_template_sections_template ON public.template_sections(template_id);

CREATE TABLE IF NOT EXISTS public.document_template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.document_templates(id) ON DELETE CASCADE,
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    version_number INT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    storage_path TEXT NULL,
    file_name VARCHAR(255) NULL,
    mime_type VARCHAR(128) NULL,
    detected_variables JSONB NULL,
    validation_summary JSONB NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_template_versions_tpl ON public.document_template_versions(template_id);

CREATE TABLE IF NOT EXISTS public.document_generation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    worker_id UUID NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    template_id UUID NULL REFERENCES public.document_templates(id) ON DELETE SET NULL,
    template_version_id UUID NULL REFERENCES public.document_template_versions(id) ON DELETE SET NULL,
    document_type VARCHAR(64) NOT NULL,
    source_id UUID NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    storage_path TEXT NULL,
    error_message TEXT NULL,
    payload_snapshot JSONB NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_gen_events_company ON public.document_generation_events(company_client_id);

CREATE TABLE IF NOT EXISTS public.generated_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    worker_id UUID NULL REFERENCES public.workers(id) ON DELETE SET NULL,
    template_id UUID NULL REFERENCES public.document_templates(id) ON DELETE SET NULL,
    document_type VARCHAR(64) NOT NULL DEFAULT 'CONTRACT',
    title VARCHAR(255) NOT NULL,
    rendered_content TEXT NOT NULL,
    storage_object_id UUID NULL REFERENCES public.storage_objects(id) ON DELETE SET NULL,
    sha256_checksum VARCHAR(64) NULL,
    metadata JSONB NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_docs_company ON public.generated_documents(company_client_id);

CREATE TABLE IF NOT EXISTS public.document_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    batch_type VARCHAR(64) NOT NULL DEFAULT 'MASS_GENERATION',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    total_items INT NOT NULL DEFAULT 0,
    completed_items INT NOT NULL DEFAULT 0,
    zip_storage_path TEXT NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_batches_company ON public.document_batches(company_client_id);

CREATE TABLE IF NOT EXISTS public.document_batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.document_batches(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NULL REFERENCES public.workers(id) ON DELETE SET NULL,
    document_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    storage_path TEXT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_batch_items_batch ON public.document_batch_items(batch_id);

CREATE TABLE IF NOT EXISTS public.worker_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    document_type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_docs_company ON public.worker_documents(company_client_id, worker_id);

CREATE TABLE IF NOT EXISTS public.governing_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    document_category VARCHAR(64) NOT NULL DEFAULT 'REGLAMENTO',
    storage_path TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_governing_docs_company ON public.governing_documents(company_client_id);

CREATE TABLE IF NOT EXISTS public.platform_document_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID NULL REFERENCES public.platform_document_folders(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(128) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NULL REFERENCES public.platform_document_folders(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 3. INVITACIONES Y NOTIFICACIONES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role_code VARCHAR(64) NOT NULL DEFAULT 'company_member',
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    invited_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_invitations_company ON public.client_invitations(company_client_id);

CREATE TABLE IF NOT EXISTS public.company_client_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NULL,
    role_id UUID NULL,
    role_code VARCHAR(64) NOT NULL DEFAULT 'company_member',
    token_hash VARCHAR(64) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
    invited_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cc_invitations_company ON public.company_client_invitations(company_client_id);

CREATE TABLE IF NOT EXISTS public.entity_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role_code VARCHAR(64) NOT NULL DEFAULT 'entity_operator',
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    invited_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entity_invitations_company ON public.entity_invitations(company_client_id);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL DEFAULT 'email',
    event_category VARCHAR(64) NOT NULL DEFAULT 'general',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_notification_pref UNIQUE (user_id, channel, event_category)
);

CREATE TABLE IF NOT EXISTS public.user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    notification_type VARCHAR(64) NOT NULL DEFAULT 'INFO',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON public.user_notifications(user_id, is_read);

-- =============================================================================
-- 4. NÓMINA, PRENÓMINA AVANZADA Y COMPENSACIONES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.salary_bonuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    period_id UUID NULL REFERENCES public.prenomina_periods(id) ON DELETE SET NULL,
    bonus_code VARCHAR(64) NOT NULL,
    concept VARCHAR(255) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salary_bonuses_company ON public.salary_bonuses(company_client_id);

CREATE TABLE IF NOT EXISTS public.salary_deductions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    period_id UUID NULL REFERENCES public.prenomina_periods(id) ON DELETE SET NULL,
    deduction_code VARCHAR(64) NOT NULL,
    concept VARCHAR(255) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salary_deductions_company ON public.salary_deductions(company_client_id);

CREATE TABLE IF NOT EXISTS public.payroll_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES public.prenomina_periods(id) ON DELETE CASCADE,
    total_workers INT NOT NULL DEFAULT 0,
    total_gross NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_bonuses NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_net NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    closed_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payroll_closure_period UNIQUE (period_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_closures_company ON public.payroll_closures(company_client_id);

CREATE TABLE IF NOT EXISTS public.prenomina_night_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES public.prenomina_periods(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    night_hours NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    rate_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.worker_payroll_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    movement_type VARCHAR(64) NOT NULL,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    previous_salary NUMERIC(12,2) NULL,
    new_salary NUMERIC(12,2) NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_payroll_mov_company ON public.worker_payroll_movements(company_client_id);

CREATE TABLE IF NOT EXISTS public.worker_salary_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    contract_id UUID NULL REFERENCES public.employment_contracts(id) ON DELETE SET NULL,
    base_salary NUMERIC(12,2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.salary_group_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    salary_group_id UUID NULL REFERENCES public.salary_groups(id) ON DELETE CASCADE,
    group_roman VARCHAR(16) NOT NULL,
    monthly_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    hourly_amount NUMERIC(10,4) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.academic_category_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    category_code VARCHAR(64) NOT NULL,
    category_name VARCHAR(128) NOT NULL,
    monthly_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.tenure_payment_scales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    min_years INT NOT NULL DEFAULT 0,
    max_years INT NULL,
    percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    fixed_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.employment_contract_compensation_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employment_contract_id UUID NOT NULL REFERENCES public.employment_contracts(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    component_type VARCHAR(64) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.employment_contract_addendum_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    addendum_id UUID NOT NULL REFERENCES public.contract_addendums(id) ON DELETE CASCADE,
    field_name VARCHAR(128) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 5. CAPACITACIÓN Y SEGURIDAD Y SALUD EN EL TRABAJO (SST AMPLIADO)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.training_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    provider VARCHAR(255) NULL,
    duration_hours NUMERIC(6,2) NOT NULL DEFAULT 8.00,
    modality VARCHAR(32) NOT NULL DEFAULT 'PRESENCIAL',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_training_courses_company ON public.training_courses(company_client_id);

CREATE TABLE IF NOT EXISTS public.worker_trainings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    completion_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    score NUMERIC(5,2) NULL,
    certificate_number VARCHAR(128) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_trainings_company ON public.worker_trainings(company_client_id);

CREATE TABLE IF NOT EXISTS public.training_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.training_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    folder_id UUID NULL REFERENCES public.training_folders(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    hours NUMERIC(6,2) NOT NULL DEFAULT 2.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.training_topic_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES public.training_topics(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.training_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    topic_id UUID NULL REFERENCES public.training_topics(id) ON DELETE SET NULL,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    instructor_name VARCHAR(255) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.training_initial_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS public.worker_training_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    session_id UUID NULL REFERENCES public.training_sessions(id) ON DELETE SET NULL,
    topic_title VARCHAR(255) NOT NULL,
    training_date DATE NOT NULL DEFAULT CURRENT_DATE,
    hours NUMERIC(6,2) NOT NULL DEFAULT 2.00,
    evaluation_result VARCHAR(64) NOT NULL DEFAULT 'APROBADO',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.ppe_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    renewal_date DATE NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ppe_deliveries_company ON public.ppe_deliveries(company_client_id);

CREATE TABLE IF NOT EXISTS public.work_accidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    accident_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    severity VARCHAR(32) NOT NULL DEFAULT 'LEVE',
    location VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    days_lost INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_accidents_company ON public.work_accidents(company_client_id);

CREATE TABLE IF NOT EXISTS public.sst_epp_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    lifespan_months INT NOT NULL DEFAULT 12,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_job_epp_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
    epp_id UUID NOT NULL REFERENCES public.sst_epp_catalog(id) ON DELETE CASCADE,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_worker_epp_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    epp_id UUID NULL REFERENCES public.sst_epp_catalog(id) ON DELETE SET NULL,
    delivered_at DATE NOT NULL DEFAULT CURRENT_DATE,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    job_id UUID NULL REFERENCES public.organization_jobs(id) ON DELETE SET NULL,
    risk_name VARCHAR(255) NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'MODERADO',
    control_measures TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_preventive_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    due_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_safe_work_procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    storage_path TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_emergency_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0',
    storage_path TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_committee_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    meeting_date DATE NOT NULL DEFAULT CURRENT_DATE,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_inspection_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES public.sst_inspections(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_job_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    job_id UUID NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_onboarding_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_training_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    hours NUMERIC(6,2) NOT NULL DEFAULT 2.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_topic_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES public.sst_training_topics(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_training_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    topic_id UUID NULL REFERENCES public.sst_training_topics(id) ON DELETE SET NULL,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    instructor_name VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_worker_training_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    session_id UUID NULL REFERENCES public.sst_training_sessions(id) ON DELETE SET NULL,
    topic_title VARCHAR(255) NULL,
    training_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_worker_health_aptitude (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    exam_date DATE NOT NULL DEFAULT CURRENT_DATE,
    aptitude_result VARCHAR(64) NOT NULL DEFAULT 'APTO',
    valid_until DATE NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 6. COMISIONES DE EVALUACIÓN, DISCIPLINA, RESOLUCIONES Y PLANES DE ENTIDAD
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.evaluation_committees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    committee_type VARCHAR(64) NOT NULL DEFAULT 'IDONEIDAD_DEMOSTRADA',
    resolution_number VARCHAR(64) NULL,
    appointed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    members JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eval_committees_company ON public.evaluation_committees(company_client_id);

CREATE TABLE IF NOT EXISTS public.disciplinary_measures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    measure_type VARCHAR(64) NOT NULL,
    resolution_number VARCHAR(64) NULL,
    imposed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    infraction_summary TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'VIGENTE',
    rehabilitation_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_disciplinary_company ON public.disciplinary_measures(company_client_id);

CREATE TABLE IF NOT EXISTS public.worker_resolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    resolution_number VARCHAR(64) NOT NULL,
    resolution_date DATE NOT NULL DEFAULT CURRENT_DATE,
    subject VARCHAR(255) NOT NULL,
    body_text TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'formalized',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_resolutions_company ON public.worker_resolutions(company_client_id);

CREATE TABLE IF NOT EXISTS public.entity_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    year INT NOT NULL,
    approved_positions INT NOT NULL DEFAULT 0,
    approved_wage_fund NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_entity_plan_year UNIQUE (organization_entity_id, year)
);

CREATE INDEX IF NOT EXISTS idx_entity_plans_company ON public.entity_plans(company_client_id);

CREATE TABLE IF NOT EXISTS public.entity_plan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_plan_id UUID NOT NULL REFERENCES public.entity_plans(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    previous_positions INT NOT NULL,
    new_positions INT NOT NULL,
    previous_wage_fund NUMERIC(14,2) NOT NULL,
    new_wage_fund NUMERIC(14,2) NOT NULL,
    reason TEXT NULL,
    changed_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_representative_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    role_code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_representative_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    representative_position_id UUID NOT NULL REFERENCES public.organization_representative_positions(id) ON DELETE CASCADE,
    worker_id UUID NULL REFERENCES public.workers(id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    resolution_number VARCHAR(64) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 7. REPORTES, LOTES DE IMPORTACIÓN/EXPORTACIÓN, WEBHOOKS Y EXPEDIENTE DE CANDIDATOS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.custom_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    module VARCHAR(64) NOT NULL DEFAULT 'workers',
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.report_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    report_id UUID NOT NULL REFERENCES public.custom_reports(id) ON DELETE CASCADE,
    cron_expression VARCHAR(64) NOT NULL DEFAULT '0 8 * * 1',
    recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    source_file_name VARCHAR(255) NOT NULL,
    total_rows INT NOT NULL DEFAULT 0,
    imported_rows INT NOT NULL DEFAULT 0,
    failed_rows INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    summary JSONB NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    export_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    storage_path TEXT NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    secret_hash VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidate_academic_formations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    institution VARCHAR(255) NOT NULL,
    degree_title VARCHAR(255) NOT NULL,
    graduation_year INT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidate_additional_info (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL UNIQUE REFERENCES public.candidates(id) ON DELETE CASCADE,
    notes TEXT NULL,
    metadata JSONB NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidate_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidate_driving_license_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    category_code VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidate_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    note_text TEXT NOT NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidate_work_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    role_title VARCHAR(255) NOT NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 8. CATÁLOGOS TRANSVERSALES Y TABLAS DE COMPATIBILIDAD
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.genders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.skin_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.education_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.marital_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.political_affiliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rehire_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.preparation_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.driving_license_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.employment_contract_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.employment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.entity_regimes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.worker_separation_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.organization_job_preparation_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
    preparation_level_id UUID NOT NULL REFERENCES public.preparation_levels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.organization_job_cla_night_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
    segment_code VARCHAR(32) NOT NULL,
    rate_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS public.position_schedule_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id UUID NOT NULL REFERENCES public.organization_positions(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL,
    start_time VARCHAR(16) NOT NULL,
    end_time VARCHAR(16) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.worker_driving_license_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.driving_license_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.platform_founder (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES sitecorp_auth.users(id) ON DELETE RESTRICT,
    designated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS public.platform_role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE,
    permission_code VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.platform_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.company_client_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.company_client_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.company_client_role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES public.company_client_roles(id) ON DELETE CASCADE,
    permission_code VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.company_client_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.company_client_roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_password_lifecycle (
    user_id UUID PRIMARY KEY REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 9. TRIGGERS DE AISLAMIENTO MULTIEMPRESA PARA LOS NUEVOS SUBMÓDULOS
-- =============================================================================

DROP TRIGGER IF EXISTS trg_cadre_reserves_cross_tenant_check ON public.cadre_reserves;
CREATE TRIGGER trg_cadre_reserves_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.cadre_reserves
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_cadre_evaluations_cross_tenant_check ON public.cadre_evaluations;
CREATE TRIGGER trg_cadre_evaluations_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.cadre_evaluations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_cadre_movements_cross_tenant_check ON public.cadre_movements;
CREATE TRIGGER trg_cadre_movements_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.cadre_movements
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_salary_bonuses_cross_tenant_check ON public.salary_bonuses;
CREATE TRIGGER trg_salary_bonuses_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.salary_bonuses
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_salary_deductions_cross_tenant_check ON public.salary_deductions;
CREATE TRIGGER trg_salary_deductions_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.salary_deductions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_worker_trainings_cross_tenant_check ON public.worker_trainings;
CREATE TRIGGER trg_worker_trainings_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.worker_trainings
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_disciplinary_measures_cross_tenant_check ON public.disciplinary_measures;
CREATE TRIGGER trg_disciplinary_measures_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.disciplinary_measures
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_ppe_deliveries_cross_tenant_check ON public.ppe_deliveries;
CREATE TRIGGER trg_ppe_deliveries_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.ppe_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_work_accidents_cross_tenant_check ON public.work_accidents;
CREATE TRIGGER trg_work_accidents_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.work_accidents
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

-- =============================================================================
-- 10. COLUMNAS DE COMPATIBILIDAD Y SEMILLAS DE CATÁLOGOS BASE (IDEMPOTENTES)
-- =============================================================================

ALTER TABLE public.organization_entities
    ADD COLUMN IF NOT EXISTS regime_id VARCHAR(64) NOT NULL DEFAULT 'EMPRESARIAL',
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS description TEXT NULL,
    ADD COLUMN IF NOT EXISTS address TEXT NULL,
    ADD COLUMN IF NOT EXISTS municipality VARCHAR(128) NULL,
    ADD COLUMN IF NOT EXISTS province VARCHAR(128) NULL,
    ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS is_sitecorp_account BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS account_is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS account_code VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS organism VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS branch VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS labor_identification_code VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS revolution_year VARCHAR(128) NULL;

ALTER TABLE public.occupational_categories
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.preparation_levels
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO public.entity_regimes (code, name)
VALUES
    ('PRESUPUESTADA', 'Unidad Presupuestada'),
    ('EMPRESARIAL', 'Sistema Empresarial')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.occupational_categories (code, name, sort_order, is_active)
VALUES
    ('CUADRO', 'Cuadro', 1, TRUE),
    ('TECNICO', 'Técnico', 2, TRUE),
    ('ADMINISTRATIVO', 'Administrativo', 3, TRUE),
    ('SERVICIO', 'Servicio', 4, TRUE),
    ('OPERARIO', 'Operario', 5, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.preparation_levels (code, name, sort_order, is_active)
VALUES
    ('SUPERIOR', 'Nivel Superior', 1, TRUE),
    ('MEDIO_SUPERIOR', 'Nivel Medio Superior', 2, TRUE),
    ('MEDIO_BASICO', 'Nivel Medio Básico', 3, TRUE),
    ('OBRERO_CALIFICADO', 'Obrero Calificado', 4, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.genders (code, name)
VALUES
    ('M', 'Masculino'),
    ('F', 'Femenino')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.marital_statuses (code, name)
VALUES
    ('SOLTERO', 'Soltero(a)'),
    ('CASADO', 'Casado(a)'),
    ('UNION_CONSENSO', 'Unión Consensual'),
    ('DIVORCIADO', 'Divorciado(a)'),
    ('VIUDO', 'Viudo(a)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.skin_colors (code, name)
VALUES
    ('BLANCA', 'Blanca'),
    ('NEGRA', 'Negra'),
    ('MESTIZA', 'Mestiza')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.education_levels (code, name)
VALUES
    ('UNIVERSITARIO', 'Universitario'),
    ('TECNICO_MEDIO', 'Técnico Medio'),
    ('PREUNIVERSITARIO', 'Preuniversitario'),
    ('SECUNDARIA_BASICA', 'Secundaria Básica')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.employment_contract_types (code, name)
VALUES
    ('INDEFINIDO', 'Contrato por Tiempo Indeterminado'),
    ('DETERMINADO', 'Contrato por Tiempo Determinado'),
    ('OBRA', 'Contrato para la Ejecución de Trabajo u Obra')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.payment_methods (code, name)
VALUES
    ('TRANSFERENCIA', 'Transferencia Bancaria'),
    ('EFECTIVO', 'Efectivo')
ON CONFLICT (code) DO NOTHING;

COMMIT;

