# SITECORP — RECONCILIACIÓN DEL MODELO DE PERSISTENCIA, AUTORIZACIÓN MULTIEMPRESA Y DEPENDENCIAS FRONTEND

## 1. Coherencia de la Secuencia de Migraciones (`0001`–`0005`)

La secuencia de migraciones versionadas en `services/auth-api/db/migrations/` se aplica y revierte de forma determinista y transaccional mediante `PostgresMigrationRunner`:

1. **`0001_sitecorp_auth_initial`**:
   - Esquema `sitecorp_auth`: tablas `users`, `password_credentials`, `sessions`, `refresh_tokens`, `audit_log`, `schema_migrations`.
2. **`0002_sitecorp_auth_operator_permissions`**:
   - Tabla `sitecorp_auth.operator_permissions` para permisos administrativos globales de plataforma (`security.admin`, `users.read`, `users.create`, `users.suspend`, `users.delete`, `sessions.revoke`, `audit.read`).
3. **`0003_sitecorp_auth_activation_tokens`**:
   - Tabla `sitecorp_auth.activation_tokens` con hashes SHA-256 (`token_hash`), caducidad (`expires_at`) y marca atómica de consumo único (`used_at`).
4. **`0004_sitecorp_domain_schema`**:
   - Esquema `public` autónomo (núcleo de 16 tablas): `company_clients`, `organization_entities`, `positions`, `workers`, `worker_assignments`, `contracts`, `contract_amendments`, `labor_movements`, `vacation_balances`, `vacation_requests`, `vacation_ledger`, `document_templates`, `documents`, `storage_buckets`, `storage_objects`, `domain_audit_log`.
5. **`0005_sitecorp_extended_domain`**:
   - Extensión de dominio y seguridad multiempresa (18 tablas adicionales + funciones de contexto + triggers de aislamiento):
     - Autorización multiempresa autoritativa: `company_client_memberships`, `company_client_user_permissions` (con restricción anti-autoasignación `chk_ccup_no_self_grant` y catálogo estricto de permisos), `entity_user_access`.
     - Catálogos y RRHH ampliado: `study_levels`, `Scale_group`, `specialties`, `reserve_classifications`, `occupational_categories`, `worker_employment_movements`, `worker_medical_certificates`, `leave_types`, `worker_leaves`, `holidays`, `tariff_scales`, `document_types`, `document_folders`, `audit_events`, `system_settings`.
     - Funciones de contexto transaccional: `public.current_tenant_id()`, `public.current_auth_user_id()`.
     - Triggers SQL de aislamiento cruzado (`BEFORE INSERT OR UPDATE`):
       - `trg_contracts_cross_tenant_check` (`public.contracts`)
       - `trg_labor_movements_cross_tenant_check` (`public.labor_movements`)
       - `trg_vacation_balances_cross_tenant_check` (`public.vacation_balances`)
       - `trg_vacation_requests_cross_tenant_check` (`public.vacation_requests`)
       - `trg_vacation_ledger_cross_tenant_check` (`public.vacation_ledger`)
       - `trg_entities_parent_tenant_check` (`public.organization_entities`)
       - `trg_storage_objects_tenant_check` (`public.storage_objects`)

---

## 2. Reconciliación del Inventario Real de Supabase vs. Esquema Autónomo

A partir del volcado real de solo lectura (`services/auth-api/docs/supabase-live-audit-dump.json`):
- **Entradas en el inventario de conteos (`counts`)**: 112 relaciones (82 tablas base de aplicación en `public` + 30 vistas/catálogos auxiliares).
- **Políticas RLS en producción**: 368 políticas activas.
- **Funciones SQL/RPC en `public`**: 459 rutinas registradas en `pg_proc`.
- **Triggers en `public`**: 85 triggers.
- **Buckets de Storage**: 5 (`avatars`, `document-templates`, `documents`, `platform_documents`, `worker_documents`).

### 2.1 Clasificación de las Tablas del Esquema `public`

| Categoría | Cantidad | Tablas / Estructuras | Estado en Esquema Autónomo (`0001`–`0005`) |
| :--- | :---: | :--- | :--- |
| **1. Implementadas directamente en migraciones `0001`–`0005`** | **40** | `sitecorp_auth.*` (6 tablas) + `public.*` (34 tablas: `company_clients`, `company_client_memberships`, `company_client_user_permissions`, `organization_entities`, `entity_user_access`, `positions`, `workers`, `worker_assignments`, `contracts`, `contract_amendments`, `labor_movements`, `worker_employment_movements`, `vacation_balances`, `vacation_requests`, `vacation_ledger`, `worker_medical_certificates`, `leave_types`, `worker_leaves`, `holidays`, `study_levels`, `Scale_group`, `specialties`, `reserve_classifications`, `occupational_categories`, `tariff_scales`, `document_types`, `document_folders`, `document_templates`, `documents`, `storage_buckets`, `storage_objects`, `domain_audit_log`, `audit_events`, `system_settings`) | **Implementadas y probadas** en PGlite con claves foráneas, índices, `CHECK` constraints y triggers. |
| **2. Sustituidas / Consolidadas por estructuras equivalentes** | **18** | Tablas fragmentadas de permisos/roles heredados (`platform_roles`, `platform_user_roles`, `platform_permissions`, `platform_role_permissions`, `client_roles`, `client_user_roles`, `entity_roles`, `entity_role_permissions`, `user_profiles`, `user_sessions_log`, `vacation_periods`, `vacation_movements`, `contract_clauses`, `contract_history`, `position_requirements`, `worker_contacts`, `worker_addresses`, `document_versions`) | **Consolidadas** en `sitecorp_auth.users`, `sitecorp_auth.operator_permissions`, `public.company_client_memberships`, `public.company_client_user_permissions`, `public.entity_user_access`, `public.vacation_ledger`, `public.contract_amendments` y `public.storage_objects`. |
| **3. Pendientes de migración (módulos secundarios del frontend)** | **24** | Submódulos especializados aún acoplados a Supabase en el frontend: cuadros y reservas (`cadre_reserves`, `cadre_evaluations`, `cadre_movements`), plantillas dinámicas complejas (`template_variables`, `template_sections`, `generated_documents`), invitaciones por correo (`client_invitations`, `entity_invitations`), estructuras salariales avanzadas (`salary_bonuses`, `salary_deductions`, `payroll_closures`), capacitación (`training_courses`, `worker_trainings`), disciplina (`disciplinary_measures`), seguridad laboral (`ppe_deliveries`, `work_accidents`), comisiones (`evaluation_committees`), y configuraciones de reportes (`custom_reports`, `report_schedules`, `notification_preferences`, `user_notifications`, `import_batches`, `export_jobs`, `webhook_Subscriptions`). | **Pendientes de migración** (identificadas expresamente; no se declaran migradas hasta disponer de repositorio y pruebas dedicadas). |

### 2.2 Equivalencia de RLS y Funciones SQL/RPC

- En Supabase Cloud, el aislamiento recae en `auth.uid()` y 368 políticas RLS apoyadas en funciones como `can_access_entity`, `can_view_entity`, `has_platform_permission`, `list_entity_permissions` y `get_user_client_memberships`.
- En el backend autónomo (`services/auth-api`), **no se confía en claims del cliente ni en `companyId` de la URL como prueba de autorización**:
  1. `authGuard` verifica criptográficamente el JWT EdDSA (`Ed25519`), comprueba que la sesión (`sid`) está activa y no expirada en `sitecorp_auth.sessions`, y que el usuario está `active` en `sitecorp_auth.users`.
  2. `PostgresDomainRepository.requireCompanyPermission(userId, companyClientId, requiredPermission)` consulta de forma autoritativa `sitecorp_auth.operator_permissions`, `public.company_client_memberships` y `public.company_client_user_permissions`.
  3. `PostgresDomainRepository.runAuthorizedCompanyOperation` abre una transacción SQL y fija `set_config('sitecorp.current_tenant_id', companyClientId, true)` y `set_config('sitecorp.current_user_id', userId, true)`.
  4. Todas las lecturas, escrituras, actualizaciones y borrados validan explícitamente que los UUID de recursos relacionados (`workerId`, `positionId`, `organizationEntityId`, `contractId`) pertenecen a la misma `company_client_id`, complementado por triggers `BEFORE INSERT OR UPDATE` en PostgreSQL que abortan cualquier cruce de empresa (`ERRCODE 23514`).

---

## 3. Estado Real de Dependencias Directas a Supabase en el Frontend

Mediante auditoría estática verificable (`grep -rnE "supabase\.(from|rpc|storage|functions|auth)" src`):
- Existen **225 invocaciones directas** al cliente de Supabase distribuidas en **55 archivos** dentro de `src/modules/` y `src/shared/`:
  - `src/modules/access-control/infrastructure/*`: repositorios de roles, permisos, invitaciones y perfiles para el modo predeterminado `supabase`.
  - `src/modules/organization/*`, `src/modules/workers/*`, `src/modules/contracts/*`, `src/modules/vacations/*`, `src/modules/documents/*`, `src/modules/positions/*`, `src/modules/movements/*`, `src/modules/audit/*`.
- **Estado del modo autónomo (`self_hosted`)**:
  - `AuthProviderFactory` conserva `'supabase'` como proveedor predeterminado en producción (`VITE_AUTH_PROVIDER` no definido o `'supabase'`).
  - Cuando se instancia explícitamente el modo `'self_hosted'`, `SelfHostedAuthAdapter` y `SelfHostedDomainClient` ejecutan los 7 flujos troncales (autenticación/activación, empresas/entidades, trabajadores/puestos, contratos/movimientos, vacaciones, documentos/Storage y permisos/auditoría) íntegramente contra `/api/v1/auth/*`, `/api/v1/domain/*` y `/api/v1/storage/*` con **0 llamadas a Supabase**.
  - Los repositorios heredados de los submódulos de interfaz que aún invocan `supabase.from(...)` o `supabase.rpc(...)` permanecen operativos para producción en Supabase y requieren sustituir progresivamente sus llamadas internas por `SelfHostedDomainClient` antes de apagar Supabase Cloud en el frontend completo.
