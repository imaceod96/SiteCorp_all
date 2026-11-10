-- =============================================================================
-- SITECORP COMPLETE SUBMODULES — ROLLBACK DDL (FASE 4G.7)
-- =============================================================================
-- Rollback de la migración: 0006_sitecorp_complete_submodules
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_work_accidents_cross_tenant_check ON public.work_accidents;
DROP TRIGGER IF EXISTS trg_ppe_deliveries_cross_tenant_check ON public.ppe_deliveries;
DROP TRIGGER IF EXISTS trg_disciplinary_measures_cross_tenant_check ON public.disciplinary_measures;
DROP TRIGGER IF EXISTS trg_worker_trainings_cross_tenant_check ON public.worker_trainings;
DROP TRIGGER IF EXISTS trg_salary_deductions_cross_tenant_check ON public.salary_deductions;
DROP TRIGGER IF EXISTS trg_salary_bonuses_cross_tenant_check ON public.salary_bonuses;
DROP TRIGGER IF EXISTS trg_cadre_movements_cross_tenant_check ON public.cadre_movements;
DROP TRIGGER IF EXISTS trg_cadre_evaluations_cross_tenant_check ON public.cadre_evaluations;
DROP TRIGGER IF EXISTS trg_cadre_reserves_cross_tenant_check ON public.cadre_reserves;

DROP TABLE IF EXISTS public.user_sessions CASCADE;
DROP TABLE IF EXISTS public.user_password_lifecycle CASCADE;
DROP TABLE IF EXISTS public.company_client_user_roles CASCADE;
DROP TABLE IF EXISTS public.company_client_role_permissions CASCADE;
DROP TABLE IF EXISTS public.company_client_permissions CASCADE;
DROP TABLE IF EXISTS public.company_client_roles CASCADE;
DROP TABLE IF EXISTS public.platform_user_roles CASCADE;
DROP TABLE IF EXISTS public.platform_role_permissions CASCADE;
DROP TABLE IF EXISTS public.platform_permissions CASCADE;
DROP TABLE IF EXISTS public.platform_roles CASCADE;
DROP TABLE IF EXISTS public.platform_founder CASCADE;
DROP TABLE IF EXISTS public.worker_driving_license_categories CASCADE;
DROP TABLE IF EXISTS public.position_schedule_segments CASCADE;
DROP TABLE IF EXISTS public.organization_job_cla_night_segments CASCADE;
DROP TABLE IF EXISTS public.organization_job_preparation_levels CASCADE;
DROP TABLE IF EXISTS public.worker_separation_reasons CASCADE;
DROP TABLE IF EXISTS public.entity_regimes CASCADE;
DROP TABLE IF EXISTS public.employment_types CASCADE;
DROP TABLE IF EXISTS public.employment_contract_types CASCADE;
DROP TABLE IF EXISTS public.driving_license_categories CASCADE;
DROP TABLE IF EXISTS public.preparation_levels CASCADE;
DROP TABLE IF EXISTS public.rehire_statuses CASCADE;
DROP TABLE IF EXISTS public.payment_methods CASCADE;
DROP TABLE IF EXISTS public.political_affiliations CASCADE;
DROP TABLE IF EXISTS public.marital_statuses CASCADE;
DROP TABLE IF EXISTS public.education_levels CASCADE;
DROP TABLE IF EXISTS public.skin_colors CASCADE;
DROP TABLE IF EXISTS public.genders CASCADE;

DROP TABLE IF EXISTS public.candidate_work_experiences CASCADE;
DROP TABLE IF EXISTS public.candidate_notes CASCADE;
DROP TABLE IF EXISTS public.candidate_driving_license_categories CASCADE;
DROP TABLE IF EXISTS public.candidate_documents CASCADE;
DROP TABLE IF EXISTS public.candidate_additional_info CASCADE;
DROP TABLE IF EXISTS public.candidate_academic_formations CASCADE;
DROP TABLE IF EXISTS public.webhook_subscriptions CASCADE;
DROP TABLE IF EXISTS public.export_jobs CASCADE;
DROP TABLE IF EXISTS public.import_batches CASCADE;
DROP TABLE IF EXISTS public.report_schedules CASCADE;
DROP TABLE IF EXISTS public.custom_reports CASCADE;

DROP TABLE IF EXISTS public.organization_representative_assignments CASCADE;
DROP TABLE IF EXISTS public.organization_representative_positions CASCADE;
DROP TABLE IF EXISTS public.entity_plan_history CASCADE;
DROP TABLE IF EXISTS public.entity_plans CASCADE;
DROP TABLE IF EXISTS public.worker_resolutions CASCADE;
DROP TABLE IF EXISTS public.disciplinary_measures CASCADE;
DROP TABLE IF EXISTS public.evaluation_committees CASCADE;

DROP TABLE IF EXISTS public.sst_worker_health_aptitude CASCADE;
DROP TABLE IF EXISTS public.sst_worker_training_records CASCADE;
DROP TABLE IF EXISTS public.sst_training_sessions CASCADE;
DROP TABLE IF EXISTS public.sst_topic_documents CASCADE;
DROP TABLE IF EXISTS public.sst_training_topics CASCADE;
DROP TABLE IF EXISTS public.sst_onboarding_notifications CASCADE;
DROP TABLE IF EXISTS public.sst_job_folders CASCADE;
DROP TABLE IF EXISTS public.sst_inspection_findings CASCADE;
DROP TABLE IF EXISTS public.sst_committee_records CASCADE;
DROP TABLE IF EXISTS public.sst_emergency_plans CASCADE;
DROP TABLE IF EXISTS public.sst_safe_work_procedures CASCADE;
DROP TABLE IF EXISTS public.sst_preventive_actions CASCADE;
DROP TABLE IF EXISTS public.sst_risk_assessments CASCADE;
DROP TABLE IF EXISTS public.sst_worker_epp_deliveries CASCADE;
DROP TABLE IF EXISTS public.sst_job_epp_requirements CASCADE;
DROP TABLE IF EXISTS public.sst_epp_catalog CASCADE;
DROP TABLE IF EXISTS public.work_accidents CASCADE;
DROP TABLE IF EXISTS public.ppe_deliveries CASCADE;
DROP TABLE IF EXISTS public.worker_training_records CASCADE;
DROP TABLE IF EXISTS public.training_initial_notifications CASCADE;
DROP TABLE IF EXISTS public.training_sessions CASCADE;
DROP TABLE IF EXISTS public.training_topic_documents CASCADE;
DROP TABLE IF EXISTS public.training_topics CASCADE;
DROP TABLE IF EXISTS public.training_folders CASCADE;
DROP TABLE IF EXISTS public.worker_trainings CASCADE;
DROP TABLE IF EXISTS public.training_courses CASCADE;

DROP TABLE IF EXISTS public.employment_contract_addendum_changes CASCADE;
DROP TABLE IF EXISTS public.employment_contract_compensation_components CASCADE;
DROP TABLE IF EXISTS public.tenure_payment_scales CASCADE;
DROP TABLE IF EXISTS public.academic_category_payments CASCADE;
DROP TABLE IF EXISTS public.salary_group_values CASCADE;
DROP TABLE IF EXISTS public.worker_salary_history CASCADE;
DROP TABLE IF EXISTS public.worker_payroll_movements CASCADE;
DROP TABLE IF EXISTS public.prenomina_night_entries CASCADE;
DROP TABLE IF EXISTS public.payroll_closures CASCADE;
DROP TABLE IF EXISTS public.salary_deductions CASCADE;
DROP TABLE IF EXISTS public.salary_bonuses CASCADE;

DROP TABLE IF EXISTS public.user_notifications CASCADE;
DROP TABLE IF EXISTS public.notification_preferences CASCADE;
DROP TABLE IF EXISTS public.entity_invitations CASCADE;
DROP TABLE IF EXISTS public.company_client_invitations CASCADE;
DROP TABLE IF EXISTS public.client_invitations CASCADE;

DROP TABLE IF EXISTS public.platform_documents CASCADE;
DROP TABLE IF EXISTS public.platform_document_folders CASCADE;
DROP TABLE IF EXISTS public.governing_documents CASCADE;
DROP TABLE IF EXISTS public.worker_documents CASCADE;
DROP TABLE IF EXISTS public.document_batch_items CASCADE;
DROP TABLE IF EXISTS public.document_batches CASCADE;
DROP TABLE IF EXISTS public.generated_documents CASCADE;
DROP TABLE IF EXISTS public.document_generation_events CASCADE;
DROP TABLE IF EXISTS public.document_template_versions CASCADE;
DROP TABLE IF EXISTS public.template_sections CASCADE;
DROP TABLE IF EXISTS public.template_variables CASCADE;
DROP TABLE IF EXISTS public.document_variables CASCADE;
DROP TABLE IF EXISTS public.document_types CASCADE;
DROP TABLE IF EXISTS public.document_template_types CASCADE;

DROP TABLE IF EXISTS public.cadre_movements CASCADE;
DROP TABLE IF EXISTS public.cadre_evaluations CASCADE;
DROP TABLE IF EXISTS public.cadre_reserves CASCADE;

COMMIT;
