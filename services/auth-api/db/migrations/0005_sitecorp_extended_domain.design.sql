-- =============================================================================
-- SITECORP EXTENDED DOMAIN & MULTI-TENANT AUTHORIZATION — POSTGRESQL DDL (FASE 4G.6)
-- =============================================================================
-- Migración: 0005_sitecorp_extended_domain
-- Esquema: public
-- Descripción:
--   1. Tablas autoritativas de membresía y permisos por empresa (company_client_memberships,
--      company_client_user_permissions, entity_user_access).
--   2. Movimientos laborales (worker_employment_movements) y certificados médicos.
--   3. Nomencladores territoriales, estructuras salariales, prenómina, candidatos, SST
--      y plantillas documentales.
--   4. Funciones de contexto transaccional seguro (current_tenant_id, current_auth_user_id)
--      y triggers de integridad referencial multiempresa (prevención de referencias cruzadas
--      entre inquilinos a nivel de motor PostgreSQL).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. AUTORIZACIÓN MULTIEMPRESA PERSISTENTE (MEMBRESÍAS Y PERMISOS POR INQUILINO)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_client_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    role_code VARCHAR(64) NOT NULL DEFAULT 'company_member',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_company_client_membership UNIQUE (user_id, company_client_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_memberships_user_active
    ON public.company_client_memberships(user_id, company_client_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_cc_memberships_company
    ON public.company_client_memberships(company_client_id);

CREATE TABLE IF NOT EXISTS public.company_client_user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    permission VARCHAR(64) NOT NULL,
    granted_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ NULL,

    CONSTRAINT chk_company_client_permission_code CHECK (
        permission IN (
            'companies.view',
            'companies.manage',
            'entities.view',
            'entities.manage',
            'positions.view',
            'positions.manage',
            'workers.view',
            'workers.manage',
            'contracts.view',
            'contracts.manage',
            'vacations.view',
            'vacations.manage',
            'documents.view',
            'documents.manage',
            'audit.view'
        )
    ),
    CONSTRAINT chk_company_client_perm_no_self_grant CHECK (
        granted_by IS NULL OR granted_by <> user_id
    ),
    CONSTRAINT chk_company_client_perm_revocation CHECK (
        (is_revoked = TRUE AND revoked_at IS NOT NULL)
        OR (is_revoked = FALSE AND revoked_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_user_permissions_active
    ON public.company_client_user_permissions(user_id, company_client_id, permission)
    WHERE is_revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_cc_user_permissions_lookup
    ON public.company_client_user_permissions(user_id, company_client_id)
    WHERE is_revoked = FALSE;

CREATE TABLE IF NOT EXISTS public.entity_user_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES sitecorp_auth.users(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NOT NULL REFERENCES public.organization_entities(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_entity_user_access UNIQUE (user_id, organization_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_user_access_user
    ON public.entity_user_access(user_id, company_client_id)
    WHERE is_active = TRUE;

-- =============================================================================
-- 2. MOVIMIENTOS LABORALES Y CERTIFICADOS MÉDICOS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.worker_employment_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    movement_type VARCHAR(32) NOT NULL,
    effective_date DATE NOT NULL,
    reason TEXT NULL,
    previous_position_id UUID NULL REFERENCES public.organization_positions(id) ON DELETE SET NULL,
    new_position_id UUID NULL REFERENCES public.organization_positions(id) ON DELETE SET NULL,
    created_by UUID NULL REFERENCES sitecorp_auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_worker_movement_type CHECK (
        movement_type IN (
            'ALTA',
            'BAJA',
            'REINGRESO',
            'CAMBIO_PUESTO',
            'CAMBIO_CONTRATO',
            'MODIFICACION_SALARIAL'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_worker_movements_company
    ON public.worker_employment_movements(company_client_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_worker_movements_worker
    ON public.worker_employment_movements(worker_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS public.worker_medical_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    certificate_number VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count INT NOT NULL CHECK (days_count > 0),
    diagnosis_notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_med_certs_company
    ON public.worker_medical_certificates(company_client_id);

-- =============================================================================
-- 3. NOMENCLADORES TERRITORIALES, SALARIOS, PRENÓMINA, CANDIDATOS, SST Y PLANTILLAS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.provinces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.municipalities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    province_id UUID NOT NULL REFERENCES public.provinces(id) ON DELETE CASCADE,
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.salary_scales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT NULL
);

CREATE TABLE IF NOT EXISTS public.salary_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salary_scale_id UUID NOT NULL REFERENCES public.salary_scales(id) ON DELETE CASCADE,
    group_code VARCHAR(32) NOT NULL,
    base_salary NUMERIC(12,2) NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS public.prenomina_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    period_name VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.prenomina_worker_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES public.prenomina_periods(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    days_worked NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    hours_worked NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    net_salary NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    organization_entity_id UUID NULL REFERENCES public.organization_entities(id) ON DELETE SET NULL,
    identification_number VARCHAR(11) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(32) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidates_company
    ON public.candidates(company_client_id);

CREATE TABLE IF NOT EXISTS public.sst_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    inspection_date DATE NOT NULL,
    inspector_name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    findings_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sst_accidents_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    worker_id UUID NULL REFERENCES public.workers(id) ON DELETE SET NULL,
    event_type VARCHAR(32) NOT NULL DEFAULT 'ACCIDENT',
    event_date TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'MINOR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.document_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(64) NOT NULL UNIQUE,
    content_html TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 4. FUNCIONES DE CONTEXTO TRANSACCIONAL Y TRIGGERS DE AISLAMIENTO MULTIEMPRESA
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    raw_val TEXT;
BEGIN
    raw_val := NULLIF(btrim(current_setting('sitecorp.current_tenant_id', true)), '');
    IF raw_val IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN raw_val::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_auth_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    raw_val TEXT;
BEGIN
    raw_val := NULLIF(btrim(current_setting('sitecorp.current_user_id', true)), '');
    IF raw_val IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN raw_val::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Trigger que impide asociar trabajadores, entidades o plazas de una empresa B
-- en contratos, movimientos o vacaciones de una empresa A.
CREATE OR REPLACE FUNCTION public.enforce_cross_tenant_worker_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payload JSONB;
    v_org_entity_id UUID;
    v_pos_id UUID;
    v_worker_company_id UUID;
    v_entity_company_id UUID;
    v_position_company_id UUID;
BEGIN
    v_payload := to_jsonb(NEW);

    IF NEW.worker_id IS NOT NULL THEN
        SELECT company_client_id INTO v_worker_company_id
        FROM public.workers
        WHERE id = NEW.worker_id;

        IF v_worker_company_id IS NULL THEN
            RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: worker % does not exist', NEW.worker_id
                USING ERRCODE = '23503';
        END IF;

        IF v_worker_company_id <> NEW.company_client_id THEN
            RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: worker % belongs to another company client', NEW.worker_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    v_org_entity_id := NULLIF(v_payload->>'organization_entity_id', '')::UUID;
    IF v_org_entity_id IS NOT NULL THEN
        SELECT company_client_id INTO v_entity_company_id
        FROM public.organization_entities
        WHERE id = v_org_entity_id;

        IF v_entity_company_id IS NULL OR v_entity_company_id <> NEW.company_client_id THEN
            RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: organization_entity % does not belong to company %',
                v_org_entity_id, NEW.company_client_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    v_pos_id := NULLIF(v_payload->>'position_id', '')::UUID;
    IF v_pos_id IS NOT NULL THEN
        SELECT oe.company_client_id INTO v_position_company_id
        FROM public.organization_positions op
        INNER JOIN public.organization_entities oe ON oe.id = op.organization_entity_id
        WHERE op.id = v_pos_id;

        IF v_position_company_id IS NULL OR v_position_company_id <> NEW.company_client_id THEN
            RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: position % does not belong to company %',
                v_pos_id, NEW.company_client_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_cross_tenant_check ON public.employment_contracts;
CREATE TRIGGER trg_contracts_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.employment_contracts
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_vacations_cross_tenant_check ON public.worker_vacations;
CREATE TRIGGER trg_vacations_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.worker_vacations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_emp_periods_cross_tenant_check ON public.worker_employment_periods;
CREATE TRIGGER trg_emp_periods_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.worker_employment_periods
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

DROP TRIGGER IF EXISTS trg_emp_movements_cross_tenant_check ON public.worker_employment_movements;
CREATE TRIGGER trg_emp_movements_cross_tenant_check
    BEFORE INSERT OR UPDATE ON public.worker_employment_movements
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_cross_tenant_worker_consistency();

-- Trigger que impide jerarquías de entidades entre empresas distintas
CREATE OR REPLACE FUNCTION public.enforce_entity_parent_same_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_company_id UUID;
BEGIN
    IF NEW.parent_id IS NOT NULL THEN
        SELECT company_client_id INTO v_parent_company_id
        FROM public.organization_entities
        WHERE id = NEW.parent_id;

        IF v_parent_company_id IS NULL OR v_parent_company_id <> NEW.company_client_id THEN
            RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: parent entity % belongs to another company client', NEW.parent_id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_entities_parent_tenant_check ON public.organization_entities;
CREATE TRIGGER trg_org_entities_parent_tenant_check
    BEFORE INSERT OR UPDATE ON public.organization_entities
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_entity_parent_same_tenant();

-- Trigger que impide sobrescribir objetos de Storage pertenecientes a otra empresa
CREATE OR REPLACE FUNCTION public.enforce_storage_object_tenant_isolation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.company_client_id IS DISTINCT FROM NEW.company_client_id THEN
        RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: cannot reassign or overwrite storage object across tenants'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_storage_objects_tenant_isolation ON public.storage_objects;
CREATE TRIGGER trg_storage_objects_tenant_isolation
    BEFORE UPDATE ON public.storage_objects
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_storage_object_tenant_isolation();

COMMIT;
