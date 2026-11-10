-- =============================================================================
-- SITECORP DOMAIN SUBSYSTEM — POSTGRESQL DDL ROLLBACK (FASE 4G.6)
-- =============================================================================
-- Rollback: 0004_sitecorp_domain_schema
-- Esquema: public
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS public.storage_objects CASCADE;
DROP TABLE IF EXISTS public.audit_events CASCADE;
DROP TABLE IF EXISTS public.worker_vacation_movements CASCADE;
DROP TABLE IF EXISTS public.worker_vacations CASCADE;
DROP TABLE IF EXISTS public.contract_addendums CASCADE;
DROP TABLE IF EXISTS public.employment_contracts CASCADE;
DROP TABLE IF EXISTS public.worker_position_assignments CASCADE;
DROP TABLE IF EXISTS public.worker_employment_periods CASCADE;
DROP TABLE IF EXISTS public.workers CASCADE;
DROP TABLE IF EXISTS public.organization_positions CASCADE;
DROP TABLE IF EXISTS public.organization_jobs CASCADE;
DROP TABLE IF EXISTS public.occupational_categories CASCADE;
DROP TABLE IF EXISTS public.organization_areas CASCADE;
DROP TABLE IF EXISTS public.organization_entities CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.company_clients CASCADE;

COMMIT;
