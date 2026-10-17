# 01 — Inventario de Hardcoding (SiteCorp)

> **Bloque 35 — Auditoría integral de hardcoding y plan de normalización hacia Supabase.**
> Documento de SOLO LECTURA del código y de la base de datos. No se ha modificado código,
> esquema, RLS, RPC, migraciones ni datos.
>
> Método: lectura directa de los archivos reales de `src/` + observación en modo lectura del
> esquema activo de Supabase (76 tablas + funciones RPC). Cada hallazgo cita archivo y línea.

---

## 0. Cómo leer este inventario

Campos exigidos por el bloque (Sección 5): ID · Módulo · Archivo · Ruta · Líneas · Símbolo ·
Valor hardcodeado · Uso actual · Categoría · Justificación · Nº consumidores · Impacto ·
Riesgo · Recomendación · Tabla existente · Tabla nueva propuesta · Prioridad · Complejidad ·
Dependencias · Confianza.

En la **Parte A** se detallan los hallazgos con prioridad **P0/P1** (los 20 campos). En la
**Parte B** se consolidan el resto en una tabla donde las columnas agrupan esos campos:

- `Archivo:Líneas` → Archivo + Ruta + Líneas
- `Valor` → Valor hardcodeado
- `Notas` → Uso actual + Justificación + Recomendación
- `Cons.` → Nº de consumidores · `Imp.` Impacto · `Ries.` Riesgo · `Comp.` Complejidad
- `T.Exist.` → Tabla existente relacionada · `T.Nueva` → Tabla nueva propuesta
- `Dep.` → Dependencias · `Conf.` → Confianza de la conclusión

**Categorías** (Sección 4): **A** migrar a tabla · **B** configuración en BD · **C** mantener
en código · **D** internacionalización · **E** eliminar/consolidar · **F** requiere investigación.

**Aclaración clave**: muchas listas que parecen catálogos **ya provienen de la base de datos**
(`fetchOccupationalCategories`, `fetchPreparationLevels`, `fetchSkinColors`,
`fetchDrivingLicenseCategories`, `fetchPersonCatalogs`). NO son hardcoding y NO se listan.

---

## PARTE A — Hallazgos P0/P1 (detalle de 20 campos)

### HC-001 — Régimen de entidad (Presupuestada / Empresarial)
1. **ID**: HC-001 · 2. **Módulo**: Estructura organizativa
3. **Archivo**: `organization-entities.rules.ts` · 4. **Ruta**: `src/modules/organization-structure/domain/organization-entities.rules.ts` · 5. **Líneas**: 97–100
6. **Símbolo**: `REGIME_OPTIONS` · 7. **Valor**: `[{value:"PRESUPUESTADA",label:"Presupuestada"},{value:"EMPRESARIAL",label:"Empresarial"}]`
8. **Uso actual**: selector de régimen del diálogo de entidad; determina escala salarial aplicable.
9. **Categoría**: **A/E** · 10. **Justificación**: la tabla `entity_regimes` YA existe en el esquema activo y el régimen se compara por código canónico en RPC (`resolve_salary_scale_for_entity`, `resolve_academic_payment_scope`); el código duplica el catálogo.
11. **Nº consumidores**: 1 formulario + reglas de dominio.
12. **Impacto**: medio · 13. **Riesgo**: bajo-medio (divergencia catálogo BD↔UI)
14. **Recomendación**: leer opciones desde `entity_regimes`.
15. **Tabla existente**: `entity_regimes` · 16. **Tabla nueva**: ninguna
17. **Prioridad**: P1 · 18. **Complejidad**: baja
19. **Dependencias**: repositorio de catálogos de estructura organizativa · 20. **Confianza**: alta

### HC-011 — Niveles educacionales que exigen especialidad
1. **ID**: HC-011 · 2. **Módulo**: Personas
3. **Archivo**: `rules.ts` · 4. **Ruta**: `src/modules/people/domain/rules.ts` · 5. **Líneas**: 59
6. **Símbolo**: `SPECIALTY_EDUCATION_LEVELS` · 7. **Valor**: `["Obrero Calificado","Técnico Medio","Superior"]`
8. **Uso actual**: `candidateRequiresSpecialty` decide si la especialidad es obligatoria, comparando por **nombre** del nivel educativo.
9. **Categoría**: **B/A** · 10. **Justificación**: la regla depende del texto visible del catálogo `education_levels`; si el catálogo cambia de nombre (o de idioma), la regla se rompe silenciosamente. Debería apoyarse en un código estable o en un flag del catálogo.
11. **Nº consumidores**: validación de alta de candidato y trabajador.
12. **Impacto**: medio-alto (integridad de datos personales para contratar).
13. **Riesgo**: medio (acoplamiento a texto de catálogo persistente).
14. **Recomendación**: mover la condición a `education_levels` (código/flag `requires_specialty`).
15. **Tabla existente**: `education_levels` · 16. **Tabla nueva**: ninguna (columna/flag en la existente)
17. **Prioridad**: P1 · 18. **Complejidad**: media
19. **Dependencias**: `catalogs.rules`, formularios de candidato/trabajador · 20. **Confianza**: alta

### HC-020 — Tipos de concepto retributivo
1. **ID**: HC-020 · 2. **Módulo**: Contratos
3. **Archivo**: `compensation.rules.ts` · 4. **Ruta**: `src/modules/contracts/domain/compensation.rules.ts` · 5. **Líneas**: 30–44
6. **Símbolo**: `COMPENSATION_COMPONENT_TYPES` · 7. **Valor**: `ADDITIONAL_PAYMENT | ABNORMAL_CONDITIONS | OTHER` + labels + hints
8. **Uso actual**: opciones del formulario de conceptos; los mismos tres códigos se validan en RPC (`apply_contract_conditions`, `create_contract_addendum`: `IF v_type NOT IN ('ADDITIONAL_PAYMENT','ABNORMAL_CONDITIONS','OTHER')`).
9. **Categoría**: **A/B** · 10. **Justificación**: el vocabulario es un catálogo cerrado de negocio duplicado en frontend y backend; podría vivir en tabla (código + etiqueta + orden) y ser la única fuente.
11. **Nº consumidores**: formularios de contrato, revisión salarial, resúmenes.
12. **Impacto**: medio · 13. **Riesgo**: bajo-medio
14. **Recomendación**: catálogo `compensation_component_types` (global) y leerlo en la UI.
15. **Tabla existente**: `employment_contract_compensation_components` (usa el código) · 16. **Tabla nueva**: `compensation_component_types`
17. **Prioridad**: P1 · 18. **Complejidad**: media
19. **Dependencias**: `compensation.rules`, `ContractConditionsFields.tsx` · 20. **Confianza**: alta

### HC-021 — Horizonte y estados de alertas de vencimiento
1. **ID**: HC-021 · 2. **Módulo**: Contratos
3. **Archivo**: `contract-alerts.rules.ts` · 4. **Ruta**: `src/modules/contracts/domain/contract-alerts.rules.ts` · 5. **Líneas**: 24, 29, 33, 55–83, 88–94
6. **Símbolo**: `CONTRACT_ALERT_HORIZON_DAYS` (30), `CONTRACT_ALERT_LOOKAHEAD_DAYS` (3650), `CONTRACT_ALERT_META`, `CONTRACT_ALERT_FILTER_OPTIONS`, `ATTENTION_STATES`
7. **Valor**: horizonte 30 días; tramos 7/15/30; estados `OVERDUE/DUE_TODAY/DUE_IN_7/DUE_IN_15/DUE_IN_30/DUE_AFTER_30/NO_END_DATE`
8. **Uso actual**: alertas de vencimiento contractual (badge de sidebar, KPI, tabla, WorkerDetail).
9. **Categoría**: **B/D** · 10. **Justificación**: los umbrales 7/15/30 y el horizonte 30 están DUPLICADOS en la RPC `contract_expiry_alerts` (`horizon_days integer DEFAULT 30` y `CASE ... CURRENT_DATE + 7/15/30`); es un parámetro de negocio que debería tener una única fuente configurable. Las etiquetas son i18n.
11. **Nº consumidores**: ≥ 4 (módulo Vencimientos, Resumen, WorkerDetail, sidebar).
12. **Impacto**: medio · 13. **Riesgo**: medio (divergencia frontend/BD en umbrales)
14. **Recomendación**: extraer umbrales a configuración (tabla de parámetros) y que UI y RPC la lean.
15. **Tabla existente**: ninguna de parámetros · 16. **Tabla nueva**: `contract_alert_settings` (o parámetros por entidad)
17. **Prioridad**: P1 · 18. **Complejidad**: media
19. **Dependencias**: `contract_expiry_alerts` (RPC), `EntityContractAlerts.tsx` · 20. **Confianza**: alta

### HC-026 — Catálogo de variables documentales
1. **ID**: HC-026 · 2. **Módulo**: Generación/Plantillas documentales
3. **Archivo**: `document-variables.ts` · 4. **Ruta**: `src/modules/document-templates/domain/document-variables.ts` · 5. **Líneas**: 86–350 (catálogo completo)
6. **Símbolo**: `DOCUMENT_VARIABLES` · 7. **Valor**: array de ~150 definiciones `{key,label,category,documentTypes,dataType,kind,description}`
8. **Uso actual**: selector de variables de plantilla y resolución de datos documentales.
9. **Categoría**: **E/A** · 10. **Justificación**: **existe la tabla `document_variables`** en el esquema activo y la RPC `save_document_template_analysis` YA la consulta (`LEFT JOIN public.document_variables d ON d.key = o.occ->>'key'`). El catálogo del código es una segunda fuente de verdad del mismo concepto (duplicación real, no hipotética).
11. **Nº consumidores**: paneles de variables, generación documental, validación de análisis.
12. **Impacto**: alto (si divergen, la validación backend y el selector UI no coinciden).
13. **Riesgo**: alto (duplicación de un registro central).
14. **Recomendación**: consolidar en `document_variables`; el frontend lee de BD (o se sincroniza desde un único origen).
15. **Tabla existente**: `document_variables` · 16. **Tabla nueva**: ninguna
17. **Prioridad**: P1 · 18. **Complejidad**: alta
19. **Dependencias**: `document-resolution.rules`, `DocumentTemplateVariablesPanel.tsx`, RPC de análisis · 20. **Confianza**: alta

### HC-031 — Divisor de horas y tarifas de nocturnidad (Prenómina)
1. **ID**: HC-031 · 2. **Módulo**: Prenómina
3. **Archivo**: `rules.ts` · 4. **Ruta**: `src/modules/payroll-preparation/domain/rules.ts` · 5. **Líneas**: 19, 22, 25
6. **Símbolo**: `MONTHLY_SALARY_HOURS_DIVISOR` (190.6), `NIGHT_RATE_19_23` (0.6), `NIGHT_RATE_23_07` (1.15)
7. **Valor**: 190.6 ; 0.6 ; 1.15
8. **Uso actual**: previsualización en la UI y export de la prenómina.
9. **Categoría**: **B** · 10. **Justificación**: los TRES valores están DUPLICADOS literalmente dentro de funciones SQL del esquema activo: `prenomina_monthly_hours_divisor() = 190.6`, `prenomina_night_rate_19_23() = 0.60`, `prenomina_night_rate_23_07() = 1.15`. Son parámetros de negocio (tarifas/divisor) que deben ser configurables y de fuente única.
11. **Nº consumidores**: UI de prenómina + export; BD (cálculo definitivo).
12. **Impacto**: alto (afecta importes salariales).
13. **Riesgo**: alto (si se cambia una tarifa en un solo lado, UI y BD discrepan).
14. **Recomendación**: parametrizar en BD (tabla de tarifas/divisor) y consumir desde UI y RPC.
15. **Tabla existente**: ninguna de parámetros · 16. **Tabla nueva**: `prenomina_parameters` (global/por entidad)
17. **Prioridad**: P1 · 18. **Complejidad**: media
19. **Dependencias**: RPC `prenomina_recalc_entry`, `prenomina_save_night` · 20. **Confianza**: alta

### HC-035 — Tramos de edad de los informes
1. **ID**: HC-035 · 2. **Módulo**: Resumen de entidad
3. **Archivo**: `rules.ts` · 4. **Ruta**: `src/modules/entity-summary/domain/rules.ts` · 5. **Líneas**: 11–19 y 47–55
6. **Símbolo**: `AGE_BUCKETS`, `ageBucketKey` · 7. **Valor**: cortes 20/30/40/50/60
8. **Uso actual**: informes demográficos por edad.
9. **Categoría**: **B/E** · 10. **Justificación**: los mismos cortes están DUPLICADOS en la RPC `report_worker_demographics` (`< 20`, `< 30`, … `60 o más`). Parametrizable.
11. **Nº consumidores**: informes de resumen.
12. **Impacto**: medio · 13. **Riesgo**: medio (divergencia UI↔BD)
14. **Recomendación**: unificar umbrales en configuración; UI y RPC comparten fuente.
15. **Tabla existente**: ninguna · 16. **Tabla nueva**: `report_age_buckets` (o parámetros de informes)
17. **Prioridad**: P1 · 18. **Complejidad**: baja-media
19. **Dependencias**: RPC `report_worker_demographics`, `distribution.ts` · 20. **Confianza**: alta

### HC-037 — Patrón de permisos legacy
1. **ID**: HC-037 · 2. **Módulo**: Control de acceso
3. **Archivo**: `permissions.catalog.ts` · 4. **Ruta**: `src/modules/access-control/domain/permissions.catalog.ts` · 5. **Líneas**: 37
6. **Símbolo**: `LEGACY_PERMISSION_PATTERN` · 7. **Valor**: `/(^areas\.|^jobs\.|^tenant_roles\.|_global$|_empresarial$)/`
8. **Uso actual**: excluir códigos legacy del catálogo ofrecible de roles internos.
9. **Categoría**: **E/C** · 10. **Justificación**: el MISMO patrón está incrustado en varias RPC (`ensure_entity_administrator_role`, `grant_company_client_permission_to_system_roles`, `list_entity_permissions`, `save_entity_role`: `tp.code !~ '(^areas\.|^jobs\.|^tenant_roles\.|_global$|_empresarial$)'`). Duplicación de una regla de negocio en 5+ sitios.
11. **Nº consumidores**: catálogo UI + ≥4 RPC.
12. **Impacto**: medio · 13. **Riesgo**: medio (regla dispersa)
14. **Recomendación**: `is_internal_scope` como columna del catálogo de permisos; eliminar el patrón repetido.
15. **Tabla existente**: `company_client_permissions` · 16. **Tabla nueva**: ninguna (columna flag)
17. **Prioridad**: P1 · 18. **Complejidad**: media
19. **Dependencias**: RPC de roles/permisos · 20. **Confianza**: alta

### HC-039 — Límite de tamaño de documento (10 MB)
1. **ID**: HC-039 · 2. **Módulo**: Compartido / lib
3. **Archivo**: `documents.ts` y otros 5 sitios · 4. **Ruta**: `src/lib/documents.ts` (y see Valor) · 5. **Líneas**: `documents.ts:4`
6. **Símbolo**: `MAX_DOCUMENT_SIZE_BYTES`
7. **Valor**: `10 * 1024 * 1024`; también literal `10485760` en `document-templates/domain/entities.ts:38`, `10 * 1024 * 1024` en `medical-certificates/domain/rules.ts:23`, `MedicalCertificateFormDialog.tsx:39`, `worker-migration.workbook.ts:136`, `ExcelImportDialog.tsx:77`
8. **Uso actual**: validación de archivos subidos en varios módulos.
9. **Categoría**: **E/B** · 10. **Justificación**: el mismo límite está definido 5+ veces y TAMBIÉN en la RPC `set_document_template_version_file` (`p_file_size > 10485760`). Es un parámetro de negocio con múltiples fuentes.
11. **Nº consumidores**: 5+.
12. **Impacto**: medio · 13. **Riesgo**: medio (inconsistencia si se ajusta en un solo sitio)
14. **Recomendación**: constante única compartida + parámetro en BD si debe ser configurable.
15. **Tabla existente**: ninguna · 16. **Tabla nueva**: `document_settings` (si configurable)
17. **Prioridad**: P1 · 18. **Complejidad**: baja
19. **Dependencias**: módulos que suben archivos · 20. **Confianza**: alta

### HC-042 — Provincias y municipios de Cuba
1. **ID**: HC-042 · 2. **Módulo**: Compartido / datos
3. **Archivo**: `cuba-locations.ts`, `cuba-locations-full.ts` · 4. **Ruta**: `src/data/` · 5. **Líneas**: `cuba-locations.ts:2-34`
6. **Símbolo**: `CUBA_PROVINCES`, `MUNICIPIOS_BY_PROVINCE` (+ `CUBA_PROVINCES_FULL`)
7. **Valor**: listas estáticas de provincias y municipios
8. **Uso actual**: selectores de provincia/municipio en formularios de persona.
9. **Categoría**: **E/A** · 10. **Justificación**: **existen las tablas `provinces` y `municipalities`** en el esquema activo. El código mantiene una copia fija. Además, `workers.province`/`municipality` guardan TEXTO libre (no FK), por lo que el catálogo y el dato no están cohesionados.
11. **Nº consumidores**: varios formularios (candidato, trabajador, entidad).
12. **Impacto**: medio · 13. **Riesgo**: medio (datos descriptivos inconsistentes)
14. **Recomendación**: consumir `provinces`/`municipalities` desde BD; evaluar FK en `workers`.
15. **Tabla existente**: `provinces`, `municipalities` · 16. **Tabla nueva**: ninguna
17. **Prioridad**: P1 · 18. **Complejidad**: media-alta (toca datos personales existentes)
19. **Dependencias**: formularios de persona, `cuba-locations-full` · 20. **Confianza**: alta

### HC-048 — Datos de prueba aplicados a la base conectada
1. **ID**: HC-048 · 2. **Módulo**: Configuración Supabase / Datos
3. **Archivo**: `20260922_02_entity_access_test_data.sql`, `20260922_04_roles_permissions_test_data.sql`
4. **Ruta**: `src/db/migrations/` · 5. **Líneas**: todo el archivo
6. **Símbolo**: scripts de test data · 7. **Valor**: `TENANT-A`, códigos `GRUPO-A/EMPRESA-A/UEB-A1/UEB-A2`, roles 'Viewer'/'HR Manager'/'RRHH Test'/'Platform Test', usuarios `admin`/`isael`
8. **Uso actual**: registros de prueba creados en la base conectada (el propio encabezado indica que se aplicaron por el SQL console).
9. **Categoría**: **E** · 10. **Justificación**: son datos simulados que conviven con datos reales en la base; incluyen usuarios y roles de prueba. Riesgo de confusión operativa y de permisos de prueba en producción.
11. **Nº consumidores**: n/a (datos, no código).
12. **Impacto**: alto · 13. **Riesgo**: alto (roles/usuarios de prueba activos)
14. **Recomendación**: requerir investigación sobre si deben retirarse de la base conectada (ver categoría F de existencia en producción).
15. **Tabla existente**: `platform_roles`, `tenant_roles`, `organization_entities`, `entity_user_access` · 16. **Tabla nueva**: ninguna
17. **Prioridad**: **P1** (reclasificado en el Bloque 35.1 — ver Documento 06; antes figuró como P0 “posible”). · 18. **Complejidad**: alta (depende de datos reales)
19. **Dependencias**: datos productivos reales · 20. **Confianza**: **alta** (Bloque 35.1 verificó en modo solo lectura que persisten `TENANT-A`, entidades de prueba y roles de prueba, y que existe una cuenta `admin` **activa con rol `SuperAdmin`**). No hay bypass de autenticación/RLS; el acceso exige credenciales. `isael` ya no existe; `Platform Test` ya no existe.

---

## PARTE B — Resto de hallazgos (tabla consolidada)

| ID | Módulo | Archivo:Líneas | Símbolo | Valor | Cat. | Notas (uso/justificación/recomendación) | Cons. | Imp. | Ries. | T.Exist. | T.Nueva | Prio | Comp. | Dep. | Conf. |
|----|--------|----------------|---------|-------|------|----------------------------------------|-------|------|-------|----------|---------|------|-------|------|-------|
| HC-002 | Org. | organization-entities.rules.ts:21-25 | ENTITY_TYPE_OPTIONS | business_group/company/ueb | C/F | enum estructural reforzado por trigger; mantener | 2 | Bajo | Bajo | organization_entities | — | P3 | Baja | trigger | Alta |
| HC-003 | Org. | organization-entities.rules.ts:103-122 | CODE_PREFIXES/generateEntityCode | GE/EMP/UEB+base36 | C | identificador técnico; mantener | 1 | Bajo | Bajo | organization_entities.code | — | P3 | Baja | account.rules | Alta |
| HC-004 | Org. | rules.ts:18-26 | WEEK_DAYS | 1..7 + etiquetas | C/D | entero ISO contrato; etiquetas i18n | varios | Bajo | Bajo | position_schedule_segments | — | P3 | Baja | formatters | Alta |
| HC-005 | Org. | rules.ts:43-73 | ANEXO_14_HEADERS/ANEXO14_HEADERS | cabeceras export | D/F | modelo oficial; validar antes de externar | 2 | Medio | Bajo | document_templates | — | P3 | Baja | exportadores | Media |
| HC-006 | Org. | rules.ts:9-46 / catalogs.repository.ts:34,55 | NO_*_LABEL, NOT_CONFIGURED_VALUE | textos UI | D/E | duplicados entre 2 archivos; consolidar | varios | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-007 | Org. | entity-modules.catalog.ts:31,147 | ENTITY_INTERNAL_MODULES/ENTITY_NAV | keys/labels/paths/permissions | C/F | navegación estructural; permisos deben sincronizar con BD | varios | Medio | Medio | company_client_permissions | — | P2 | Media | sidebar/layouts | Alta |
| HC-008 | Org. | organization-entities.rules.ts:102-105 | STATUS_OPTIONS | active/inactive | C | enum técnico; mantener | 1 | Bajo | Bajo | organization_entities.status | — | P3 | Baja | — | Alta |
| HC-009 | Org. | organization-entities.rules.ts:191-231 | describeEntityError | mapa de códigos PostgREST | C | mapeo técnico de errores; mantener | 1 | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-010 | Org. | account.rules.ts | buildAccountCode/AVATAR_ALLOWED_MIME_TYPES | prefijo + mime | C | técnico; mantener | 1 | Bajo | Bajo | — | — | P3 | Baja | — | Media |
| HC-012 | Personas | entities.ts:20-23 | EMPLOYMENT_STATUS | active/inactive | C | espejo de estado BD; mantener | varios | Bajo | Bajo | workers.employment_status | — | P3 | Baja | — | Alta |
| HC-013 | Personas | rules.ts:392-476 | TRANSITION_EFFECTS/TRANSITION_MOVEMENT_DOCUMENT | mapeo transiciones→vista | C | lógica de negocio estructural; mantener | varios | Medio | Bajo | — | — | P3 | Media | — | Alta |
| HC-014 | Personas | rules.ts:392-414 | READINESS_SECTION_LABELS/ORDER | secciones y orden | F/D | duplica el orden de `validate_hiring_readiness` (VALUES ('Entidad',1)…); investigar unificación | varios | Medio | Medio | — | — | P2 | Media | RPC readiness | Media |
| HC-015 | Personas | rules.ts (varias) | MISSING_*_MESSAGE y validaciones | mensajes UI | D | textos de interfaz; i18n | varios | Bajo | Bajo | — | — | P3 | Baja | formularios | Alta |
| HC-016 | Personas | worker-migration.rules.ts:20-24 | MIGRATION_IDENTIFICATION_PATTERN/VACATION_BALANCE_MIN-MAX | 11 dígitos / 0..24 | B/C | duplica `enforce_identification_format` y límites 0..24 de vacaciones; unificar | 2+ | Medio | Medio | workers | — | P2 | Baja | RPC migración | Alta |
| HC-017 | Personas | worker-migration.rules.ts:30-38,160 | INCOMPLETE_FIELD_LABELS/MIGRATION_HISTORY_LIMIT | labels + 20 | D/C | etiquetas i18n; límite técnico | 2 | Bajo | Bajo | — | — | P3 | Baja | migración | Alta |
| HC-018 | Personas | catalogs.rules.ts:12 | drivingLicenseLabels | etiqueta por catálogo | C | mapeo técnico; mantener | 1 | Bajo | Bajo | driving_license_categories | — | P3 | Baja | — | Alta |
| HC-022 | Contratos | rules.ts:12 | PENDING_ADDENDUM_STATUSES | 3 estados | F | espejo de estados BD de anexos; investigar unificación | 2 | Medio | Medio | contract_addendums.status | — | P2 | Baja | RPC anexos | Media |
| HC-023 | Contratos | addendum-labels.ts:18-100 | ADDENDUM_STATUS_LABELS/BADGE/REASON/FIELD | etiquetas | D/F | i18n; códigos de estado/motivo deben sincronizar con BD | varios | Medio | Bajo | contract_addendums | — | P2 | Media | UI anexos | Alta |
| HC-024 | Contratos | addendum-labels.ts:51-57 | MANUAL_ADDENDUM_REASON_CODES | 5 motivos | A/F | catálogo de motivos; validado en `create_contract_addendum`; considerar tabla | 1 | Medio | Bajo | contract_addendums.reason_code | addendum_reason_codes | P2 | Media | RPC anexos | Media |
| HC-025 | Contratos | formats.ts, contract-alerts.rules.ts:253 | formatContractDate/formatAmount reexport | formateo | C | utilidad técnica; mantener | varios | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-027 | Doc-gen | document-variables.ts:370-500 | MONTHS_ES + formatters | nombres de mes + formatos | C/D | i18n + utilidad; mantener/consolidar | varios | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-029 | Plantillas | document-templates/domain/entities.ts:38 | MAX_TEMPLATE_FILE_BYTES | 10485760 | E/B | duplica HC-039 y RPC; consolidar | varios | Medio | Medio | — | — | P1 | Baja | RPC plantillas | Alta |
| HC-030 | Plantillas | rules.ts:51 | OLE2_SIGNATURE + códigos tipo doc | firma OLE2 / docTypes | C | técnico; mantener | varios | Bajo | Bajo | document_template_types | — | P3 | Baja | — | Alta |
| HC-032 | Prenómina | rules.ts:27-36 | PRENOMINA_STATUS_LABELS/MONTH_LABELS | BORRADOR/CERRADA + meses | D | i18n; mantener | varios | Bajo | Bajo | prenomina_periods.status | — | P3 | Baja | — | Alta |
| HC-033 | Prenómina | rules.ts:63-120 | computeNightOverlapHours/timeToMinutes | algoritmo tramos | C | algoritmo; mantener | 1 | Medio | Bajo | — | — | P3 | Baja | RPC night_overlap | Alta |
| HC-034 | Prenómina | payroll-preparation.workbook.ts:23-56 | PRENOMINA_EXPORT_HEADERS/COLUMN_WIDTHS/NUMERIC_COLUMNS | cabeceras/índices | C | formato de export; mantener | 1 | Bajo | Bajo | — | — | P3 | Baja | export | Alta |
| HC-036 | Acceso | permissions.catalog.ts:41-157 | ENTITY_PERMISSION_LABELS/GROUPS | etiquetas + agrupación | D/F | i18n; agrupación referencia códigos que deben existir en BD | varios | Medio | Bajo | company_client_permissions | — | P2 | Media | UI roles | Alta |
| HC-038 | Acceso | account.rules.ts:26 | AVATAR_ALLOWED_MIME_TYPES | 3 mime | C | técnico; mantener | 1 | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-040 | Compartido | utils/ci.ts:25-38 | IDENTIFICATION_LENGTH/REGEX/ciToBirthDate | 11 dígitos / derivación CI | C/E | duplica patrón en worker-migration y RPC `enforce_identification_format`; consolidar | 3+ | Medio | Bajo | workers.identification | — | P2 | Baja | RPC | Alta |
| HC-041 | Compartido | utils/roman-numerals.ts:13-25 | romanNumerals | tabla romana | C | algoritmo; mantener (también existe `format_roman_numeral` en BD) | varios | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-043 | Compartido | shared/hooks/use-sc404.ts:11 | knownPaths | rutas conocidas | C | estructura de rutas; mantener | 1 | Bajo | Bajo | — | — | P3 | Baja | App.tsx | Alta |
| HC-044 | Licencias | medical-certificates/domain/rules.ts:14-24 | ALLOWED_MIME_TYPES/MAX_FILE_SIZE | mime + 10MB | C/E | consolidar tamaño con HC-039 | 2 | Bajo | Bajo | — | — | P2 | Baja | HC-039 | Alta |
| HC-045 | Doc-templates | domain/rules.ts | validaciones/formatos .doc/.docx | formatos | C | técnico; mantener | varios | Bajo | Bajo | — | — | P3 | Baja | — | Media |
| HC-046 | Supabase | integrations/supabase/client.ts:4-5 | SUPABASE_URL/PUBLISHABLE_KEY | URL + publishable key | F | configuración de entorno; clave publicable por diseño; revisar estrategia | 1 | Bajo | Bajo | — | — | P3 | Baja | entorno | Media |
| HC-047 | Supabase | integrations/supabase/schema-target.ts:73-130 | LEGACY_NAMES/COMPANY_CLIENT_NAMES | mapas de nomenclatura | C | frontera deliberada de migración; mantener | varios | Medio | Bajo | — | — | P3 | Media | RPC/PostgREST | Alta |
| HC-049 | Tests | company-client/__tests__/*.test.ts:16-42 | UUID de prueba | UUID ficticios | C | mocks exclusivos de tests; mantener | 3 | Bajo | Bajo | — | — | P3 | Baja | Vitest | Alta |
| HC-050 | BD/RPC | register_worker_vacation, vacation_target_annual, adjust/set vacation | 24 / 15 | topes de vacaciones | B | tope anual 24 y límite 15 días naturales incrustados en 4 RPC + UI; parametrizar | 4+ | Alto | Medio | worker_vacation_movements | vacation_settings | P1 | Media | HC-016 | Alta |
| HC-051 | BD/RPC | enforce_representative_position_limit, create_representative_position | 2 | máx. cargos representación | B | límite 2 en 2 RPC; configurable | 2 | Medio | Bajo | organization_representative_positions | entity_settings | P2 | Baja | — | Alta |
| HC-052 | BD/RPC | múltiples RPC | 'CUP' | moneda por defecto | B/C | default 'CUP' incrustado en varias RPC; centralizar | varios | Medio | Bajo | salary_scales.currency_code | — | P2 | Baja | — | Alta |
| HC-053 | BD/RPC | enforce_identification_format | ^[0-9]{11}$ | regex CI | E/C | duplica HC-040/016; consolidar | varios | Medio | Bajo | workers.identification | — | P2 | Baja | HC-040 | Alta |
| HC-054 | BD/RPC | set_document_template_version_file | 10485760 | límite archivo | E | duplica HC-039/029; consolidar | 1 | Medio | Bajo | — | — | P2 | Baja | HC-039 | Alta |
| HC-055 | BD/RPC | contract_expiry_alerts | 7/15/30/30 | umbrales de alertas | B/E | duplica HC-021; unificar | 1 | Medio | Medio | — | — | P1 | Baja | HC-021 | Alta |
| HC-056 | BD/RPC | resolve_salary_scale_for_entity, resolve_academic_payment_scope, can_* | PRESUPUESTADA/EMPRESARIAL | regímenes | C/B | constantes de régimen; ligado a HC-001 | varios | Medio | Bajo | entity_regimes | — | P2 | Baja | HC-001 | Alta |
| HC-057 | BD/RPC | save_academic_category_payment, resolve_academic_category_payment_for_flags | MASTER/DOCTOR, 'CUP' | categorías académicas | F/A | catálogo de 2 categorías + moneda; investigar si debe administrarse | 2 | Medio | Bajo | academic_category_payments | academic_categories | P2 | Media | — | Media |
| HC-058 | BD/RPC | prenomina_create_period | 2000/2100/1/12 | límites año/mes | C | validación técnica de rango; mantener | 1 | Bajo | Bajo | prenomina_periods | — | P3 | Baja | — | Alta |
| HC-059 | BD/RPC | format_day_set | Lun/Mar/Mié… | etiquetas de días | D | i18n; mantener | 1 | Bajo | Bajo | position_schedule_segments | — | P3 | Baja | — | Alta |
| HC-060 | BD/RPC | create_company_client | alfabeto + 6 + 20 + 48 | generación de código | C | técnico; mantener | 1 | Bajo | Bajo | company_clients.code | — | P3 | Baja | — | Alta |
| HC-061 | BD/RPC | validate_hiring_readiness/format_contract_readiness_message | VALUES ('Entidad',1)… | orden de secciones | F/D | duplica HC-014; investigar unificación | 1 | Medio | Bajo | — | — | P2 | Baja | HC-014 | Media |
| HC-062 | BD/RPC | contract_condition_changes | field labels/orders | etiquetas/orden campos | E | duplica ADDENDUM_FIELD_LABELS (HC-023); consolidar | 1 | Medio | Bajo | — | — | P2 | Baja | HC-023 | Alta |
| HC-063 | BD/RPC | addendum_change_display | mapeo campo→formato | C | lógica de presentación; mantener | 1 | Bajo | Bajo | — | — | P3 | Baja | — | Alta |
| HC-064 | BD/RPC | create_document_batches_for_event | > 5 | umbral de lote documental | B/F | umbral 5 incrustado; investigar si es parámetro | 1 | Bajo | Bajo | document_batches | — | P2 | Baja | — | Media |

---

## PARTE C — Hallazgos añadidos en la AMPLIACIÓN (HC-065 … HC-078)

Detalle completo en `07-auditoria-academica-salarial.md`. Resumen:

| ID | Módulo | Archivo:Líneas | Símbolo | Valor | Cat. | Prio | Nota |
|----|--------|----------------|---------|-------|------|------|------|
| HC-065 | Académico | organization-structure/domain/entities.ts:541 | `AcademicCategory` | `"MASTER"\|"DOCTOR"` | A/F | P2 | vocabulario cerrado (CHECK SQL + unión TS); tabla sólo si hay más categorías |
| HC-066 | Académico | academic-payment.rules.ts:19-20 | `resolveAcademicCategory` | Doctor>Máster | C/F | P2 | regla duplicada en TS y RPC; mantener en código |
| HC-067 | Académico | academic-payment.rules.ts:26-30; AcademicBadges.tsx:31,41; AcademicDegreeCheckboxes.tsx:29,37 | etiquetas | "Doctor"/"Máster"/"Sin categoría académica"/"Ninguna" | D | P3 | i18n |
| HC-068 | Personas | people/domain/tenure.rules.ts:112-119 | `ageRange` | 20/30/40/50/60 | B/E | P1 | amplía HC-035 (3.ª copia) |
| HC-069 | Vacaciones | vacations/domain/rules.ts:14-17 | `VACATION_*` | 24/24/1/15 | B/E | P1 | amplía HC-050 |
| HC-070 | Salarial | entities.ts:294,544; salary-administration.repository.ts:44,57,74,99; contracts/domain/entities.ts:259 | alcance | `PRESUPUESTADA_GLOBAL`/`EMPRESARIAL_ENTITY` | C | P3 | contrato técnico |
| HC-071 | Salarial | ~15 puntos (formatters.ts:18-19; EntityPrenomina.tsx:733-765; EntitySettingsSalary.tsx:60,147,193,205; AdminSettingsSalaryScale.tsx:45,104,147,190,206…) | moneda | `"CUP"` | B/E | P2 | amplía HC-052 |
| HC-072 | Salarial | salary-administration.repository.ts:77,102 | `regime_id` | `PRESUPUESTADA`/`EMPRESARIAL` | C/E | P3 | derivar de `entity_regimes` |
| HC-073 | Académico | RPC `resolve_academic_payment_scope` (migración 20261025_02:139-146) | alcance académico | presupuestada→global, empresarial→entidad, sin fallback | B/F | P2 | decidir fijo vs configurable |
| HC-074 | Resoluciones | resolutions/domain/rules.ts:6-11 | mensajes | textos de plantilla | D | P3 | i18n; módulo NO cubierto antes |
| HC-075 | Contratos | contracts/domain/salary-labels.ts:11-17 | `SALARY_CHANGE_TYPE_LABELS` | 5 etiquetas | D/F | P2 | códigos a sincronizar con BD |
| HC-076 | Salarial | salary-administration.repository.ts:80,105 | textos `description` | descripciones fijas | D/E | P3 | textos de creación |
| HC-077 | Antigüedad | tenure-scale.rules.ts:4-9,16-23 | `MONTHS_PER_YEAR`/unidades | 12; "Meses"/"Años" | C/D | P3 | técnico + i18n |
| HC-078 | Antigüedad | tenure-scale.rules.ts (validaciones) | `tenureFormToValues` | validaciones | C | P3 | lógica estructural |
| HC-079 | Acceso/Seguridad | supabase/functions/create-sitecorp-user/index.ts:145; access-control/presentation/pages/PlatformUsers.tsx:45,84,96,117,128,330,364 | contraseña por defecto | `"temp1234!"` | E | P1 | credencial por defecto hardcodeada, alcanzable en producción; eliminar (ver Documento 06) |

**Ampliaciones de hallazgos existentes** (mismo concepto, nuevas ubicaciones; no se duplican):
HC-068→HC-035 · HC-069→HC-050 · HC-071→HC-052.

---

## Final — Conteo y trazabilidad (ACTUALIZADO)

- **Conceptos únicos registrados**: **79** (HC-001 … HC-079; HC-065 … HC-078 de la ampliación académica/salarial y HC-079 de la verificación de seguridad). No se inventaron conceptos.
- **Ocurrencias físicas detectadas**: > 100 (varias constantes duplicadas en 2–6 sitios; p. ej.
  HC-039 en 5+ archivos, HC-037 en 5+ sitios, HC-031 en UI + 3 RPC, HC-035 en 3 sitios,
  HC-050 en 4 RPC + frontend, HC-052/HC-071 en ~15 puntos).
- **Candidatos a base de datos (A/B)**: HC-001, HC-011, HC-020, HC-021, HC-031, HC-035, HC-039,
  HC-042, HC-029, HC-050, HC-051, HC-052, HC-055, HC-068, HC-069, HC-071 (16 conceptos), más los
  que la investigación confirme (HC-024, HC-057, HC-064, HC-065, HC-073).
- **Deben permanecer en código (C)**: 24 conceptos originales + HC-066, HC-070, HC-072, HC-077,
  HC-078 (29).
- **Internacionalización (D)**: 9 originales + HC-067, HC-074, HC-075, HC-076 (13).
- **Eliminar/consolidar (E)**: 10 originales + HC-068, HC-069, HC-071, HC-072, HC-076 (15).
- **Requiere investigación (F)**: 8 originales + HC-065, HC-066, HC-073, HC-075 (12).

### Aclaración sobre la suma de categorías
Las categorías **NO son mutuamente excluyentes**: un hallazgo puede llevar varias (p. ej. HC-001
= A/E, HC-021 = B/D, HC-026 = E/A, HC-039 = E/B, HC-065 = A/F). Por eso la suma por categorías
(67 en la versión inicial) **supera** el número de conceptos únicos (64 → ahora 78). No es un error
de conteo, sino de solapamiento de etiquetas.

> Trazabilidad hallazgo → propuesta → bloque: ver Documento 05 (`05-resumen-ejecutivo.md`).
