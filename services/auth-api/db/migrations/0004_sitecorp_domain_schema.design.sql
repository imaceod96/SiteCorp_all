-- =============================================================================
-- SITECORP DOMAIN SUBSYSTEM — POSTGRESQL DDL MIGRATION (FASE 4G.6)
-- =============================================================================
-- Migración: 0004_sitecorp_domain_schema
-- Esquema: public
-- Descripción:
--   Esquema completo de persistencia autónoma para SiteCorp Domain:
--   Empresas clientes, estructuras organizativas, perfiles, trabajadores,
--   contratos, vacantes, asignaciones, adendas, auditoría y objetos de Storage.
-- =============================================================================

BEGIN;

-- 1. Clientes / Inquilinos Multiempresa (`company_clients`)
CREATE TABLE IF NOT EXISTS public.company_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    logo_url TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_clients_code ON public.company_clients(code);

-- 2. Perfiles de Usuario (`profiles`)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(64) NOT NULL DEFAULT 'client_user',
    tenant_id UUID NULL,
    avatar_url TEXT NULL,
    phone VARCHAR(32) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles(tenant_id);

-- 3. Unidades y Entidades Organizativas (`organization_entities`)
CREATE TABLE IF NOT EXISTS public.organization_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    parent_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(64) NOT NULL DEFAULT 'EMPRESARIAL',
    code VARCHAR(64) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_entities_company ON public.organization_entities(company_client_id);
CREATE INDEX IF NOT EXISTS idx_org_entities_parent ON public.organization_entities(parent_id);

-- 4. Áreas Organizativas (`organization_areas`)
CREATE TABLE IF NOT EXISTS public.organization_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(64) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_areas_entity ON public.organization_areas(organization_entity_id);

-- 5. Categorías Ocupacionales (`occupational_categories`)
CREATE TABLE IF NOT EXISTS public.occupational_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 6. Cargos / Puestos de Trabajo (`organization_jobs`)
CREATE TABLE IF NOT EXISTS public.organization_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    occupational_category_id UUID NULL REFERENCES public.occupational_categories(id) ON DELETE SET NULL,
    code VARCHAR(64) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    work_content TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_jobs_entity ON public.organization_jobs(organization_entity_id);

-- 7. Plaza Vacante o Ocupada (`organization_positions`)
CREATE TABLE IF NOT EXISTS public.organization_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.organization_jobs(id) ON DELETE CASCADE,
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    position_order INT NOT NULL DEFAULT 1,
    authorized_quantity INT NOT NULL DEFAULT 1,
    work_location VARCHAR(255) NULL,
    daily_hours NUMERIC(4,2) NOT NULL DEFAULT 8.00,
    weekly_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
    monthly_hours NUMERIC(6,2) NOT NULL DEFAULT 160.00,
    break_minutes INT NOT NULL DEFAULT 30,
    schedule_notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_positions_job ON public.organization_positions(job_id);
CREATE INDEX IF NOT EXISTS idx_positions_entity ON public.organization_positions(organization_entity_id);

-- 8. Ficha Principal de Trabajador (`workers`)
CREATE TABLE IF NOT EXISTS public.workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    identification_number VARCHAR(11) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    second_last_name VARCHAR(128) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    photo_url TEXT NULL,
    employment_start_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_worker_company_id_num UNIQUE (company_client_id, identification_number)
);

CREATE INDEX IF NOT EXISTS idx_workers_company ON public.workers(company_client_id);
CREATE INDEX IF NOT EXISTS idx_workers_id_num ON public.workers(identification_number);

-- 9. Periodos de Empleo (`worker_employment_periods`)
CREATE TABLE IF NOT EXISTS public.worker_employment_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    hire_number VARCHAR(64) NULL,
    separation_number VARCHAR(64) NULL,
    source_origin VARCHAR(128) NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    separation_reason_id UUID NULL,
    separation_other_reason TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emp_periods_worker ON public.worker_employment_periods(worker_id);
CREATE INDEX IF NOT EXISTS idx_emp_periods_company ON public.worker_employment_periods(company_client_id);

-- 10. Asignaciones de Plaza (`worker_position_assignments`)
CREATE TABLE IF NOT EXISTS public.worker_position_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES public.organization_positions(id) ON DELETE CASCADE,
    employment_period_id UUID NULL REFERENCES public.worker_employment_periods(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_assignments_worker ON public.worker_position_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_pos_assignments_position ON public.worker_position_assignments(position_id);

-- 11. Contratos Laborales (`employment_contracts`)
CREATE TABLE IF NOT EXISTS public.employment_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    position_id UUID NULL REFERENCES public.organization_positions(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    base_salary NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    signature_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contracts_worker ON public.employment_contracts(worker_id);
CREATE INDEX IF NOT EXISTS idx_contracts_company ON public.employment_contracts(company_client_id);

-- 12. Adendas de Contrato (`contract_addendums`)
CREATE TABLE IF NOT EXISTS public.contract_addendums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employment_contract_id UUID NOT NULL REFERENCES public.employment_contracts(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    addendum_type VARCHAR(64) NOT NULL DEFAULT 'MODIFICACION',
    effective_date DATE NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'applied',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_addendums_contract ON public.contract_addendums(employment_contract_id);

-- 13. Control de Vacaciones de Trabajadores (`worker_vacations`)
CREATE TABLE IF NOT EXISTS public.worker_vacations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    position_assignment_id UUID NULL REFERENCES public.worker_position_assignments(id) ON DELETE SET NULL,
    year INT NOT NULL,
    opening_balance NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    days_accrued NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    days_taken NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    balance NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_worker_vacations_year UNIQUE (worker_id, year)
);

CREATE INDEX IF NOT EXISTS idx_vacations_worker ON public.worker_vacations(worker_id);

-- 14. Movimientos Vacacionales (`worker_vacation_movements`)
CREATE TABLE IF NOT EXISTS public.worker_vacation_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacation_id UUID NOT NULL REFERENCES public.worker_vacations(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    movement_type VARCHAR(32) NOT NULL, -- 'ACCRUAL', 'TAKEN', 'ADJUSTMENT'
    days NUMERIC(5,2) NOT NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vac_mov_vacation ON public.worker_vacation_movements(vacation_id);

-- 15. Registro de Eventos de Auditoría General (`audit_events`)
CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE SET NULL,
    user_id UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    action VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NULL,
    module VARCHAR(64) NOT NULL DEFAULT 'general',
    previous_state JSONB NULL,
    new_state JSONB NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_company ON public.audit_events(company_client_id);
CREATE INDEX IF NOT EXISTS idx_audit_module ON public.audit_events(module);

-- 16. Tabla de Metadatos de Almacenamiento Autónomo (`storage_objects`)
CREATE TABLE IF NOT EXISTS public.storage_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id VARCHAR(64) NOT NULL,
    object_name VARCHAR(255) NOT NULL,
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE SET NULL,
    user_id UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    mime_type VARCHAR(128) NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256_checksum VARCHAR(64) NOT NULL,
    storage_path TEXT NOT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_storage_bucket_object UNIQUE (bucket_id, object_name)
);

CREATE INDEX IF NOT EXISTS idx_storage_bucket ON public.storage_objects(bucket_id);
CREATE INDEX IF NOT EXISTS idx_storage_company ON public.storage_objects(company_client_id);

COMMIT;
