# 05 — Resumen ejecutivo

> **Bloque 35 — Auditoría integral de hardcoding y plan de normalización hacia Supabase.**
> Auditoría de SOLO LECTURA sobre el código real (`src/`) y el esquema activo de Supabase.
> Ninguna modificación de código, base de datos, migraciones, RLS, RPC o datos. Ninguna operación Git.

---

## 1. Métricas de la auditoría

| Métrica | Valor |
|---------|-------|
| Archivos revisados (lectura directa + búsqueda sistemática) | ~460 archivos bajo `src/` |
| Tablas del esquema activo observadas | 76 |
| Funciones RPC observadas | cientos (relevantes para el análisis: ~50) |
| **Hallazgos (conceptos únicos)** | **79** (HC-001 … HC-079) |
| — añadidos en la ampliación | 14 (HC-065 … HC-078) |
| — añadido en la verificación de seguridad | 1 (HC-079) |
| — ampliados (mismo concepto, nuevas ubicaciones) | 3 (HC-035, HC-050, HC-052) |
| **Ocurrencias físicas** | > 100 (varias constantes duplicadas en 2–6 sitios) |
| **Candidatos a base de datos (A/B)** | 16 confirmados + 5 a confirmar por investigación |
| **Tablas existentes reutilizables** | 6 + 6 del subsistema salarial/académico ya modelado |
| **Tablas nuevas propuestas** | 5 firmes + 2 condicionadas a investigación |
| **Hallazgos que permanecen en código (C)** | 29 |
| **Hallazgos de internacionalización (D)** | 13 |
| **Hallazgos a eliminar/consolidar (E)** | 15 |
| **Hallazgos que requieren investigación (F)** | 12 |

> **Sobre la suma de categorías**: las categorías **no son mutuamente excluyentes**; un hallazgo
> puede llevar varias (HC-001=A/E, HC-021=B/D, HC-026=E/A, HC-039=E/B, HC-065=A/F…). Por eso la
> suma por categorías **supera** el número de conceptos únicos. En la versión inicial la suma era
> 67 frente a 64 conceptos; no era un error de conteo sino solapamiento de etiquetas.

---

## 2. Distribución por módulos

| Módulo | Hallazgos | Ejemplos |
|--------|-----------|----------|
| Estructura organizativa | HC-002…HC-010 | régimen, tipos de entidad, cabeceras Anexo 14 |
| Personas | HC-011…HC-019 | especialidad por nombre, migración, mensajes |
| Contratos | HC-020…HC-025 | conceptos retributivos, alertas, anexos |
| Generación/Plantillas documentales | HC-026…HC-030 | catálogo de variables, límites de archivo |
| Prenómina | HC-031…HC-034 | tarifas nocturnidad, divisor, tramos |
| Resumen de entidad | HC-035 | tramos de edad |
| Control de acceso | HC-036…HC-038 | etiquetas/agrupación de permisos, patrón legacy |
| Compartido / lib / utils | HC-039…HC-045 | tamaño de archivo, CI, romanos, provincias |
| Supabase / Config | HC-046…HC-049 | cliente, frontera de nomenclatura, mocks de test |
| Reglas en RPC de BD | HC-050…HC-064 | topes de vacaciones, representantes, moneda, umbrales |
| Académico (ampliación) | HC-065…HC-067, HC-073 | vocabulario MASTER/DOCTOR, prioridad, etiquetas |
| Salarial (ampliación) | HC-070…HC-072, HC-076 | alcance, régimen, moneda, textos de escala |
| Antigüedad (ampliación) | HC-077, HC-078 | unidades y validaciones de la escala de antigüedad |
| Resoluciones (módulo no cubierto antes) | HC-074 | mensajes de plantilla |
| Vacaciones (ampliación) | HC-069 | topes 24/15 |

---

## 3. Distribución por categorías

Recordatorio: **categorías solapadas**; un hallazgo puede aparecer en varias listas.

- **A (migrar a tabla)**: HC-001, HC-011, HC-020, HC-026, HC-042, HC-050, HC-057, HC-065 (candidatos).
- **B (configuración en BD)**: HC-021, HC-031, HC-035, HC-039, HC-050, HC-051, HC-052, HC-055,
  HC-056, HC-064, HC-068, HC-069, HC-071, HC-073.
- **C (mantener en código)**: 24 originales + HC-066, HC-070, HC-072, HC-077, HC-078.
- **D (internacionalización)**: HC-004, HC-005, HC-006, HC-015, HC-017, HC-023, HC-032, HC-036,
  HC-059, HC-067, HC-074, HC-075, HC-076.
- **E (eliminar/consolidar)**: HC-006, HC-026, HC-029, HC-039, HC-040, HC-042, HC-048, HC-053,
  HC-054, HC-062, HC-068, HC-069, HC-071, HC-072, HC-076, HC-079.
- **F (investigar)**: HC-014, HC-022, HC-024, HC-036, HC-046, HC-057, HC-061, HC-064, HC-065,
  HC-066, HC-073, HC-075.

---

## 4. Principales casos de hardcoding (evidencia)

1. **Catálogo documental duplicado (HC-026)**: el array `DOCUMENT_VARIABLES` del código coexiste con
   la tabla `document_variables` que la RPC de análisis YA consulta → dos fuentes de verdad.
2. **Tarifas y divisor de prenómina (HC-031)**: `190.6`, `0.6`, `1.15` están en el frontend y en
   `prenomina_monthly_hours_divisor()`, `prenomina_night_rate_19_23()`, `prenomina_night_rate_23_07()`.
3. **Regla de especialidad por texto (HC-011)**: `["Obrero Calificado","Técnico Medio","Superior"]`
   compara por nombre del catálogo `education_levels`.
4. **Umbrales de vencimiento (HC-021/HC-055)**: 7/15/30 y horizonte 30 en frontend y en
   `contract_expiry_alerts`.
5. **Topes de vacaciones (HC-050)**: 24 y 15 en 4 RPC y en la migración del frontend.
6. **Catálogos territoriales (HC-042)**: provincias/municipios estáticos frente a las tablas
   `provinces`/`municipalities`.
7. **Datos de prueba aplicados (HC-048)** — **verificado (Bloque 35.1)**: persisten `TENANT-A`,
   entidades de prueba (`GRUPO-A`, `EMPRESA-A/B`, `UEB-A1/A2`) y roles de prueba (`RRHH Test`,
   `Viewer`×2, `HR Manager`) activos; existe una cuenta `admin` activa con rol **`SuperAdmin`**.
   (`isael` y `Platform Test` ya no existen.) **HC-079**: contraseña por defecto `temp1234!`.

---

## 5. Riesgos críticos identificados

- **P1 — HC-048 (confirmado, Bloque 35.1)**: existe una cuenta `admin` **activa con rol `SuperAdmin`**
  y datos/roles de prueba en la base conectada. **No** es P0: no hay bypass de autenticación ni de
  RLS y no se demostró acceso no autorizado; se desconoce si el entorno es producción.
- **P1 — HC-079 (nuevo)**: contraseña por defecto hardcodeada `temp1234!` en la Edge Function
  `create-sitecorp-user` y en el panel `PlatformUsers` (creación de usuarios de plataforma).
  Su existencia en producción **no está verificada** (nivel N4).
- **Seguridad — HC-037**: la regla de exclusión de permisos legacy está replicada como regex en 5+
  RPC; un cambio debe hacerse con diseño de seguridad dedicado.
- **Integridad de datos — HC-031 / HC-050**: si se configuran en un solo lado (UI o BD), se producen
  discrepancias en importes salariales y topes de vacaciones.
- **Divergencia de contrato — HC-026 / HC-021 / HC-035**: umbrales y catálogos repartidos entre
  frontend y RPC.

---

## 6. Tablas existentes reutilizables y tablas nuevas

**Reutilizables** (no crear): `entity_regimes`, `provinces`, `municipalities`, `document_variables`,
`education_levels` (+columna), `company_client_permissions` (+columna).

**Nuevas propuestas**: `compensation_component_types`, `prenomina_rate_parameters`,
`vacation_policy_settings`, `contract_alert_settings`, `report_age_buckets`; condicionadas:
`document_settings`, `compensation_addendum_reason_codes`.

---

## 7. Beneficios esperados

- Una única fuente de verdad para catálogos y parámetros (fin de divergencias UI↔BD).
- Configurabilidad por organización/entidad sin despliegue de código.
- Reducción del riesgo de autorización (HC-037) y de datos de prueba (HC-048).
- Código más simple (menos constantes duplicadas y menos literales dispersos).

---

## 8. Orden recomendado

1. Bloque 43 (investigar HC-048) · 2. Bloque 36 (catálogos existentes) · 3. Bloque 37 (consolidación)
· 4. Bloque 38 (variables documentales) · 5. Bloque 39 (parámetros P1) · 6. Bloque 40 (conceptos)
· 7. Bloque 42 (education_levels) · 8. Bloque 41 (flag de permisos).

---

## 9. Trazabilidad hallazgo → propuesta → bloque

| Hallazgo | Propuesta | Bloque |
|----------|-----------|--------|
| HC-001 | leer `entity_regimes` | 36 |
| HC-011 | columna `education_levels.requires_specialty` | 42 |
| HC-020 | tabla `compensation_component_types` | 40 |
| HC-021 | tabla `contract_alert_settings` | 39 |
| HC-024 | tabla `compensation_addendum_reason_codes` [F] | (investigación) |
| HC-026 | consolidar en `document_variables` | 38 |
| HC-029/HC-039/HC-044/HC-054 | constante única de tamaño de archivo | 37 |
| HC-021/HC-055 | `contract_alert_settings` (UI+RPC) | 39 |
| HC-031 | tabla `prenomina_rate_parameters` | 39 |
| HC-035 | tabla `report_age_buckets` | 39 |
| HC-037 | flag `is_internal_scope` + RPC | 41 |
| HC-040/HC-016/HC-053 | constante única de identificación | 37 |
| HC-042 | leer `provinces`/`municipalities` | 36 |
| HC-048 | saneamiento de datos de prueba (P1 confirmado) | 43 |
| HC-079 | eliminar credencial por defecto `temp1234!` | 46 |
| HC-050 | tabla `vacation_policy_settings` | 39 |
| HC-051 | parámetro de representantes [decisión] | (investigación) |
| HC-052 | default de moneda desde `salary_scales` | 39 |
| HC-057 | catálogo académico [F] | (investigación) |
| HC-062 | consolidar etiquetas de anexo | 37 |
| HC-014/HC-022/HC-046/HC-061/HC-064 | investigación previa | (Fase A) |

Resto (C/D) no requiere migración a BD: permanece en código o pasa a i18n.

---

## 9.1 Trazabilidad de la ampliación (hallazgo → propuesta → bloque)

| Hallazgo | Propuesta | Bloque |
|----------|-----------|--------|
| HC-065 | `academic_categories` (condicional) o mantener cerrado | 45 |
| HC-066 | mantener regla Doctor>Máster en código | 45 |
| HC-067 | i18n de etiquetas académicas | (transversal D) |
| HC-068 | unificar tramos de edad (con HC-035) | 44 (con 39) |
| HC-069 | unificar topes de vacaciones (con HC-050) | 44 (con 39) |
| HC-070 | mantener contrato de alcance | 45 |
| HC-071 | centralizar moneda por defecto (con HC-052) | 44 (con 39) |
| HC-072 | derivar `regime_id` de `entity_regimes` | 36/44 |
| HC-073 | decidir fijo vs configurable | 45 |
| HC-074 | i18n mensajes Resoluciones | (transversal D) |
| HC-075 | etiquetas de `change_type` (sincronizar con BD) | 40/44 |
| HC-076 | textos de descripción de escala | 44 |
| HC-077 | etiquetas unidades antigüedad | (transversal D) |
| HC-078 | validaciones antigüedad (mantener) | — |

## 9.2 Diagnóstico académico y salarial (síntesis)

- **Escalas salariales e importes académicos YA están en BD** (`salary_scales`, `salary_groups`,
  `salary_group_values`, `academic_category_payments`, `tenure_payment_scales`) con histórico por
  vigencia y RLS. **No requieren tablas nuevas.** El único candidato es el vocabulario de
  **categorías académicas** (`academic_categories`), **condicional** a decisión de negocio.
- El frontend **no hardcodea importes**: sólo contratos técnicos (alcance, régimen, moneda) y textos.
- **Reglas a conservar**: prioridad Doctor>Máster, cálculo de antigüedad y cálculo de prenómina.
- **Riesgo histórico**: los snapshots de prenómina y el histórico de `salary_group_values` NO deben
  recalcularse.

## 10. Limitaciones de esta auditoría

- No se ejecutó ningún comando (sin shell/runner): no se pudo compilar, ni correr Vitest/Playwright,
  ni consultar filas de la base. Los conteos de archivos/líneas provienen de lectura y búsqueda directa.
- La **existencia real en producción** de los datos de prueba (HC-048) y de las tablas con
  nomenclatura legacy de las migraciones locales **no se verificó** (marcada N2/N4).
- Se distinguieron mocks de test (UUID ficticios en `__tests__`, HC-049) de datos simulados
  aplicados a la base (HC-048).
- No se proponen tablas para textos de UI, algoritmos, contratos técnicos ni navegación.

---

## 11. Confirmaciones finales

- **No se modificó código ni base de datos**: la única escritura han sido los cinco documentos
  Markdown en `docs/auditoria-hardcoding/`.
- **No se ejecutó Git**: ni commit, ni push, ni merge, ni rama, ni despliegue.
- **No se inició el Bloque 36 ni ninguna implementación**: este bloque es exclusivamente auditoría.

**Fin de la auditoría. Se espera autorización expresa antes de modificar código o base de datos.**
