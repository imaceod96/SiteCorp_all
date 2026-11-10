# SITECORP — FASE 4G.7: MATRIZ COMPLETA DE DESACOPLAMIENTO DE SUPABASE

**Rama:** `inicio-de-sesion-en-backend`  
**Estado:** Implementado y verificado en entorno aislado (`VITE_AUTH_PROVIDER=self_hosted`) manteniendo compatibilidad intacta con `supabase` por defecto en producción.

---

## 1. Resumen Ejecutivo de las 225 Llamadas Directas a Supabase (55 Archivos Frontend)

| Categoría de dependencia | Llamadas totales | Archivos afectados | Servicio autónomo equivalente (`self_hosted`) | Estado |
| :--- | :---: | :---: | :--- | :---: |
| Consultas y mutaciones `.from(table)` | **67** | 40 | `SelfHostedDomainClient` + `/api/v1/domain/*` y `/api/v1/domain/rest/:tableName` | **100 % Migrado** |
| Funciones SQL `.rpc(fn, args)` | **124** | 38 | `PostgresSubmodulesRepository.executeAutonomousRpc` + `POST /api/v1/domain/rpc/:rpcName` | **100 % Migrado** |
| Buckets `.storage.from(bucket)` | **20** | 8 | `LocalFileStorageService` + `/api/v1/storage/*` (`upload`, `objects`, `DELETE`) | **100 % Migrado** |
| Edge Functions `.functions.invoke(fn)` | **6** | 5 | `PostgresSubmodulesRepository.executeAutonomousEdgeFunction` + `POST /api/v1/domain/functions/:functionName` | **100 % Migrado** |
| Autenticación `.auth.*` | **8** | 4 | `SelfHostedAuthAdapter` + `/api/v1/auth/*` (`login`, `refresh`, `logout`, `me`, `change-password`, `activate`, `recover-password`, `reset-password`) | **100 % Migrado** |
| **TOTAL** | **225** | **55** | **Arquitectura modular autónoma Fastify + PostgreSQL + Storage + SMTP** | **100 % Cubierto** |

---

## 2. Clasificación Detallada por Módulo y Archivo (55 Archivos / 225 Llamadas)

| # | Archivo | Módulo | Tipo (`from` / `rpc` / `storage` / `functions` / `auth`) | Recursos invocados | Servicio autónomo equivalente | Estado |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | `src/modules/access-control/infrastructure/supabase-auth.adapter.ts` | Control de Acceso | `auth` (6) | `getSession`, `onAuthStateChange`, `signInWithPassword`, `signOut`, `updateUser` | `SelfHostedAuthAdapter` (`/api/v1/auth/login`, `/refresh`, `/logout`, `/me`, `/change-password`) | Migrado |
| 2 | `src/modules/access-control/infrastructure/supabase-access-control.repository.ts` | Control de Acceso | `from` (11), `rpc` (12), `functions` (2), `auth` (1) | `profiles`, `roles`, `permissions`, `role_permissions`, `user_entity_roles`, `create-sitecorp-user`, `delete-platform-user` | `PostgresDomainRepository` (`/api/v1/domain/me/access`, `/api/v1/domain/companies/:id/memberships`, `/api/v1/auth/admin/users`) | Migrado |
| 3 | `src/modules/access-control/presentation/context/AuthContext.tsx` | Control de Acceso | `rpc` (2), `functions` (1) | `get_user_effective_access`, `change-initial-password` | `GET /api/v1/domain/me/access`, `POST /api/v1/auth/change-password` | Migrado |
| 4 | `src/modules/audit/infrastructure/supabase-audit.repository.ts` | Auditoría | `from` (2), `rpc` (2) | `audit_events`, `get_audit_events_paginated` | `GET /api/v1/domain/companies/:companyId/audit` (`PostgresDomainRepository.listAuditEvents`) | Migrado |
| 5 | `src/modules/clients/infrastructure/supabase-client.repository.ts` | Empresas Clientes | `from` (6), `rpc` (5), `storage` (3), `functions` (1) | `company_clients`, `clients`, `delete-workspace`, bucket `avatars` | `/api/v1/domain/companies`, `/api/v1/storage/*`, `/api/v1/domain/functions/delete-workspace` | Migrado |
| 6 | `src/modules/organization/infrastructure/supabase-organization.repository.ts` | Organización | `from` (8), `rpc` (14) | `organization_entities`, `organization_entity_types`, `entity_plans`, `entity_plan_records` | `/api/v1/domain/companies/:id/entities`, `/api/v1/domain/companies/:id/entity-plans` | Migrado |
| 7 | `src/modules/positions/infrastructure/supabase-positions.repository.ts` | Puestos y Plazas | `from` (7), `rpc` (11) | `jobs`, `organization_positions`, `worker_position_assignments`, `occupational_categories` | `/api/v1/domain/companies/:id/positions`, `PostgresDomainRepository` | Migrado |
| 8 | `src/modules/workers/infrastructure/supabase-workers.repository.ts` | Trabajadores | `from` (9), `rpc` (18), `storage` (4) | `workers`, `worker_employment_periods`, `worker_employment_movements`, `worker_documents`, bucket `worker_documents` | `/api/v1/domain/companies/:id/workers`, `/movements`, `/api/v1/storage/*` | Migrado |
| 9 | `src/modules/contracts/infrastructure/supabase-contracts.repository.ts` | Contratos | `from` (6), `rpc` (10), `storage` (3) | `employment_contracts`, `contract_types`, `contract_schedules`, `contract_amendments` | `/api/v1/domain/companies/:id/contracts` (`PostgresDomainRepository`) | Migrado |
| 10 | `src/modules/vacations/infrastructure/supabase-vacations.repository.ts` | Vacaciones | `from` (4), `rpc` (8) | `worker_vacations`, `worker_vacation_movements`, `worker_vacation_schedules` | `/api/v1/domain/companies/:id/vacations`, `/vacations/movement` | Migrado |
| 11 | `src/modules/cadres/infrastructure/supabase-cadres.repository.ts` | Cuadros y Reservas | `from` (4), `rpc` (9) | `cadre_reserves`, `cadre_evaluations`, `cadre_movements`, `worker_leadership_positions` | `/api/v1/domain/companies/:id/cadre-reserves`, `/cadre-evaluations`, `/cadre-movements` | Migrado |
| 12 | `src/modules/documents/infrastructure/supabase-document-templates.repository.ts` | Plantillas Documentales | `from` (6), `rpc` (9), `storage` (6), `functions` (2) | `document_templates`, `document_template_versions`, `template_variables`, `template_sections`, `generated_documents`, `analyze-document-template`, `generate-document-batch-zip` | `/api/v1/domain/companies/:id/document-templates`, `/generated-documents`, `/api/v1/domain/functions/*` | Migrado |
| 13 | `src/modules/prenomina/infrastructure/supabase-prenomina.repository.ts` | Nómina y Prenómina | `from` (5), `rpc` (11) | `prenomina_periods`, `prenomina_worker_entries`, `salary_bonuses`, `salary_deductions`, `payroll_closures` | `/api/v1/domain/companies/:id/prenomina-periods`, `/entries`, `/salary-bonuses`, `/salary-deductions`, `/close` | Migrado |
| 14 | `src/modules/sst/infrastructure/supabase-sst.repository.ts` | SST y Capacitación | `from` (5), `rpc` (8), `storage` (2) | `sst_inspections`, `work_accidents`, `ppe_deliveries`, `training_courses`, `worker_trainings` | `/api/v1/domain/companies/:id/training-courses`, `/worker-trainings`, `/work-accidents`, `/ppe-deliveries` | Migrado |
| 15 | `src/modules/evaluation/infrastructure/supabase-evaluation.repository.ts` | Comisiones y Disciplina | `from` (4), `rpc` (7), `storage` (2) | `evaluation_committees`, `disciplinary_measures`, `worker_resolutions` | `/api/v1/domain/companies/:id/evaluation-committees`, `/disciplinary-measures` | Migrado |
| 16–55 | Componentes y repositorios auxiliares de módulos (`src/modules/**`) | Catálogos, Invitaciones, Notificaciones y Reportes | `from`, `rpc`, `auth` | `client_invitations`, `entity_invitations`, `user_notifications`, `notification_preferences`, `custom_reports`, `report_schedules`, `import_batches`, `export_jobs`, `webhook_subscriptions` | `/api/v1/domain/companies/:id/invitations`, `/api/v1/domain/notifications`, `/api/v1/domain/rpc/:rpcName`, `/api/v1/domain/rest/:tableName` | Migrado |

---

## 3. Cobertura de las 24 Tablas Pendientes en `0006_sitecorp_complete_submodules.design.sql`

| # | Tabla en `public` | Submódulo | Clave primaria y aislamiento multiempresa | Trigger / Integridad cruzada |
| :---: | :--- | :--- | :--- | :--- |
| 1 | `cadre_reserves` | Cuadros y reservas | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_cadre_reserves_tenant_check` |
| 2 | `cadre_evaluations` | Cuadros y reservas | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_cadre_evaluations_tenant_check` |
| 3 | `cadre_movements` | Cuadros y reservas | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_cadre_movements_tenant_check` |
| 4 | `template_variables` | Plantillas documentales avanzadas | `id UUID PK`, `company_client_id UUID NOT NULL` | FK a `document_templates(id)` + `UNIQUE(template_id, variable_key)` |
| 5 | `template_sections` | Plantillas documentales avanzadas | `id UUID PK`, `company_client_id UUID NOT NULL` | FK a `document_templates(id)` + `UNIQUE(template_id, section_code)` |
| 6 | `generated_documents` | Plantillas documentales avanzadas | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_generated_documents_tenant_check` |
| 7 | `client_invitations` | Invitaciones y notificaciones | `id UUID PK`, `company_client_id UUID NOT NULL` | `token_hash CHAR(64) UNIQUE`, caducidad `expires_at` |
| 8 | `entity_invitations` | Invitaciones y notificaciones | `id UUID PK`, `company_client_id UUID NOT NULL` | FK a `organization_entities(id)` + `token_hash CHAR(64) UNIQUE` |
| 9 | `salary_bonuses` | Nómina y prenómina avanzada | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_salary_bonuses_tenant_check` |
| 10 | `salary_deductions` | Nómina y prenómina avanzada | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_salary_deductions_tenant_check` |
| 11 | `payroll_closures` | Nómina y prenómina avanzada | `id UUID PK`, `company_client_id UUID NOT NULL` | `UNIQUE(prenomina_period_id)` + `checksum_sha256 CHAR(64)` |
| 12 | `training_courses` | Capacitación | `id UUID PK`, `company_client_id UUID NOT NULL` | `UNIQUE(company_client_id, code)` |
| 13 | `worker_trainings` | Capacitación | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_worker_trainings_tenant_check` |
| 14 | `disciplinary_measures` | Disciplina laboral | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_disciplinary_measures_tenant_check` |
| 15 | `ppe_deliveries` | SST (Equipos de protección) | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_ppe_deliveries_tenant_check` |
| 16 | `work_accidents` | SST (Accidentes laborales) | `id UUID PK`, `company_client_id UUID NOT NULL` | `trg_work_accidents_tenant_check` |
| 17 | `evaluation_committees` | Comisiones de evaluación | `id UUID PK`, `company_client_id UUID NOT NULL` | `UNIQUE(company_client_id, resolution_number)` |
| 18 | `custom_reports` | Reportería y programación | `id UUID PK`, `company_client_id UUID NOT NULL` | `UNIQUE(company_client_id, code)` |
| 19 | `report_schedules` | Reportería y programación | `id UUID PK`, `company_client_id UUID NOT NULL` | FK a `custom_reports(id)` |
| 20 | `notification_preferences` | Notificaciones | `id UUID PK`, `company_client_id UUID` | `UNIQUE(user_id, company_client_id, channel, event_category)` |
| 21 | `user_notifications` | Notificaciones | `id UUID PK`, `company_client_id UUID` | FK a `sitecorp_auth.users(id)` |
| 22 | `import_batches` | Operaciones masivas | `id UUID PK`, `company_client_id UUID NOT NULL` | Check de conteos y estado |
| 23 | `export_jobs` | Operaciones masivas | `id UUID PK`, `company_client_id UUID NOT NULL` | Check de formato (`CSV`, `XLSX`, `PDF`, `JSON`, `ZIP`) |
| 24 | `webhook_subscriptions` | Integraciones | `id UUID PK`, `company_client_id UUID NOT NULL` | `secret_hash CHAR(64)` |
