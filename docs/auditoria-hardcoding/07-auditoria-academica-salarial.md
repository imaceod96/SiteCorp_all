# 07 — Auditoría específica: categorías académicas, escalas salariales y reglas de prenómina

> **Bloque 35 — Ampliación.** SOLO LECTURA de código y base de datos. No se modificó nada.
> Única escritura: documentos Markdown en `docs/auditoria-hardcoding/`.

Este documento completa la auditoría general. Confirma que **existen omisiones** en el informe
original (sobre todo en los módulos `resolutions` y `payroll-movements`, no cubiertos) y añade
el análisis profundo del dominio académico y salarial.

---

## 1. Diagnóstico de CATEGORÍAS ACADÉMICAS

### 1.1 Dónde se definen
- **Unión de tipo (vocabulario cerrado)**: `src/modules/organization-structure/domain/entities.ts:541`
  → `export type AcademicCategory = "MASTER" | "DOCTOR"`.
- **Restricción en base de datos (fuente real)**: la tabla `academic_category_payments` (confirmada
  en el esquema activo) impone `academic_category_payments_category_check`:
  `CHECK (category = ANY (ARRAY['MASTER'::text, 'DOCTOR'::text]))`.
- **Snapshot persistido**: `src/modules/payroll-preparation/domain/entities.ts:66-70`
  → `has_masters_degree_snapshot`, `has_doctorate_degree_snapshot`,
  `academic_category: "MASTER" | "DOCTOR" | null`, `academic_status`, `academic_monthly_amount`,
  `academic_hourly_rate`, `academic_payment` (congelados por período).
- **Indicadores de la persona**: `src/modules/people/domain/entities.ts` (`has_masters_degree`,
  `has_doctorate_degree` en candidato y trabajador) y `workers` (columnas homónimas).

### 1.2 Dónde se consumen / calculan
- **Regla de prioridad (pura)**: `src/modules/organization-structure/domain/academic-payment.rules.ts:15-21`
  → `resolveAcademicCategory`: `if (hasDoctorateDegree) return "DOCTOR"; if (hasMastersDegree) return "MASTER"; return null`.
- **Etiquetas**: `academic-payment.rules.ts:25-30` → `academicCategoryLabel` ("Doctor"/"Máster"/"Sin categoría académica").
- **UI**: `src/modules/people/presentation/components/AcademicBadges.tsx:31,41` (badges "Máster"/"Doctor"),
  `AcademicDegreeCheckboxes.tsx:29,37` (checkboxes "Máster"/"Doctor").
- **Configuración y guardado**: `application/academic-payment.commands.ts` (guarda MASTER y DOCTOR),
  `presentation/components/AcademicCategoryPaymentSection.tsx` (formulario de importes).
- **Resolución salarial**: RPC `resolve_academic_category_payment_for_flags` y
  `resolve_academic_category_payment` (definidas en `src/db/migrations/20261025_02_academic_category_payment.sql:152-245`).
- **Prenómina (snapshot + cálculo)**: `payroll-preparation/domain/rules.ts` (`computeEntryPreview`
  usa `academicMonthlyAmount` con el mismo divisor 190.6) y `normalization.ts:36-44`.

### 1.3 Relación con títulos y con niveles educativos
- Los indicadores académicos son **dos booleanos independientes** en `workers`
  (`has_masters_degree`, `has_doctorate_degree`) — NO son un nivel educativo.
- **Categoría académica ≠ nivel educativo ≠ título**. `education_levels` es un catálogo distinto
  (usado por la regla de especialidad, HC-011). No hay relación estructural entre ambos catálogos
  más allá de datos personales.

### 1.4 Relación con prenómina, contratos y cálculo salarial
- El importe académico se resuelve por **alcance**: presupuestada → global; empresarial → de la
  entidad; **sin fallback** entre regímenes (documentado en `AcademicCategoryPaymentSection.tsx`
  y en la RPC `resolve_academic_payment_scope`).
- En prenómina se **congela** el snapshot por período (`has_*_snapshot`, `academic_monthly_amount`,
  `academic_hourly_rate`, `academic_payment`): el histórico NO se recalcula.
- La regla **Doctor tiene prioridad sobre Máster y NUNCA se suman** está implementada DOS veces:
  en TypeScript (`academic-payment.rules.ts`) y en SQL (`resolve_academic_category_payment_for_flags`).

### 1.5 ¿Conviene una tabla `academic_categories`?
- **Hallazgo real**: NO existe tabla de catálogo de categorías académicas. El vocabulario vive como
  **CHECK constraint** (2 valores) + unión TypeScript.
- **Evaluación**: hoy el dominio es **cerrado y estable** (MASTER/DOCTOR ya usados en prenómina,
  contratos y anexos). Introducir `academic_categories` sólo se justifica si el negocio prevé
  **nuevas categorías** (p. ej. "Especialista", "Postdoctorado") o etiquetas administrables.
- **Recomendación**: categoría **F** (investigar). Si no hay plan de ampliación, **mantener en
  código** (C) el vocabulario y NO crear tabla. La propuesta condicional está en el Documento 03.
- **Importante**: no eliminar los snapshots históricos; no cambiar las reglas de cálculo actuales.

---

## 2. Diagnóstico de ESCALA SALARIAL

### 2.1 ¿Ya existen tablas? ¿Son configurables?
**SÍ — el subsistema salarial es dirijido por base de datos** (conclusión clave):
- Tablas confirmadas en el esquema activo: **`salary_scales`**, **`salary_groups`**,
  **`salary_group_values`** (histórico por vigencia), **`tenure_payment_scales`**,
  **`academic_category_payments`**, y el catálogo **`entity_regimes`**.
- `salary_scales` (esquema real): `scope_type` ∈ {`PRESUPUESTADA_GLOBAL`,`EMPRESARIAL_ENTITY`},
  `regime_id` FK → `entity_regimes`, `currency_code` DEFAULT `'CUP'`, `is_active`, auditoría;
  con RLS y funciones `can_create_salary_scale`, `can_manage_salary_scale`, `can_read_salary_scale`.
- `salary_group_values` guarda el **histórico por vigencia** (`effective_from`/`effective_to`):
  los importes **no se sobrescriben**; se resuelven por fecha
  (`resolve_salary_group_values`, `resolve_salary_value`).

### 2.2 ¿Existen valores fijos en el frontend/RPC?
Apenas. El frontend **no** contiene importes ni porcentajes de cálculo. Los únicos literales son
**contratos técnicos** (alcance, régimen, moneda) y **textos**:
- `SalaryScaleScope`/`SalaryScale` en `organization-structure/domain/entities.ts:294-330`
  y `contracts/domain/entities.ts:259` (literal de alcance).
- `salary-administration.repository.ts:44,57,74,99` (alcance) y `:77,102` (`regime_id`
  `'PRESUPUESTADA'`/`'EMPRESARIAL'`) y `:80,105` (textos de `description`).
- Moneda `"CUP"` por defecto en ~15 puntos del frontend (ver HC-071).

### 2.3 Variación por entidad, categoría y vigencia
- **Por entidad**: sí — la escala empresarial pertenece a la entidad; la presupuestada es global.
- **Por categoría**: el grupo (`salary_groups.sequence_number`) es la "categoría" de escala.
- **Vigencia temporal**: sí — `salary_group_values` versiona por fechas.

### 2.4 Relaciones
- Con **prenómina**: `prenomina_worker_entries.salary_scale_id/salary_scale_amount/salary_group_id`
  (snapshot del período, `20261021_01_prenomina.sql:70-73`).
- Con **contratos**: `employment_contracts.salary_group_id/salary_scale_id`; anexos de cambio de
  escala (`SALARY_SCALE_CHANGE`) vía `apply_salary_group_value_change`.
- Con **categoría académica**: ambos concurren al cálculo de prenómina pero son conceptos
  independientes (se suman al total).

### 2.5 Distinción A–G solicitada
| Grupo | Dónde vive |
|-------|-----------|
| A. Catálogos de escalas | `salary_scales` (BD, N1) |
| B. Grupos/niveles salariales | `salary_groups` (BD, N1) |
| C. Importes asociados | `salary_group_values`, `academic_category_payments`, `tenure_payment_scales` (BD, N1) |
| D. Parámetros de cálculo | `MONTHLY_SALARY_HOURS_DIVISOR` (190.6), tarifas nocturnas (frontend + RPC) — HC-031 |
| E. Reglas de aplicación | prioridad Doctor>Máster, sin fallback de régimen — HC-066/HC-073 |
| F. Valores históricos | `salary_group_values` por vigencia (BD) |
| G. Snapshots de prenómina | `prenomina_worker_entries` (BD) |

### 2.6 ¿Necesita nuevas tablas/columnas?
- **No** para escalas, grupos ni importes: ya están modelados con histórico y vigencia.
- **Posible**: columna de catálogo de categorías académicas (ver §1) — sólo si se decide.

---

## 3. RELACIÓN CATEGORÍA ACADÉMICA ↔ SALARIO

- **¿De dónde procede el importe?** De `academic_category_payments.amount`
  (configurado por entidad o global), resuelto por la RPC `resolve_academic_category_payment_for_flags`.
- **¿Existe tabla que lo configure?** SÍ — `academic_category_payments` (confirmada).
- **¿Está hardcodeado el importe?** NO. Lo que está fijo es el **vocabulario de categorías**
  (MASTER/DOCTOR) y la **regla de prioridad**, no los importes.
- **¿Se configura por entidad/período?** Por entidad (empresarial) o global (presupuestada);
  el período sólo congela el snapshot.
- **¿Sobre salario base?** No: es un **concepto mensual independiente** que se convierte a hora
  con el mismo divisor 190.6 y se multiplica por las horas trabajadas.
- **¿Se conserva snapshot histórico?** SÍ, por período en `prenomina_worker_entries`.
- **¿Qué ocurre si cambia la categoría / la escala?** El histórico NO se recalcula; el cambio
  afecta a períodos nuevos (y a anexos contractuales por separado).

**Posibles inconsistencias detectadas**: la regla de prioridad y el vocabulario están **duplicados
en TS y SQL**; si se añade una categoría habría que tocar el CHECK, la unión TS y (si aplica) la
regla de prioridad en dos sitios.

---

## 4. REVISIÓN DE OMISIONES (nuevos hallazgos)

Se revisaron de nuevo Personas, Contratos, Prenómina, Estructura organizativa, Configuración de
entidades, Configuración salarial, Documentos y Acceso/Permisos, y además los módulos **no cubiertos
antes**: `resolutions` y `payroll-movements`, y las reglas puras de `vacations`.

Nuevos IDs: **HC-065 … HC-078**. Ampliaciones de existentes: **HC-035, HC-050, HC-052**.

### HC-065 — Vocabulario de categorías académicas (MASTER/DOCTOR)
- **Ubicaciones**: `organization-structure/domain/entities.ts:541`;
  `payroll-preparation/domain/entities.ts:68`; `organization-structure/infrastructure/academic-payment.repository.ts:121`;
  CHECK `academic_category_payments_category_check` (migración `20261025_02:42-44`).
- **Categoría**: **A/F**. **Prioridad**: P2. **Justificación**: catálogo cerrado de negocio
  duplicado (CHECK SQL + unión TS). Sólo migrar a tabla `academic_categories` si se prevén más
  categorías; si no, mantener en código. **Tabla existente relacionada**: `academic_category_payments`.

### HC-066 — Regla de prioridad Doctor > Máster
- **Ubicaciones**: `organization-structure/domain/academic-payment.rules.ts:19-20`;
  RPC `resolve_academic_category_payment_for_flags` (migración `20261025_02:171-175`).
- **Categoría**: **C/F**. **Prioridad**: P2. **Justificación**: regla de negocio duplicada en TS y
  SQL. Es estable y de negocio laboral; se recomienda **mantener en código** (una única
  implementación autorizada en BD) salvo que deba ser configurable. **Confianza**: alta.

### HC-067 — Etiquetas académicas
- **Ubicaciones**: `academic-payment.rules.ts:26-30` ("Doctor","Máster","Sin categoría académica");
  `AcademicBadges.tsx:31,41`; `AcademicDegreeCheckboxes.tsx:29,37` ("Máster","Doctor").
- **Categoría**: **D**. **Prioridad**: P3. Textos de interfaz → i18n.

### HC-068 — Tramos de edad duplicados (amplía HC-035)
- **Ubicación nueva**: `people/domain/tenure.rules.ts:112-119` (`ageRange`: 20/30/40/50/60).
- **Categoría**: **B/E**. **Prioridad**: P1. **Justificación**: TERCERA copia de los mismos cortes
  (además de `entity-summary/domain/rules.ts` y la RPC `report_worker_demographics`). Refuerza HC-035.

### HC-069 — Topes de vacaciones duplicados en frontend (amplía HC-050)
- **Ubicación**: `vacations-licenses/vacations/domain/rules.ts:14-17`
  → `VACATION_ANNUAL_DAYS=24`, `VACATION_MAX_ACCRUAL_DAYS=24`, `VACATION_MIN_NATURAL_DAYS=1`,
  `VACATION_MAX_NATURAL_DAYS=15`.
- **Categoría**: **B/E**. **Prioridad**: P1. Refuerza HC-050 (24/15 también en 4 RPC).

### HC-070 — Literales de alcance salarial
- **Ubicaciones**: `organization-structure/domain/entities.ts:294,544`;
  `salary-administration.repository.ts:44,57,74,99`; `contracts/domain/entities.ts:259`;
  `AcademicCategoryPaymentSection.tsx:109`.
- **Categoría**: **C**. Contrato técnico reforzado por CHECK SQL. Mantener.

### HC-071 — Moneda por defecto "CUP" (amplía HC-052)
- **Ubicaciones**: ~15 puntos (p. ej. `academic-payment.rules.ts:32`, `formatters.ts:18-19`,
  `EntityPrenomina.tsx:733,747-765`, `AdminSettingsSalaryScale.tsx:45,104,147,190,206`,
  `EntitySettingsSalary.tsx:60,147,193,205`, `WorkerPrenominaDialog.tsx:119`,
  `ReviewSalaryChangeDialog.tsx:138`, `ResolutionForm.tsx:58`, y DEFAULT de las tablas).
- **Categoría**: **B/E**. **Prioridad**: P2. Centralizar el default (o leerlo de la escala).

### HC-072 — Régimen literal en inserciones de escala
- **Ubicación**: `salary-administration.repository.ts:77,102` (`regime_id: "PRESUPUESTADA"/"EMPRESARIAL"`).
- **Categoría**: **C/E**. Debería derivarse de `entity_regimes` (enlaza con HC-001).

### HC-073 — Regla de alcance del pago académico (sin fallback)
- **Ubicación**: RPC `resolve_academic_payment_scope` (migración `20261025_02:139-146`) y comentarios
  de `AcademicCategoryPaymentSection.tsx`.
- **Categoría**: **B/F**. **Prioridad**: P2. Regla de negocio: presupuestada→global,
  empresarial→entidad, sin fallback. Decidir si permanece fija (C) o configurable.

### HC-074 — Mensajes del módulo Resoluciones
- **Ubicación**: `resolutions/domain/rules.ts:6-11` (`MISSING_RESOLUTION_TEMPLATE_MESSAGE`, etc.).
- **Categoría**: **D**. Textos de UI → i18n.

### HC-075 — Etiquetas de tipo de cambio salarial
- **Ubicación**: `contracts/domain/salary-labels.ts:11-17` (`SALARY_CHANGE_TYPE_LABELS`).
- **Categoría**: **D/F**. **Justificación**: vocabulario del campo `change_type` que ya devuelve el
  backend; los códigos deben sincronizarse con la BD. **Prioridad**: P2.

### HC-076 — Textos fijos de descripción al crear escalas
- **Ubicación**: `salary-administration.repository.ts:80,105` ("Escala salarial presupuestada
  general de SiteCorp", "Escala salarial empresarial de la entidad").
- **Categoría**: **D/E**. **Prioridad**: P3.

### HC-077 — Unidades de la escala de antigüedad y MONTHS_PER_YEAR
- **Ubicación**: `organization-structure/domain/tenure-scale.rules.ts:4-9,16-23`
  (`MONTHS_PER_YEAR=12`, unidades "Meses"/"Años", `EMPTY_TENURE_FORM`).
- **Categoría**: **C/D**. Técnico + etiquetas i18n. **Prioridad**: P3.

### HC-078 — Validaciones de la escala de antigüedad
- **Ubicación**: `tenure-scale.rules.ts` (`tenureFormToValues`, mensajes de validación).
- **Categoría**: **C**. Lógica estructural; mantener.

---

## 5. Reglas que deben PERMANECER en código
- Prioridad Doctor > Máster (una implementación autorizada) — HC-066.
- Algoritmo de antigüedad por calendario — `people/domain/tenure.rules.ts` (HC-078 y cálculo).
- Cálculo de prenómina (divisor, redondeos) — `payroll-preparation/domain/rules.ts` (HC-031).
- Contrato del alcance salarial (IDs/strings) — HC-070.

## 6. Reglas que deben ser CONFIGURABLES
- Tarifas nocturnas y divisor (HC-031) — única fuente BD+UI.
- Tramos de edad (HC-035/HC-068) — una sola fuente.
- Topes de vacaciones (HC-050/HC-069).
- Horizonte de alertas contractuales (HC-021/HC-055).
- Importes académicos y de escala — **YA** configurables en BD.

---

## 7. Riesgos para cálculos históricos
- **Snapshots de prenómina**: no recalcular; cualquier cambio de parámetros sólo debe afectar a
  períodos nuevos.
- **`salary_group_values` por vigencia**: no sobrescribir importes; versionar.
- **Anexos contractuales**: los cambios de escala generan anexos; preservar el hecho histórico.
- **Regla Doctor>Máster**: cambiarla afectaría a resoluciones futuras; el histórico ya está congelado.

---

## 8. Estrategia de migración recomendada (resumen)
Ver Documento 04 (Bloques 36–43 + nuevos 44–45). En síntesis:
- **No tocar** escalas/importes académicos: ya están bien modelados.
- Consolidar **duplicaciones** (edad, vacaciones, moneda) hacia fuentes únicas.
- **Opcional**: `academic_categories` sólo si hay decisión de negocio (categoría F).
- Cambiar parámetros exige editar **UI + RPC en el mismo bloque**.

## 9. Impacto en prenómina y contratos
- **Prenómina**: cualquier cambio de parámetros debe ir acompañado de la RPC para no divergir;
  los snapshots protegen el histórico.
- **Contratos**: HC-070/HC-072/HC-075 afectan a anexos y resúmenes; cambios de solo lectura no
  alteran cálculos.

## 10. Pruebas necesarias
Vitest de `academic-payment.rules`, `payroll-preparation/domain/rules`, `tenure.rules`,
`vacations/domain/rules`, `entity-summary/domain/rules`; Playwright de configuración salarial,
pago académico, prenómina, vencimientos y contratos.

## 11. Prioridad recomendada
P1: HC-068, HC-069 (duplicaciones con impacto de cálculo). P2: HC-065, HC-066, HC-071, HC-073,
HC-075. P3: HC-067, HC-070, HC-072, HC-074, HC-076, HC-077, HC-078.

---

## 12. Corrección de totales y de la suma de categorías

- La suma de las categorías del Documento 01 daba **67** frente a **64** conceptos únicos porque
  **las categorías NO son mutuamente excluyentes**: un mismo hallazgo puede pertenecer a varias
  categorías (p. ej. HC-001 es **A/E**, HC-021 es **B/D**, HC-026 es **E/A**, HC-039 es **E/B**).
  Al sumar por categorías se cuenta dos veces a los hallazgos multicategoría → 67 > 64.
- Con esta ampliación: **14 hallazgos nuevos** (HC-065 … HC-078) y **3 ampliados** (HC-035, HC-050,
  HC-052). **Nuevo total de conceptos únicos: 78.**
- Los hallazgos existentes ampliados mantienen su ID y se vinculan aquí (HC-068→HC-035,
  HC-069→HC-050, HC-071→HC-052); no se duplican conceptualmente.

> Los documentos 01–05 se han actualizado con estos hallazgos y los totales recalculados.
