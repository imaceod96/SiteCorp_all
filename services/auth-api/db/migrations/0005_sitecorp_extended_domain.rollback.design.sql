-- =============================================================================
-- SITECORP EXTENDED DOMAIN SUBSYSTEM — ROLLBACK MIGRATION (FASE 4G.6)
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_storage_objects_tenant_isolation ON public.storage_objects;
DROP TRIGGER IF EXISTS trg_org_entities_parent_tenant_check ON public.organization_entities;
DROP TRIGGER IF EXISTS trg_emp_movements_cross_tenant_check ON public.worker_employment_movements;
DROP TRIGGER IF EXISTS trg_emp_periods_cross_tenant_check ON public.worker_employment_periods;
DROP TRIGGER IF EXISTS trg_vacations_cross_tenant_check ON public.worker_vacations;
DROP TRIGGER IF EXISTS trg_contracts_cross_tenant_check ON public.employment_contracts;

DROP FUNCTION IF EXISTS public.enforce_storage_object_tenant_isolation() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_entity_parent_same_tenant() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_cross_tenant_worker_consistency() CASCADE;
DROP FUNCTION IF EXISTS public.current_auth_user_id() CASCADE;
DROP FUNCTION IF EXISTS public.current_tenant_id() CASCADE;

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
DROP TABLE IF EXISTS public.worker_medical_certificates CASCADE;
DROP TABLE IF EXISTS public.worker_employment_movements CASCADE;
DROP TABLE IF EXISTS public.entity_user_access CASCADE;
DROP TABLE IF EXISTS public.company_client_user_permissions CASCADE;
DROP TABLE IF EXISTS public.company_client_memberships CASCADE;

COMMIT;
