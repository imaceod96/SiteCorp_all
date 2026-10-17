# 04 — Plan de migración (hoja de ruta por bloques)

> **Bloque 35.** PLANIFICACIÓN. No se inicia ninguna implementación. Cada bloque respeta el límite
> recomendado de **≤ 20 archivos** y no fragmenta dependencias transaccionales. Se separan las
> fases A–E exigidas por la Sección 12.

Fases transversales (aplican a cada bloque que toque BD):
- **FASE A** Diseño y validación · **FASE B** Esquema y seguridad · **FASE C** Migración de datos ·
  **FASE D** Adaptación del código · **FASE E** Pruebas y retirada del hardcoding.

---

## Bloque recomendado primero: BLOQUE 36

**Nombre**: Reutilización de catálogos ya existentes en BD (régimen y territorio).
- **Objetivo**: eliminar dos catálogos incrustados cuyos datos YA existen en el esquema activo,
  sin crear tablas y sin tocar RPC/RLS.
- **Hallazgos incluidos**: HC-001, HC-042.
- **Tablas existentes reutilizadas**: `entity_regimes`, `provinces`, `municipalities`.
- **Tablas nuevas**: ninguna.
- **Archivos afectados (estimado)**: `organization-entities.rules.ts`,
  `infrastructure/catalogs.repository.ts`, `organization-entity-dialog.tsx`,
  formularios de persona que usan provincias/municipios, `data/cuba-locations.ts`,
  `data/cuba-locations-full.ts`, repositorio de catálogos de personas. ≤ 10 archivos.
- **Dependencias**: ninguna dura.
- **Riesgos**: bajo (sólo lectura de catálogos; cambia el origen del dato de la UI).
- **Fases**: A (validar que `entity_regimes`/`provinces`/`municipalities` tienen datos y orden
  esperados) → D (adaptar UI) → E (pruebas + retirada de constantes).
- **Pruebas necesarias**: Vitest de reglas de entidad/persona; Playwright de altas con selección
  de régimen y provincia.
- **Criterios de aceptación**: la UI muestra exactamente los mismos valores; TS/Build/Vitest/Playwright
  sin regresiones; constantes eliminadas sin consumidores.
- **Reversión**: revertir el commit (no hay cambio de BD).

---

## BLOQUE 37 — Consolidación de duplicaciones internas (sin BD)

- **Objetivo**: eliminar duplicaciones de literales y constantes repetidas antes de tocar la BD.
- **Hallazgos**: HC-006 (etiquetas de fallback duplicadas), HC-039/HC-029/HC-044/HC-054 (límite 10 MB
  y extensiones), HC-040/HC-016/HC-053 (patrón de identificación 11 dígitos), HC-062 (etiquetas de
  campos de anexo).
- **Tablas**: ninguna.
- **Archivos**: `lib/documents.ts`, `document-templates/domain/entities.ts`,
  `medical-certificates/domain/rules.ts`, `MedicalCertificateFormDialog.tsx`,
  `worker-migration.workbook.ts`, `ExcelImportDialog.tsx`, `utils/ci.ts`,
  `worker-migration.rules.ts`, `organization-structure/domain/rules.ts`, `catalogs.repository.ts`. ≤ 12.
- **Riesgos**: bajo (refactor de constantes).
- **Pruebas**: Vitest de validadores; Playwright de subida de archivos y migración.
- **Aceptación**: una única fuente por concepto; sin cambios de comportamiento.

---

## BLOQUE 38 — Registro documental: consolidar variables (HC-026)

- **Objetivo**: dejar `document_variables` (BD) como fuente única y hacer que el frontend lea de ahí.
- **Tabla existente**: `document_variables`.
- **Archivos**: `document-templates/domain/document-variables.ts`,
  `document-generation/domain/document-resolution.rules.ts`, paneles de variables, repositorios. ≤ 15.
- **Riesgo**: alto (catálogo central duplicado).
- **Fases**: A (comparar catálogo código ↔ tabla; definir estrategia de sincronía) → C/B (seed/ajuste)
  → D (UI lee BD) → E (retirada del array).
- **Pruebas**: Vitest de resolución documental; Playwright de selección/validación de variables.
- **Aceptación**: la validación backend y el selector UI usan la MISMA lista.
- **Reversión**: mantener el array temporalmente tras un flag de compatibilidad si se decide.

---

## BLOQUE 39 — Parámetros de negocio P1 (FASE B + C + D + E)

Dividido en dos etapas para no dejar el sistema inconsistente (UI y RPC deben cambiar juntos).

**39.1 — Esquema y datos (FASE B/C)**
- Tablas nuevas: `prenomina_rate_parameters`, `contract_alert_settings`, `vacation_policy_settings`,
  `report_age_buckets` (seed con valores actuales).
- RLS conceptual reutilizando `can_access_entity` / `has_platform_permission`.
- Hallazgos: HC-031, HC-021/HC-055, HC-050, HC-035.

**39.2 — Adaptación de código y RPC (FASE D/E)**
- RPC a adaptar: `prenomina_night_rate_23_07`, `prenomina_night_rate_19_23`,
  `prenomina_monthly_hours_divisor`, `prenomina_recalc_entry`, `contract_expiry_alerts`,
  `register_worker_vacation`, `vacation_target_annual`, `adjust_worker_vacation_balance`,
  `set_worker_vacation_opening_balance`, `report_worker_demographics`.
- Frontend: `payroll-preparation/domain/rules.ts`, `contract-alerts.rules.ts`,
  `entity-summary/domain/rules.ts`.
- **Riesgo**: alto (afecta importes de nómina y topes de vacaciones). Debe ir en pasos pequeños.
- **Pruebas**: Vitest de cálculo (mismos importes con parámetros por defecto); Playwright de
  prenómina, vencimientos, vacaciones e informes.
- **Aceptación**: idénticos resultados con los parámetros seed; los umbrales dejan de estar dispersos.
- **Reversión**: los seeds reproducen el comportamiento actual; revertir commit + datos seed.

---

## BLOQUE 40 — Compensación: catálogo de conceptos retributivos (HC-020)

- **Tabla nueva**: `compensation_component_types` (global).
- **Archivos**: `compensation.rules.ts`, `ContractConditionsFields.tsx`, resúmenes, repositorio. ≤ 8.
- **Riesgo**: medio. **Pruebas**: Vitest + Playwright de contrato/anexo.
- **Aceptación**: mismo vocabulario; la UI lee de BD.

---

## BLOQUE 41 — Control de acceso: flag de ámbito de permisos (HC-037) [SEGURIDAD]

- **Columna nueva**: `is_internal_scope` en `company_client_permissions`.
- **RPC a adaptar**: `ensure_entity_administrator_role`, `grant_company_client_permission_to_system_roles`,
  `list_entity_permissions`, `save_entity_role`.
- **Riesgo**: ALTO (toca autorización). Requiere bloque de seguridad propio y revisión de RLS.
- **Recomendación**: NO adelantar este bloque; hacerlo con validación de seguridad dedicada.

---

## BLOQUE 42 — education_levels: flag `requires_specialty` (HC-011)

- **Columna nueva**: en `education_levels`; retirar `SPECIALTY_EDUCATION_LEVELS`.
- **Archivos**: `people/domain/rules.ts`, catálogos, formularios. ≤ 6. **Riesgo**: medio.

---

## BLOQUE 43 — Datos de prueba en la base (HC-048) [P0 — INVESTIGACIÓN]

- **Objetivo**: determinar si los registros de `20260922_02` / `20260922_04` siguen en la base
  conectada y, en su caso, planificar su retirada segura.
- **Naturaleza**: NO es migración de código; es saneamiento de datos. Requiere confirmación de
  negocio. **No debe mezclarse** con los bloques de catálogos.
- **Riesgo**: alto (roles/usuarios de prueba pueden conceder acceso real).

---

## Priorización (resumen)

| Prioridad | Hallazgos |
|-----------|-----------|
| **P0** | HC-048 (datos de prueba) |
| **P1** | HC-001, HC-011, HC-020, HC-021, HC-026, HC-031, HC-035, HC-037, HC-039, HC-042, HC-050, HC-055 |
| **P2** | HC-007, HC-014, HC-016, HC-022, HC-023, HC-024, HC-029, HC-036, HC-040, HC-044, HC-051, HC-052, HC-053, HC-054, HC-056, HC-057, HC-061, HC-062, HC-064 |
| **P3** | Resto (C/D de bajo impacto) |

> No se prioriza por número de ocurrencias: HC-048 es P0 por riesgo aunque sea sólo 2 archivos;
> HC-039 es P1 por duplicación transversal aunque el cambio sea pequeño.

---

## BLOQUE 44 — Consolidación de duplicaciones P1 detectadas en la ampliación

- **Objetivo**: unificar en una sola fuente las constantes repetidas entre frontend y RPC.
- **Hallazgos**: HC-068 (tramos de edad: 3.ª copia en `people/domain/tenure.rules.ts`),
  HC-069 (topes de vacaciones en `vacations/domain/rules.ts`), HC-071 (moneda `"CUP"` en ~15 puntos).
- **Tablas**: reutiliza `report_age_buckets`, `vacation_policy_settings` (del Bloque 39) y
  `salary_scales.currency_code`.
- **Archivos**: `people/domain/tenure.rules.ts`, `entity-summary/domain/rules.ts`,
  `vacations-licenses/vacations/domain/rules.ts`, `payroll-preparation/domain/formatters.ts`,
  `EntityPrenomina.tsx`, `WorkerPrenominaDialog.tsx`, `EntitySettingsSalary.tsx`,
  `AdminSettingsSalaryScale.tsx`, `contracts/presentation/components/*`. ≤ 15 archivos.
- **Dependencia**: **debe coordinarse con el Bloque 39** (misma fuente de parámetros).
- **Riesgo**: medio (afecta cálculos mostrados). **Pruebas**: Vitest + Playwright de prenómina,
  vacaciones, informes y contratos.
- **Reversión**: seeds/constantes reproducen los valores actuales.

## BLOQUE 45 — Categorías académicas (HC-065 / HC-066 / HC-073) [DECISIÓN DE NEGOCIO]

- **Objetivo**: decidir si el vocabulario académico se mantiene cerrado (código) o se cataloga.
- **Naturaleza**: **Fase A (diseño)**; sólo si el negocio prevé más categorías, Fase B crea
  `academic_categories` y migra el CHECK a FK.
- **Si se decide mantener cerrado**: cerrar el bloque como “no migrar” y documentar HC-065/HC-073
  como categoría C.
- **Riesgo**: alto si se toca la regla Doctor>Máster o los snapshots; **prohibido** recalcular
  históricos.
- **Recomendación**: NO ejecutar sin decisión explícita de negocio.

---

## Orden recomendado de implementación

1. **Bloque 43 (investigar HC-048)** — primero por ser P0 de riesgo, aunque sea sólo diagnóstico.
2. **Bloque 36** — catálogos existentes (bajo riesgo, alto valor).
3. **Bloque 37** — consolidación interna (sin BD).
4. **Bloque 38** — variables documentales.
5. **Bloque 39** — parámetros P1 (prenómina/alertas/vacaciones/edad).
6. **Bloque 44** — consolidación de duplicaciones (edad/vacaciones/moneda) tras el 39.
7. **Bloque 40** — conceptos retributivos.
8. **Bloque 42** — education_levels.
9. **Bloque 45** — categorías académicas (sólo con decisión de negocio).
10. **Bloque 41** — flag de permisos (último por ser sensible en seguridad).

---

## Riesgos transversales y estrategia de reversión

- **Divergencia UI↔BD** mientras un parámetro siga en dos sitios: mitigar cambiando UI y RPC en el
  mismo bloque.
- **RPC `SECURITY DEFINER`**: cualquier cambio debe preservar `can_access_entity` y el aislamiento.
- **Datos históricos**: los catálogos no se borran (sólo `is_active`); los movimientos/contratos
  conservan snapshots.
- **Comportamiento sin conexión**: no aplica (la app ya depende de Supabase).
- **Reversión**: cada bloque es un commit restaurable; los seeds reproducen el estado previo
  (idénticos valores), por lo que revertir código+seed restaura el comportamiento actual.
