# 03 — Propuesta de modelo de datos

> **Bloque 35.** PROPUESTA de diseño. No se crea ninguna tabla, política, índice ni migración.
> No se introduce multi-tenancy artificial: se respeta el modelo real de SiteCorp
> (`company_clients` → `organization_entities` → usuarios con acceso por `entity_user_access`).

**Convenciones de la propuesta** (sólo diseño; no se ejecuta):
- PK: `uuid DEFAULT gen_random_uuid()` salvo catálogos de código (`text` PK cuando el dominio lo
  justifique por estabilidad, como ya hace `document_variables.key`).
- Auditoría: `created_at`, `updated_at`, `created_by`, `updated_by`.
- Activación: `is_active boolean DEFAULT true` (nunca borrado físico de catálogos).
- Ordenación: `sort_order integer`.
- i18n: `label` en el idioma base; `label_i18n jsonb` sólo si se decide multiidioma.
- Seguridad: RLS conceptual reutilizando `can_access_entity` / `can_use_company_client_permission` /
  `has_platform_permission` (jamás un modelo de permisos paralelo).

---

## 1. Catálogos que se MIGRAN a tablas EXISTENTES (sin tabla nueva)

### 1.1 HC-001 → `entity_regimes` (alcance GLOBAL)
- **Finalidad**: réditos de régimen (Presupuestada/Empresarial). **Módulo propietario**: Estructura organizativa.
- **Acción**: NO crear tabla. El frontend deja de incrustar `REGIME_OPTIONS` y lee `entity_regimes`
  (`code`, `name`). Requisito de seguridad: lectura para usuarios autenticados (catálogo global).

### 1.2 HC-042 → `provinces` / `municipalities` (alcance GLOBAL)
- **Finalidad**: divisiones territoriales. **Módulo propietario**: Personas.
- **Acción**: NO crear tabla. Consumir los catálogos existentes. Si se decide integridad
  referencial, evaluar en un bloque posterior convertir `workers.province`/`municipality` (hoy
  `text` libre) a FK — **decisión de negocio pendiente**, no asumida en esta propuesta.

### 1.3 HC-011 → `education_levels` (columna nueva)
- **Finalidad**: marcar los niveles que exigen especialidad.
- **Columna propuesta**: `requires_specialty boolean NOT NULL DEFAULT false`.
- **Acción**: eliminar `SPECIALTY_EDUCATION_LEVELS` del código; la regla pasa a depender del flag.
- **Seguridad**: lectura para usuarios con acceso a la entidad; escritura sólo administración catálogo.

### 1.4 HC-037 → `company_client_permissions` / `platform_permissions` (columna nueva)
- **Finalidad**: marcar el ámbito interno/plataforma sin expresiones regulares dispersas.
- **Columna propuesta**: `is_internal_scope boolean` (en `company_client_permissions`); ya existe
  `platform_permissions.is_platform_scope` (evidencia en RPC `groupPlatformPermissions`).
- **Acción**: sustituir `LEGACY_PERMISSION_PATTERN` y los `!~ '(^areas\.|…)'` repetidos en RPC por
  el flag. **Requiere bloque de esquema + RPC** (no trivial, ver Documento 04).

### 1.5 HC-026 → `document_variables` (migración de catálogo)
- **Finalidad**: registro central de variables documentales.
- **Acción**: la tabla YA existe (`key`, `label`, `document_types`, …). Consolidar el catálogo del
  código HACIA la tabla; el frontend lee de BD. **Módulo propietario**: Plantillas documentales.
- **Seguridad**: lectura para usuarios con acceso a la entidad; escritura de catálogo sólo plataforma.

---

## 2. Tablas NUEVAS propuestas

### 2.1 `compensation_component_types` (HC-020) — alcance GLOBAL
- **Finalidad**: catálogo cerrado de tipos de concepto retributivo.
- **Módulo propietario**: Contratos.
- **Columnas**: `code text PK` (ADDITIONAL_PAYMENT / ABNORMAL_CONDITIONS / OTHER),
  `label text`, `hint text`, `sort_order integer`, `is_active boolean`, auditoría.
- **PK**: `code`. **FK**: ninguna. **Restricciones**: `code` estable e inmutable.
- **Índices**: PK. **Únicos**: `code`. **Default**: `is_active = true`.
- **Seguridad**: lectura para usuarios con acceso a contratos; escritura sólo plataforma/superadmin.
- **i18n**: `label`/`hint` en base; `label_i18n` si procede.
- **Nota**: el vocabulario ya está validado en RPC; la tabla debe ser la fuente y las RPC pueden
  seguir validando contra ella o contra el mismo contrato de códigos.

### 2.2 `prenomina_rate_parameters` (HC-031) — alcance GLOBAL (HÍBRIDO opcional)
- **Finalidad**: divisor de horas y tarifas de nocturnidad.
- **Módulo propietario**: Prenómina.
- **Columnas**: `id uuid PK`, `scope_type text` (GLOBAL | EMPRESARIAL_ENTITY),
  `organization_entity_id uuid NULL` (FK `organization_entities`), `monthly_hours_divisor numeric`,
  `night_rate_19_23 numeric`, `night_rate_23_07 numeric`, `effective_from date`, `effective_to date`,
  `is_active boolean`, auditoría.
- **Relaciones**: FK a `organization_entities` sólo para alcance por entidad.
- **Restricciones**: `scope_type` válido; coherencia `scope_type`↔`organization_entity_id`.
- **Índices**: `(scope_type, organization_entity_id, effective_from)`.
- **Default**: valores actuales (190.6 / 0.6 / 1.15) como seed.
- **Seguridad**: lectura autenticada (o con acceso a la entidad en alcance empresarial); escritura
  plataforma (`salary.manage`) o `can_access_entity(entity,'salary.*')`.

### 2.3 `vacation_policy_settings` (HC-050) — alcance HÍBRIDO (global + por entidad)
- **Finalidad**: tope anual de vacaciones (24) y límite de días naturales por período (15).
- **Módulo propietario**: Vacaciones.
- **Columnas**: `id uuid PK`, `scope_type text`, `organization_entity_id uuid NULL`,
  `annual_cap_days numeric`, `max_natural_days integer`, `effective_from date`, `effective_to date`,
  `is_active boolean`, auditoría.
- **Restricciones**: `annual_cap_days >= 0`, `max_natural_days > 0`.
- **Índices**: `(scope_type, organization_entity_id, effective_from)`.
- **Default/seed**: 24 y 15.
- **Seguridad**: lectura autenticada con acceso a la entidad; escritura administración autorizada.
- **Dependencia dura**: las RPC `register_worker_vacation`, `vacation_target_annual`,
  `adjust_worker_vacation_balance`, `set_worker_vacation_opening_balance` deben leer de aquí
  (no se puede migrar el frontend sin tocar RPC).

### 2.4 `contract_alert_settings` (HC-021 / HC-055) — alcance HÍBRIDO (global + por entidad)
- **Finalidad**: horizonte de atención y tramos de vencimiento (7/15/30).
- **Módulo propietario**: Contratos.
- **Columnas**: `id uuid PK`, `scope_type text`, `organization_entity_id uuid NULL`,
  `attention_horizon_days integer`, `threshold_days_1 integer`, `threshold_days_2 integer`,
  `threshold_days_3 integer`, `is_active boolean`, auditoría.
- **Default/seed**: 30, 7, 15, 30.
- **Seguridad**: lectura con acceso a la entidad; escritura autorizada.
- **Dependencia dura**: RPC `contract_expiry_alerts` debe leer estos umbrales.

### 2.5 `report_age_buckets` (HC-035) — alcance GLOBAL
- **Finalidad**: tramos de edad de informes.
- **Columnas**: `id uuid PK`, `key text`, `label text`, `min_age integer`, `max_age integer NULL`,
  `sort_order integer`, auditoría.
- **Restricciones**: rangos excluyentes y contiguos. **Únicos**: `key`.
- **Seguridad**: lectura autenticada; escritura plataforma.
- **Dependencia dura**: RPC `report_worker_demographics` y `AGE_BUCKETS` del frontend comparten fuente.

### 2.6 `document_settings` (HC-039 / HC-029 / HC-054) — alcance GLOBAL (o por organización)
- **Finalidad**: límite de tamaño y extensiones permitidas.
- **Columnas**: `id uuid PK`, `scope_type text`, `company_client_id uuid NULL`,
  `max_file_size_bytes bigint`, `allowed_extensions text[]`, `is_active boolean`, auditoría.
- **Default/seed**: `10485760`, extensiones actuales.
- **Seguridad**: lectura autenticada; escritura autorizada.
- **Alternativa más simple**: mantener constante única compartida en código y NO crear tabla si el
  límite no debe variar por cliente. **Recomendado evaluar en Fase A.**

### 2.7 `compensation_addendum_reason_codes` (HC-024) — alcance GLOBAL [F]
- **Finalidad**: motivos de anexo manual.
- **Columnas**: `code text PK`, `label text`, `sort_order integer`, `is_active boolean`, auditoría.
- **Estado**: **requiere investigación** (los motivos hoy se validan en RPC y se etiquetan en UI).
  No se propone crear sin decisión de negocio.

### 2.8 `representative_position_limit` (HC-051) — alcance GLOBAL [opcional]
- **Finalidad**: máximo de cargos de representación activos por entidad (2).
- **Recomendación**: incorporarlo como parámetro en `business` de estructura organizativa
  (p. ej. reutilizar `prenomina_parameters`-style) o mantener como constante técnica si es una
  norma fija. **Requiere decisión de negocio** (¿es configurable o es norma?).

---

### 2.9 `academic_categories` (HC-065) — alcance GLOBAL [F — condicional]
- **Finalidad**: catálogo de categorías académicas con pago propio.
- **Módulo propietario**: Estructura organizativa (pago académico).
- **Estado**: **requiere investigación**. Hoy el vocabulario es **cerrado y estable**
  (MASTER/DOCTOR), impuesto por un CHECK en `academic_category_payments` y una unión TypeScript.
- **Propuesta condicional** (sólo si el negocio prevé nuevas categorías):
  - Columnas: `code text PK` (estable, p. ej. `MASTER`,`DOCTOR`), `label text`,
    `sort_order integer`, `is_active boolean`, auditoría.
  - **Clave estable** independiente de la etiqueta mostrada (los snapshots y CHECK usan el `code`).
  - **No** confundir con `education_levels` ni con el título académico.
  - Relación: `academic_category_payments.category` podría pasar a FK `academic_categories.code`
    (manteniendo compatibilidad con el CHECK actual durante la transición).
- **Si NO hay plan de ampliación**: **mantener en código** (C) y **no** crear la tabla.
- **Sin cambios de cálculo**: la regla Doctor>Máster (HC-066) permanece en código/RPC.

### 2.10 Escalas e importes: NO requieren tablas nuevas
- `salary_scales`, `salary_groups`, `salary_group_values`, `tenure_payment_scales` y
  `academic_category_payments` **ya existen** con histórico, vigencia y RLS. No se propone
  estructura redundante. Única mejora opcional: un flag de catálogo si se adopta `academic_categories`.

## 3. Relación entre propuestas y esquema existente

| Propuesta | Reutiliza | Crea |
|-----------|-----------|------|
| HC-001 | `entity_regimes` | — |
| HC-042 | `provinces`, `municipalities` | — |
| HC-011 | `education_levels` | columna `requires_specialty` |
| HC-037 | `company_client_permissions`, `platform_permissions` | columna flag (company_client) |
| HC-026 | `document_variables` | — |
| HC-020 | — | `compensation_component_types` |
| HC-031 | `organization_entities` (FK) | `prenomina_rate_parameters` |
| HC-050 | `organization_entities` (FK) | `vacation_policy_settings` |
| HC-021 | `organization_entities` (FK) | `contract_alert_settings` |
| HC-035 | — | `report_age_buckets` |
| HC-039 | — | `document_settings` (opcional) |
| HC-024 | — | `compensation_addendum_reason_codes` [F] |

---

## 4. Seguridad y multitenancy (conceptual, sin escritura)

Para cada tabla nueva, requisitos de RLS **conceptuales**:

- **Catálogos GLOBALES** (`compensation_component_types`, `report_age_buckets`,
  `prenomina_rate_parameters` alcance global): SELECT para `authenticated`; INSERT/UPDATE/DELETE sólo
  a roles de plataforma autorizados (`has_platform_permission(...)` / `is_platform_superadmin()`).
- **HÍBRIDOS con alcance por entidad** (`vacation_policy_settings`, `contract_alert_settings`,
  `prenomina_rate_parameters` empresarial, `document_settings` por cliente): SELECT y escritura
  condicionadas a `can_access_entity(organization_entity_id, <permiso>)` o
  `can_use_company_client_permission(company_client_id, <permiso>)`.
- Nunca se asume que "poder consultar" implica "poder administrar".
- Nunca se traslada una regla de autorización al frontend ni se convierte un permiso en
  configuración editable sin un diseño de seguridad específico.
- Riesgo a vigilar: que una tabla por entidad no filtre datos entre organizaciones; la FK a
  `organization_entities` y la política con `can_access_entity` son la garantía.

**Riesgos de exposición identificados**: HC-048 (roles/usuarios de prueba) puede conceder acceso
real; HC-037 (patrón legacy) si se migra mal podría ofrecer permisos no deseados. Ambos requieren
bloque de seguridad propio.

---

## 5. Qué NO se propone

- No se propone tabla para textos de interfaz (etiquetas, mensajes, cabeceras de export) → i18n.
- No se propone tabla para algoritmos (romanos, solape nocturno, derivación de CI) → código.
- No se propone tabla para tipos de entidad ni estados técnicos (`active/inactive`).
- No se propone tabla para rutas de navegación ni códigos PostgREST.
- No se propone tabla para cabeceras fijas del Anexo 14 (son plantilla impresa, no catálogo).
