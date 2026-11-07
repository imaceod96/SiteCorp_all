-- =============================================================================
-- SITECORP EXTENDED DOMAIN SUBSYSTEM — POSTGRESQL DDL MIGRATION (FASE 4G.6)
-- =============================================================================
-- Migración: 0005_sitecorp_extended_domain
-- Esquema: public
-- Descripción:
--   Estructura PostgreSQL autónoma para catálogos salariales, prenóminas,
--   Salud y Seguridad en el Trabajo (SST), Capacitación, Candidatos,
--   Gestión Documental y Nomencladores auxiliares.
-- =============================================================================

BEGIN;

-- 1. Nomencladores Territoriales y Personales
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

-- 2. Estructuras de Salario y Prenómina
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
    status VARCHAR(32) NOT NULL DEFAULT 'draft', -- 'draft', 'closed', 'processed'
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

-- 3. Selección y Expediente de Candidatos
CREATE TABLE IF NOT EXISTS public.candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_client_id UUID NOT NULL REFERENCES public.company_clients(id) ON DELETE CASCADE,
    identification_number VARCHAR(11) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(32) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'new', -- 'new', 'evaluating', 'hired', 'rejected'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Salud y Seguridad en el Trabajo (SST)
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
    event_type VARCHAR(32) NOT NULL DEFAULT 'ACCIDENT', -- 'ACCIDENT', 'INCIDENT'
    event_date TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'MINOR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Plantillas Documentales y Lotes de Generación
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

COMMIT;
