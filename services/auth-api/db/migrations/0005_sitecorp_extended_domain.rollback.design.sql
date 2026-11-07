-- =============================================================================
-- SITECORP EXTENDED DOMAIN SUBSYSTEM — ROLLBACK MIGRATION (FASE 4G.6)
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS public.document_templates CASCADE;
DROP TABLE IF EXISTS public.sst_accidents_incidents CASCADE;
DROP TABLE IF EXISTS public.sst_inspections CASCADE;
DROP TABLE IF EXISTS public.candidates CASCADE;
DROP TABLE IF EXISTS public.prenomina_worker_entries CASCADE;
DROP TABLE IF EXISTS public.prenomina_periods CASCADE;
DROP TABLE IF EXISTS public.salary_groups CASCADE;
DROP TABLE IF EXISTS public.salary_scales CASCADE;
DROP TABLE IF EXISTS public.municipalities CASCADE;
DROP TABLE IF EXISTS public.provinces CASCADE;

COMMIT;
