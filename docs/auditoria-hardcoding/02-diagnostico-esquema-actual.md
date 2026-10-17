# 02 — Diagnóstico del esquema actual de Supabase

> **Bloque 35.** Lectura en modo SOLO LECTURA. No se creó, modificó ni eliminó nada.
> Fuente: observación del esquema activo conectado (ID de proyecto `xvswjkpoeccgpiewptur`)
> + revisión de las migraciones locales de `src/db/migrations/` + inferencia desde el código.

---

## 1. Método y niveles de verificación

Se distinguen expresamente cuatro niveles, tal como exige la Sección 6 del bloque:

| Nivel | Descripción |
|-------|-------------|
| **N1 — Confirmada en esquema activo** | Tabla/función observada en el proyecto conectado en modo lectura. |
| **N2 — Documentada en migraciones locales** | Aparece en `src/db/migrations/`, pero su estado real en producción no se comprobó. |
| **N3 — Inferida desde el código** | Se deduce del uso en repositorios/RPC. |
| **N4 — No verificada** | No se pudo confirmar existencia ni contenido. |

**Regla aplicada**: no se afirma que algo existe en producción sólo porque aparezca en un archivo
local. Cuando sólo hay evidencia local, se marca N2/N4.

---

## 2. Tablas confirmadas en el esquema activo (N1)

El esquema activo devuelve **76 tablas**. Las relevantes como **catálogos reutilizables** son:

| Tabla | Finalidad | Reutilizable por |
|-------|-----------|------------------|
| `entity_regimes` | Regímenes (Presupuestada/Empresarial) | HC-001 |
| `provinces`, `municipalities` | Divisiones territoriales | HC-042 |
| `education_levels` | Niveles educacionales | HC-011 |
| `document_variables` | Registro central de variables documentales | HC-026 |
| `document_types`, `document_template_types` | Tipos documentales | HC-030 |
| `occupational_categories`, `preparation_levels` | Config. de cargo | (ya DB-backed) |
| `genders`, `marital_statuses`, `skin_colors` | Datos personales | (ya DB-backed) |
| `driving_license_categories` | Licencias | (ya DB-backed) |
| `payment_methods` | Formas de pago | (ya DB-backed) |
| `employment_contract_types`, `employment_types` | Tipos de contrato | (ya DB-backed) |
| `rehire_statuses`, `worker_separation_reasons` | Motivos de baja/reingreso | (ya DB-backed) |
| `political_affiliations` | Afiliación política | (ya DB-backed) |
| `salary_scales`, `salary_groups`, `salary_group_values` | Estructura salarial | HC-031 |
| `tenure_payment_scales` | Escala de antigüedad | — |
| `academic_category_payments` | Pago por categoría académica | HC-057 |
| `platform_permissions`, `platform_roles` | Catálogo de plataforma | HC-036/037 |
| `company_client_permissions`, `company_client_roles` | Catálogo interno + roles | HC-036/037 |

Tablas de datos de negocio confirmadas (no catálogos, pero relevantes): `company_clients`,
`organization_entities`, `workers`, `candidates`, `employment_contracts`, `contract_addendums`,
`worker_position_assignments`, `worker_vacations`, `worker_vacation_movements`,
`worker_medical_certificates`, `prenomina_*`, `document_templates`, `document_template_versions`,
`worker_documents`, `profiles`, `entity_user_access`, `company_client_memberships`, etc.

> **Observación de nomenclatura**: el esquema activo contiene ya las tablas con nombres
> `company_client_*` y `company_clients`. Esto es coherente con un estado de esquema objetivo
> `company_client` (ver `schema-target.ts`). La frontera de nomenclatura del código sigue
> soportando el estado `legacy` (`tenants`, `tenant_roles`, …) — ver HC-047.

### 2.1 Subsistema salarial y académico (confirmado N1 en la ampliación)

| Tabla | Finalidad | Notas de esquema verificadas |
|-------|-----------|------------------------------|
| `salary_scales` | Escala global presupuestada / empresarial por entidad | `scope_type` CHECK {`PRESUPUESTADA_GLOBAL`,`EMPRESARIAL_ENTITY`}; `regime_id` FK→`entity_regimes`; `currency_code` DEFAULT `'CUP'`; RLS con `can_create/manage/read_salary_scale`; índice único `one_global_presupuestada_scale` |
| `salary_groups` | Grupos/niveles de la escala | `sequence_number`; `is_active` (nunca se borra) |
| `salary_group_values` | **Histórico** de importes por vigencia | `effective_from`/`effective_to`; se resuelve por fecha (`resolve_salary_group_values`) |
| `tenure_payment_scales` | Escala de pago por antigüedad | tramos en meses |
| `academic_category_payments` | Importe por categoría académica | `category` CHECK {`MASTER`,`DOCTOR`}; `scope_type`; `regime_id` FK→`entity_regimes`; `amount` CHECK ≥ 0; RLS |
| `entity_regimes` | Regímenes (PSUPUESTADA/EMPRESARIAL) | catálogo |
| `prenomina_worker_entries` | **Snapshot** por período | `salary_scale_id/salary_scale_amount/salary_group_id`; `has_masters_degree_snapshot`, `has_doctorate_degree_snapshot`, `academic_category`, `academic_monthly_amount`, `academic_hourly_rate`, `academic_payment` |

**Conclusión clave**: el subsistema de **escalas e importes académicos ya es configurable en BD**,
con histórico por vigencia y RLS. **No requiere tablas nuevas**; sólo el **vocabulario de categorías
académicas** vive como CHECK + unión TypeScript (HC-065, categoría F).

**RPC confirmadas del dominio salarial/académico**: `resolve_salary_scale_for_entity`,
`resolve_salary_group_values`, `resolve_salary_value`, `apply_salary_group_value_change`,
`get_academic_category_payment_config`, `save_academic_category_payment`,
`resolve_academic_category_payment`, `resolve_academic_category_payment_for_flags`,
`resolve_academic_payment_scope`, `prenomina_monthly_hours_divisor`,
`prenomina_night_rate_19_23`, `prenomina_night_rate_23_07`.

---

## 3. Migraciones locales (N2) e inferencias (N3)

- `src/db/migrations/` incluye 60+ archivos SQL. Varios usan **nomenclatura legacy**
  (`tenants`, `tenant_roles`, `tenant_permissions`) en las fases de renombrado
  (`20261027_02_rename_tables.sql` …). Su estado real en producción **no se verificó** (N2).
- `20260922_02_entity_access_test_data.sql` y `20260922_04_roles_permissions_test_data.sql`
  documentan **datos de prueba** con `TENANT-A`, roles `Viewer`/`HR Manager`/`RRHH Test`/
  `Platform Test` y usuarios `admin`/`isael` (N2 + ver HC-048). Su permanencia en la base
  conectada es **N4** (no verificada).
- Numerosas reglas de negocio viven en **funciones RPC** confirmadas (N1) y son evidencia de
  hardcoding en la capa BD (HC-050 … HC-064). El listado de funciones observadas incluye, entre
  otras: `prenomina_night_rate_23_07()` = `1.15`, `prenomina_night_rate_19_23()` = `0.60`,
  `prenomina_monthly_hours_divisor()` = `190.6`, `contract_expiry_alerts(... horizon_days DEFAULT 30)`,
  `enforce_representative_position_limit` (2), `enforce_identification_format` (`^[0-9]{11}$`),
  `set_document_template_version_file` (`10485760`), `register_worker_vacation` (límite 15 días /
  tope 24), `vacation_target_annual` (24), `adjust_worker_vacation_balance` (24),
  `set_worker_vacation_opening_balance` (0..24).

---

## 4. Oportunidades de reutilización (evitar tablas redundantes)

1. **HC-001 → `entity_regimes`**: no crear tabla; ya existe.
2. **HC-042 → `provinces` / `municipalities`**: no crear tabla; ya existen.
3. **HC-026 → `document_variables`**: no crear tabla; el catálogo debe migrarse a la existente.
4. **HC-011 → `education_levels`**: no crear tabla; añadir semántica (código/flag) a la existente.
5. **HC-037 → `company_client_permissions` / `platform_permissions`**: no crear tabla; añadir flag
   de ámbito a la existente.
6. **HC-036 → catálogo de permisos**: las etiquetas pueden quedarse en i18n; los códigos ya están
   en BD.
7. **HC-052 → `salary_scales.currency_code`**: ya existe la columna; el `'CUP'` por defecto puede
   resolverse desde ahí.

---

## 5. Carencias detectadas (no existe tabla de parámetros)

No se observa en el esquema activo **ninguna tabla de parámetros/configuración de negocio**
(no hay `settings`, `parameters`, `configuration`). Por tanto, los parámetros de negocio que hoy
están incrustados (HC-021 horizontes, HC-031 tarifas/divisor, HC-035 tramos de edad, HC-050 topes
de vacaciones, HC-051 límite de representantes, HC-039 límite de archivo) **no tienen dónde vivir
de forma configurable**. Esto justifica las tablas nuevas propuestas en el Documento 03.

---

## 6. RLS, RPC y seguridad: estado observado

- RLS y políticas: no se modificaron. La mayoría de funciones RPC confirmadas son `SECURITY DEFINER`
  con `can_access_entity(...)` como autoridad de autorización (evidencia: `can_access_entity`,
  `has_platform_permission`, `is_platform_superadmin`).
- Existen funciones de ayuda de autorización confirmadas: `can_access_entity`,
  `can_use_company_client_permission`, `has_platform_permission`, `is_platform_superadmin`,
  `is_entity_descendant`, `is_platform_user_active`, `can_view_entity`.
- **Implicación para el diseño**: cualquier catálogo nuevo con alcance por organización/entidad
  debe reutilizar `can_access_entity` / `can_use_company_client_permission` para no introducir un
  modelo de permisos paralelo.

---

## 7. Resumen del diagnóstico

- **Tablas existentes reutilizables directamente**: 6 (ver §4).
- **Tablas nuevas necesarias (propuestas)**: ver Documento 03 (5 propuestas + columnas en 2 existentes).
- **Tablas redundantes que NO deben crearse**: provincias/municipios, regímenes, variables
  documentales, tipos de permiso.
- **Vacío estructural**: ausencia total de tablas de parámetros de negocio.
- **Verificación**: todas las tablas citadas en §2 son N1; los datos de prueba son N2/N4 (requieren
  confirmación en producción antes de tocarlos).
