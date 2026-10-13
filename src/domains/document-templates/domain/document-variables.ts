/**
 * Plantillas documentales — Catálogo de variables documentales (dominio).
 *
 * Fase 11A.7 — Registro central de variables documentales.
 *
 *   DATOS DEL NEGOCIO → RESOLUCIÓN DOCUMENTAL (SQL) → VARIABLES (este archivo) → PLANTILLA DOCX (11B.1)
 *
 * Las keys son la API interna documental de SiteCorp: una plantilla NUNCA sabe
 * de qué tablas viene la información, sólo solicita una key estable
 * (`worker.full_name`, `entity.revolution_year`, …).
 *
 * Este archivo NO genera documentos: sólo DESCRIBE el catálogo y FORMATEA sus valores.
 * La RESOLUCIÓN de esas variables a partir de un snapshot vive en el dominio de generación
 * documental (`@/domains/document-generation/domain/document-resolution.rules.ts`), que
 * consume este catálogo. La dependencia va en un solo sentido (generación → plantillas, que
 * ya existía), de modo que no puede formarse ningún ciclo entre los dos dominios.
 *
 * Los paneles de plantilla (variables y archivos) y los ajustes de la entidad leen el
 * catálogo y los formatos a través del barrel público de este dominio.
 */

export type DocumentTypeCode = "CONTRACT" | "ADDENDUM" | "SC_4_04" | "RESOLUTION" | "PAYROLL_MOVEMENT"

export type DocumentVariableDataType = "text" | "integer" | "amount" | "date" | "hours"

/** SOURCE: proviene de datos/snapshots. CALCULATED: se deriva de otros datos (nunca se persiste). */
export type DocumentVariableKind = "SOURCE" | "CALCULATED"

export interface DocumentVariableDefinition {
  key: string
  label: string
  category:
    | "Entidad"
    | "Representante"
    | "Trabajador"
    | "Cargo y Puesto"
    | "Jornada"
    | "Contrato"
    | "Retribución"
    | "Anexo"
    | "SC-4-04"
    | "Resolución"
    | "Movimiento de Nómina"
    | "Vacaciones"
    | "Certificado médico"
    | "Documento"
  documentTypes: DocumentTypeCode[]
  /**
   * Tipos documentales en los que la variable se RESUELVE pero permanece
   * OCULTA del catálogo/selector visible (aislamiento SC-4-04, §Fase 22:
   * el selector de SC_4_04 muestra exclusivamente variables sc404.*).
   */
  catalogHiddenFor?: DocumentTypeCode[]
  dataType: DocumentVariableDataType
  kind: DocumentVariableKind
  description: string
}

export interface DocumentVariableResolution {
  status: "value" | "missing"
  value: string | null
}

const BOTH: DocumentTypeCode[] = ["CONTRACT", "ADDENDUM"]
/** Variables comunes reutilizadas también por el modelo SC-4-04. */
const WITH_SC404: DocumentTypeCode[] = ["CONTRACT", "ADDENDUM", "SC_4_04"]

/**
 * Variables comunes que SC-4-04 sigue RESOLVIENDO (compatibilidad de plantillas
 * legacy, §Fase 22) pero que quedan OCULTAS del selector visible: el modelo
 * SC-4-04 expone exclusivamente variables sc404.* y s.*.
 */
const SC404_INTERNAL = ["SC_4_04"] as DocumentTypeCode[]

/**
 * Variables que quedan OCULTAS del selector de Contrato y Anexo, pero que
 * siguen resolviéndose para compatibilidad con plantillas legacy.
 * El selector de Contrato muestra exclusivamente variables c.*;
 * el selector de Anexo muestra exclusivamente variables a.*.
 */
const CONTRACT_HIDDEN = ["CONTRACT"] as DocumentTypeCode[]
const ADDENDUM_HIDDEN = ["ADDENDUM"] as DocumentTypeCode[]
const ALL_DOC_TYPES = ["CONTRACT", "ADDENDUM", "SC_4_04"] as DocumentTypeCode[]

/** Catálogo global de variables documentales (no pertenece a ningún tenant). */
export const DOCUMENT_VARIABLES: DocumentVariableDefinition[] = [
  // ---------------- Entidad ----------------
  { key: "entity.name", label: "Nombre de la entidad", category: "Entidad", documentTypes: WITH_SC404, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Snapshot contractual de la entidad firmante." },
  { key: "entity.organism", label: "Organismo", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Organismo al que pertenece la entidad (snapshot)." },
  { key: "entity.branch", label: "Rama", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Rama de la entidad (snapshot)." },
  { key: "entity.labor_code", label: "Código laboral/organizacional", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Código de identificación laboral (snapshot)." },
  { key: "entity.address", label: "Dirección de la entidad", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Dirección de la entidad (snapshot)." },
  { key: "entity.province", label: "Provincia de la entidad", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Provincia de la entidad (snapshot)." },
  { key: "entity.municipality", label: "Municipio de la entidad", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Municipio de la entidad (snapshot)." },
  { key: "entity.revolution_year", label: "Año de la Revolución", category: "Entidad", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Valor institucional configurado por entidad (texto libre, p. ej. 68) y preservado en el snapshot (nunca se calcula)." },

  // ---------------- Representante ----------------
  { key: "representative.name", label: "Nombre del representante", category: "Representante", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Representante histórico que suscribió el documento (snapshot)." },
  { key: "representative.position", label: "Cargo del representante", category: "Representante", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Cargo del representante histórico (snapshot)." },

  // ---------------- Trabajador ----------------
  { key: "worker.full_name", label: "Nombre completo", category: "Trabajador", documentTypes: WITH_SC404, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Nombre y apellidos del trabajador." },
  { key: "worker.identification", label: "Carné de identidad", category: "Trabajador", documentTypes: WITH_SC404, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Carné de identidad del trabajador." },
  { key: "worker.birth_date", label: "Fecha de nacimiento", category: "Trabajador", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "date", kind: "SOURCE", description: "Fecha de nacimiento del trabajador." },
  { key: "worker.profession", label: "Profesión u oficio", category: "Trabajador", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Profesión u oficio (dato profesional, no nivel de estudios)." },
  { key: "worker.address", label: "Dirección del trabajador", category: "Trabajador", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Dirección particular del trabajador." },
  { key: "worker.province", label: "Provincia del trabajador", category: "Trabajador", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Provincia de residencia del trabajador." },
  { key: "worker.municipality", label: "Municipio del trabajador", category: "Trabajador", documentTypes: BOTH, catalogHiddenFor: ALL_DOC_TYPES, dataType: "text", kind: "SOURCE", description: "Municipio de residencia del trabajador." },

  // ---------------- Cargo y Puesto ----------------
  { key: "job.name", label: "Cargo", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Cargo del trabajador según condiciones formalizadas vigentes." },
  { key: "job.salary_group", label: "Grupo salarial", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Grupo salarial en números romanos (p. ej. XII)." },
  { key: "job.occupational_category", label: "Categoría ocupacional", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Categoría ocupacional del cargo." },
  { key: "position.name", label: "Puesto de trabajo", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Puesto que ocupa el trabajador." },
  { key: "position.code", label: "Código del puesto", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Código del puesto formalizado (tras anexos de cambio de puesto)." },
  { key: "position.work_location", label: "Lugar de trabajo", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Lugar de trabajo según condiciones formalizadas." },

  // ---------------- Jornada ----------------
  { key: "schedule.daily_hours", label: "Horas diarias", category: "Jornada", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "hours", kind: "SOURCE", description: "Horas de trabajo al día." },
  { key: "schedule.weekly_hours", label: "Horas semanales", category: "Jornada", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "hours", kind: "SOURCE", description: "Horas de trabajo a la semana." },
  { key: "schedule.monthly_hours", label: "Horas mensuales", category: "Jornada", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "hours", kind: "SOURCE", description: "Horas de trabajo al mes." },
  { key: "schedule.text", label: "Horario", category: "Jornada", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Horario / jornada en texto (del puesto o sus segmentos)." },
  { key: "schedule.break", label: "Descanso", category: "Jornada", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "integer", kind: "SOURCE", description: "Minutos de descanso dentro de la jornada." },

  // ---------------- Contrato ----------------
  { key: "contract.type", label: "Tipo de contrato", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Nombre del tipo de contrato (determinado / indeterminado)." },
  { key: "contract.start_date", label: "Fecha de inicio", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "date", kind: "SOURCE", description: "Fecha de inicio del contrato." },
  { key: "contract.end_date", label: "Fecha de fin", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "date", kind: "SOURCE", description: "Fecha de fin prevista (contrato por tiempo determinado)." },
  { key: "contract.duration", label: "Duración", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "CALCULATED", description: "Duración humana calculada a partir de start_date y end_date (p. ej. «6 meses»)." },
  { key: "contract.signature_date", label: "Fecha de firma", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "date", kind: "SOURCE", description: "Fecha de firma del contrato." },
  { key: "contract.signature_day", label: "Día de firma", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "integer", kind: "CALCULATED", description: "Día de la fecha de firma (calculado, no se persiste)." },
  { key: "contract.signature_month", label: "Mes de firma", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "CALCULATED", description: "Mes de la fecha de firma en español (calculado, no se persiste)." },
  { key: "contract.signature_year", label: "Año de firma", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "integer", kind: "CALCULATED", description: "Año de la fecha de firma (calculado, no se persiste)." },
  { key: "contract.signature_place", label: "Lugar de firma", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Lugar/municipio de firma." },
  { key: "contract.payment_method", label: "Forma de pago", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Forma de pago (A tiempo / A rendimiento), incluidos anexos formalizados." },
  { key: "contract.payment_schedule", label: "Día / momento de pago", category: "Contrato", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Día o momento de pago (p. ej. «Día 10 de cada mes»), incluidos anexos formalizados." },

  // ---------------- Retribución ----------------
  { key: "compensation.base_salary", label: "Salario de escala", category: "Retribución", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Salario de escala formalizado vigente." },
  { key: "compensation.additional_payments", label: "Pagos adicionales", category: "Retribución", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Suma de pagos adicionales formalizados." },
  { key: "compensation.abnormal_conditions_payments", label: "Pagos por condiciones anormales", category: "Retribución", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Suma de pagos por condiciones laborales anormales." },
  { key: "compensation.other_payments", label: "Otros pagos", category: "Retribución", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Suma de otros pagos del contrato." },
  { key: "compensation.total", label: "Total contractual", category: "Retribución", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Total contractual formalizado (salario + conceptos)." },
  { key: "compensation.currency", label: "Moneda", category: "Retribución", documentTypes: ["CONTRACT"], catalogHiddenFor: CONTRACT_HIDDEN, dataType: "text", kind: "SOURCE", description: "Moneda de la retribución (p. ej. CUP)." },

  // ---------------- Anexo ----------------
  { key: "addendum.number", label: "Número de anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "integer", kind: "SOURCE", description: "Numeración secuencial del anexo dentro del contrato." },
  { key: "addendum.reason", label: "Motivo del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Motivo legible del anexo." },
  { key: "addendum.effective_date", label: "Fecha efectiva", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "date", kind: "SOURCE", description: "Fecha desde la cual aplican las nuevas condiciones." },
  { key: "addendum.signature_date", label: "Fecha de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "date", kind: "SOURCE", description: "Fecha de firma del anexo." },
  { key: "addendum.signature_day", label: "Día de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "integer", kind: "CALCULATED", description: "Día de la fecha de firma del anexo (calculado)." },
  { key: "addendum.signature_month", label: "Mes de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "CALCULATED", description: "Mes de la fecha de firma del anexo en español (calculado)." },
  { key: "addendum.signature_year", label: "Año de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "integer", kind: "CALCULATED", description: "Año de la fecha de firma del anexo (calculado)." },
  { key: "addendum.signature_place", label: "Lugar de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Lugar de firma del anexo." },

  { key: "addendum.previous.job", label: "Cargo anterior", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Cargo anterior según el snapshot del anexo." },
  { key: "addendum.previous.salary_group", label: "Grupo salarial anterior", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Grupo salarial anterior según el snapshot del anexo." },
  { key: "addendum.previous.occupational_category", label: "Categoría ocupacional anterior", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Categoría ocupacional anterior según el snapshot." },
  { key: "addendum.previous.salary", label: "Salario anterior", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Salario anterior según el snapshot del anexo." },

  { key: "addendum.new.job", label: "Cargo nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Cargo nuevo según el snapshot del anexo." },
  { key: "addendum.new.salary_group", label: "Grupo salarial nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Grupo salarial nuevo según el snapshot del anexo." },
  { key: "addendum.new.occupational_category", label: "Categoría ocupacional nueva", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "text", kind: "SOURCE", description: "Categoría ocupacional nueva según el snapshot." },
  { key: "addendum.new.salary", label: "Salario nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Salario nuevo según el snapshot del anexo." },
  { key: "addendum.new.other_payments", label: "Otros pagos nuevos", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Otros pagos según el lado «después» del anexo." },
  { key: "addendum.new.total", label: "Total nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], catalogHiddenFor: ADDENDUM_HIDDEN, dataType: "amount", kind: "SOURCE", description: "Total contractual nuevo según el anexo." },

  // ---------------- SC-4-04 (variables unificadas según origen) ----------------
  { key: "sc404.fecha_desde", label: "SC-4-04 · Fecha desde", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "Inicio del período en formato DD/MM/AA. Vacaciones: start_date. Certificado: fecha de salida." },
  { key: "sc404.fecha_hasta", label: "SC-4-04 · Fecha hasta", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "ÚLTIMO día del período en DD/MM/AA. Vacaciones: end_date. Certificado médico: vacío (return_date es reincorporación)." },
  { key: "sc404.dias", label: "SC-4-04 · Días", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "integer", kind: "SOURCE", description: "Vacaciones: DÍAS NATURALES del período (no el consumo del ledger). Certificado: days explícito." },
  { key: "sc404.incorporacion_dia", label: "SC-4-04 · Día de incorporación", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "CALCULATED", description: "Día (1–31) de la fecha de incorporación. Vacaciones: primer día hábil posterior al período según el horario del Puesto. Certificado: día de return_date." },
  { key: "sc404.incorporacion_mes", label: "SC-4-04 · Mes de incorporación", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "CALCULATED", description: "Mes numérico (1–12) de la fecha de incorporación." },
  { key: "sc404.incorporacion_anio", label: "SC-4-04 · Año de incorporación", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "CALCULATED", description: "Año en dos dígitos (AA) de la fecha de incorporación." },
  { key: "certificado.es_licencia_subsidio", label: "Marcador Licencia/Subsidio", category: "SC-4-04", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "CALCULATED", description: "Devuelve «X» cuando el origen es un certificado médico; vacío para vacaciones." },

  // ---------------- Certificado médico (origen, interno) ----------------
  { key: "certificado.fecha_salida", label: "Certificado · Fecha de salida", category: "Certificado médico", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "Fecha de salida del certificado médico en DD/MM/AA." },
  { key: "certificado.fecha_reincorporacion", label: "Certificado · Fecha de reincorporación", category: "Certificado médico", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "return_date del certificado médico en DD/MM/AA." },
  { key: "certificado.dias", label: "Certificado · Días", category: "Certificado médico", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "integer", kind: "SOURCE", description: "Cantidad de días explícita del certificado médico (fuente de verdad)." },

  // ---------------- Vacaciones (origen, interno) ----------------
  { key: "vacaciones.fecha_desde", label: "Vacaciones · Fecha desde", category: "Vacaciones", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "start_date del período de vacaciones en DD/MM/AA." },
  { key: "vacaciones.fecha_hasta", label: "Vacaciones · Fecha hasta", category: "Vacaciones", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "end_date del período de vacaciones en DD/MM/AA." },
  { key: "vacaciones.dias_naturales", label: "Vacaciones · Días naturales", category: "Vacaciones", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "integer", kind: "SOURCE", description: "Días naturales del período (hasta − desde + 1), valor persistido." },
  { key: "vacaciones.dias_consumidos", label: "Vacaciones · Días consumidos", category: "Vacaciones", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "integer", kind: "SOURCE", description: "Días descontados del saldo (días naturales menos domingos)." },
  { key: "vacaciones.reincorporacion", label: "Vacaciones · Incorporación", category: "Vacaciones", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "CALCULATED", description: "Primer día hábil posterior al período según el horario del Puesto (DD/MM/AA)." },

  // ---------------- Comunes SC-4-04 (internos) ----------------
  { key: "area.name", label: "Área", category: "Cargo y Puesto", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "Área del puesto de la asignación vigente al período (asignación → puesto → cargo → área)." },
  { key: "entity.code", label: "Código de la entidad", category: "Entidad", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "SOURCE", description: "organization_entities.code de la entidad real del trabajador." },
  { key: "documento.fecha_emision", label: "Fecha de emisión del documento", category: "Documento", documentTypes: ["SC_4_04"], catalogHiddenFor: SC404_INTERNAL, dataType: "text", kind: "CALCULATED", description: "Fecha (día de la generación) en que se emite el documento, en DD/MM/AA." },

  // ---------------- SC-4-04 · catálogo VISIBLE exclusivo (short aliases s.*) ----------------
  // wrappers s.* de los datos comunes: quien prepara el Word no necesita
  // conocer la estructura interna de SiteCorp (§Fase 22).
  { key: "s.fem", label: "SC-4-04 · Fecha de emisión", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "CALCULATED", description: "Fecha (día de la generación) en que se emite el documento, en DD/MM/AA." },
  { key: "s.ent", label: "SC-4-04 · Nombre de la entidad", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Nombre de la entidad real del trabajador." },
  { key: "s.cod", label: "SC-4-04 · Código de la entidad", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Código (organization_entities.code) de la entidad real del trabajador." },
  { key: "s.nom", label: "SC-4-04 · Nombre del trabajador", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Nombre o nombres del trabajador, sin apellidos." },
  { key: "s.ap1", label: "SC-4-04 · Primer apellido", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Primer apellido del trabajador." },
  { key: "s.ap2", label: "SC-4-04 · Segundo apellido", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Segundo apellido del trabajador." },
  { key: "s.ci", label: "SC-4-04 · Carné de identidad", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Carné de identidad del trabajador." },
  { key: "s.area", label: "SC-4-04 · Área", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Área del puesto de la asignación vigente al período." },
  { key: "s.f_des", label: "SC-4-04 · Fecha desde", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "Inicio del período en formato DD/MM/AA. Vacaciones: start_date. Certificado: fecha de salida." },
  { key: "s.f_has", label: "SC-4-04 · Fecha hasta", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "SOURCE", description: "ÚLTIMO día del período en DD/MM/AA. Vacaciones: end_date. Certificado médico: vacío (return_date es reincorporación)." },
  { key: "s.dias", label: "SC-4-04 · Días", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "integer", kind: "SOURCE", description: "Vacaciones: DÍAS NATURALES del período (no el consumo del ledger). Certificado: days explícito." },
  { key: "s.inc_d", label: "SC-4-04 · Día de incorporación", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "CALCULATED", description: "Día (1–31) de la fecha de incorporación. Vacaciones: primer día hábil posterior al período según el horario del Puesto. Certificado: día de return_date." },
  { key: "s.inc_m", label: "SC-4-04 · Mes de incorporación", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "CALCULATED", description: "Mes numérico (1–12) de la fecha de incorporación." },
  { key: "s.inc_a", label: "SC-4-04 · Año de incorporación", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "CALCULATED", description: "Año en dos dígitos (AA) de la fecha de incorporación." },
  { key: "s.vac", label: "SC-4-04 · Marca de vacaciones", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» cuando el origen es un período de vacaciones; vacío para certificado médico." },
  { key: "s.lic", label: "SC-4-04 · Marca de licencia/subsidio", category: "SC-4-04", documentTypes: ["SC_4_04"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» cuando el origen es un certificado médico; vacío para vacaciones." },

  // ---------------- Contrato · catálogo VISIBLE exclusivo (short aliases c.*) ----------------
  { key: "c.ent", label: "Contrato · Nombre de la entidad", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Nombre de la entidad firmante (snapshot)." },
  { key: "c.org", label: "Contrato · Organismo", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Organismo al que pertenece la entidad (snapshot)." },
  { key: "c.ram", label: "Contrato · Rama", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Rama de la entidad (snapshot)." },
  { key: "c.cod", label: "Contrato · Código laboral", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Código de identificación laboral (snapshot)." },
  { key: "c.dir", label: "Contrato · Dirección de la entidad", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Dirección de la entidad (snapshot)." },
  { key: "c.prov", label: "Contrato · Provincia de la entidad", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Provincia de la entidad (snapshot)." },
  { key: "c.mun", label: "Contrato · Municipio de la entidad", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Municipio de la entidad (snapshot)." },
  { key: "c.rev", label: "Contrato · Año de la Revolución", category: "Entidad", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Valor institucional configurado por entidad (texto libre, p. ej. 68) y preservado en el snapshot (nunca se calcula)." },

  { key: "c.rep_nom", label: "Contrato · Nombre del representante", category: "Representante", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Representante histórico que suscribió el documento (snapshot)." },
  { key: "c.rep_cargo", label: "Contrato · Cargo del representante", category: "Representante", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Cargo del representante histórico (snapshot)." },

  { key: "c.nom", label: "Contrato · Nombre completo", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Nombre y apellidos del trabajador." },
  { key: "c.ci", label: "Contrato · Carné de identidad", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Carné de identidad del trabajador." },
  { key: "c.nac", label: "Contrato · Fecha de nacimiento", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "date", kind: "SOURCE", description: "Fecha de nacimiento del trabajador." },
  { key: "c.prof", label: "Contrato · Profesión u oficio", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Profesión u oficio (dato profesional, no nivel de estudios)." },
  { key: "c.dir_trab", label: "Contrato · Dirección del trabajador", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Dirección particular del trabajador." },
  { key: "c.prov_trab", label: "Contrato · Provincia del trabajador", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Provincia de residencia del trabajador." },
  { key: "c.mun_trab", label: "Contrato · Municipio del trabajador", category: "Trabajador", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Municipio de residencia del trabajador." },

  { key: "c.cargo", label: "Contrato · Cargo", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Cargo del trabajador según condiciones formalizadas vigentes." },
  { key: "c.grupo", label: "Contrato · Grupo salarial", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Grupo salarial en números romanos (p. ej. XII)." },
  { key: "c.cat_ocup", label: "Contrato · Categoría ocupacional", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Categoría ocupacional del cargo." },
  { key: "c.puesto", label: "Contrato · Puesto de trabajo", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Puesto que ocupa el trabajador." },
  { key: "c.cod_puesto", label: "Contrato · Código del puesto", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Código del puesto formalizado (tras anexos de cambio de puesto)." },
  { key: "c.lug_trab", label: "Contrato · Lugar de trabajo", category: "Cargo y Puesto", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Lugar de trabajo según condiciones formalizadas." },

  { key: "c.horas_dia", label: "Contrato · Horas diarias", category: "Jornada", documentTypes: ["CONTRACT"], dataType: "hours", kind: "SOURCE", description: "Horas de trabajo al día." },
  { key: "c.horas_sem", label: "Contrato · Horas semanales", category: "Jornada", documentTypes: ["CONTRACT"], dataType: "hours", kind: "SOURCE", description: "Horas de trabajo a la semana." },
  { key: "c.horas_mes", label: "Contrato · Horas mensuales", category: "Jornada", documentTypes: ["CONTRACT"], dataType: "hours", kind: "SOURCE", description: "Horas de trabajo al mes." },
  { key: "c.horario", label: "Contrato · Horario", category: "Jornada", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Horario / jornada en texto (del puesto o sus segmentos)." },
  { key: "c.descanso", label: "Contrato · Descanso", category: "Jornada", documentTypes: ["CONTRACT"], dataType: "integer", kind: "SOURCE", description: "Minutos de descanso dentro de la jornada." },

  { key: "c.tipo", label: "Contrato · Tipo de contrato", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Nombre del tipo de contrato (determinado / indeterminado)." },
  { key: "c.inicio", label: "Contrato · Fecha de inicio", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "date", kind: "SOURCE", description: "Fecha de inicio del contrato." },
  { key: "c.fin", label: "Contrato · Fecha de fin", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "date", kind: "SOURCE", description: "Fecha de fin prevista (contrato por tiempo determinado)." },
  { key: "c.duracion", label: "Contrato · Duración", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "text", kind: "CALCULATED", description: "Duración humana calculada a partir de start_date y end_date (p. ej. «6 meses»)." },
  { key: "c.firma", label: "Contrato · Fecha de firma", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "date", kind: "SOURCE", description: "Fecha de firma del contrato." },
  { key: "c.firma_dia", label: "Contrato · Día de firma", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "integer", kind: "CALCULATED", description: "Día de la fecha de firma (calculado, no se persiste)." },
  { key: "c.firma_mes", label: "Contrato · Mes de firma", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "text", kind: "CALCULATED", description: "Mes de la fecha de firma en español (calculado, no se persiste)." },
  { key: "c.firma_anio", label: "Contrato · Año de firma", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "integer", kind: "CALCULATED", description: "Año de la fecha de firma (calculado, no se persiste)." },
  { key: "c.lugar_firma", label: "Contrato · Lugar de firma", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Lugar/municipio de firma." },
  { key: "c.formaPago", label: "Contrato · Forma de pago", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Forma de pago (A tiempo / A rendimiento), incluidos anexos formalizados." },
  { key: "c.momentoPago", label: "Contrato · Día / momento de pago", category: "Contrato", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Día o momento de pago (p. ej. «Día 10 de cada mes»), incluidos anexos formalizados." },

  { key: "c.salario", label: "Contrato · Salario de escala", category: "Retribución", documentTypes: ["CONTRACT"], dataType: "amount", kind: "SOURCE", description: "Salario de escala formalizado vigente." },
  { key: "c.pagos_adic", label: "Contrato · Pagos adicionales", category: "Retribución", documentTypes: ["CONTRACT"], dataType: "amount", kind: "SOURCE", description: "Suma de pagos adicionales formalizados." },
  { key: "c.cond_anorm", label: "Contrato · Pagos por condiciones anormales", category: "Retribución", documentTypes: ["CONTRACT"], dataType: "amount", kind: "SOURCE", description: "Suma de pagos por condiciones laborales anormales." },
  { key: "c.otros_pagos", label: "Contrato · Otros pagos", category: "Retribución", documentTypes: ["CONTRACT"], dataType: "amount", kind: "SOURCE", description: "Suma de otros pagos del contrato." },
  { key: "c.total", label: "Contrato · Total contractual", category: "Retribución", documentTypes: ["CONTRACT"], dataType: "amount", kind: "SOURCE", description: "Total contractual formalizado (salario + conceptos)." },
  { key: "c.moneda", label: "Contrato · Moneda", category: "Retribución", documentTypes: ["CONTRACT"], dataType: "text", kind: "SOURCE", description: "Moneda de la retribución (p. ej. CUP)." },

  // ---------------- Anexo · catálogo VISIBLE exclusivo (short aliases a.*) ----------------
  { key: "a.ent", label: "Anexo · Nombre de la entidad", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Nombre de la entidad firmante (snapshot)." },
  { key: "a.org", label: "Anexo · Organismo", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Organismo al que pertenece la entidad (snapshot)." },
  { key: "a.ram", label: "Anexo · Rama", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Rama de la entidad (snapshot)." },
  { key: "a.cod", label: "Anexo · Código laboral", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Código de identificación laboral (snapshot)." },
  { key: "a.dir", label: "Anexo · Dirección de la entidad", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Dirección de la entidad (snapshot)." },
  { key: "a.prov", label: "Anexo · Provincia de la entidad", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Provincia de la entidad (snapshot)." },
  { key: "a.mun", label: "Anexo · Municipio de la entidad", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Municipio de la entidad (snapshot)." },
  { key: "a.rev", label: "Anexo · Año de la Revolución", category: "Entidad", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Valor institucional configurado por entidad (texto libre, p. ej. 68) y preservado en el snapshot (nunca se calcula)." },

  { key: "a.rep_nom", label: "Anexo · Nombre del representante", category: "Representante", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Representante histórico que suscribió el documento (snapshot)." },
  { key: "a.rep_cargo", label: "Anexo · Cargo del representante", category: "Representante", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Cargo del representante histórico (snapshot)." },

  { key: "a.nom", label: "Anexo · Nombre completo", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Nombre y apellidos del trabajador." },
  { key: "a.ci", label: "Anexo · Carné de identidad", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Carné de identidad del trabajador." },
  { key: "a.nac", label: "Anexo · Fecha de nacimiento", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "date", kind: "SOURCE", description: "Fecha de nacimiento del trabajador." },
  { key: "a.prof", label: "Anexo · Profesión u oficio", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Profesión u oficio (dato profesional, no nivel de estudios)." },
  { key: "a.dir_trab", label: "Anexo · Dirección del trabajador", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Dirección particular del trabajador." },
  { key: "a.prov_trab", label: "Anexo · Provincia del trabajador", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Provincia de residencia del trabajador." },
  { key: "a.mun_trab", label: "Anexo · Municipio del trabajador", category: "Trabajador", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Municipio de residencia del trabajador." },

  { key: "a.num", label: "Anexo · Número de anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "integer", kind: "SOURCE", description: "Numeración secuencial del anexo dentro del contrato." },
  { key: "a.motivo", label: "Anexo · Motivo del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Motivo legible del anexo." },
  { key: "a.efectiva", label: "Anexo · Fecha efectiva", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "date", kind: "SOURCE", description: "Fecha desde la cual aplican las nuevas condiciones." },
  { key: "a.firma", label: "Anexo · Fecha de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "date", kind: "SOURCE", description: "Fecha de firma del anexo." },
  { key: "a.firma_dia", label: "Anexo · Día de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "integer", kind: "CALCULATED", description: "Día de la fecha de firma del anexo (calculado)." },
  { key: "a.firma_mes", label: "Anexo · Mes de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "CALCULATED", description: "Mes de la fecha de firma del anexo en español (calculado)." },
  { key: "a.firma_anio", label: "Anexo · Año de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "integer", kind: "CALCULATED", description: "Año de la fecha de firma del anexo (calculado)." },
  { key: "a.lugar_firma", label: "Anexo · Lugar de firma del anexo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Lugar de firma del anexo." },

  { key: "a.ant_cargo", label: "Anexo · Cargo anterior", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Cargo anterior según el snapshot del anexo." },
  { key: "a.ant_grupal", label: "Anexo · Grupo salarial anterior", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Grupo salarial anterior según el snapshot del anexo." },
  { key: "a.ant_cat", label: "Anexo · Categoría ocupacional anterior", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Categoría ocupacional anterior según el snapshot." },
  { key: "a.ant_salario", label: "Anexo · Salario anterior", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "amount", kind: "SOURCE", description: "Salario anterior según el snapshot del anexo." },

  { key: "a.nue_cargo", label: "Anexo · Cargo nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Cargo nuevo según el snapshot del anexo." },
  { key: "a.nue_grupal", label: "Anexo · Grupo salarial nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Grupo salarial nuevo según el snapshot del anexo." },
  { key: "a.nue_cat", label: "Anexo · Categoría ocupacional nueva", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "text", kind: "SOURCE", description: "Categoría ocupacional nueva según el snapshot." },
  { key: "a.nue_salario", label: "Anexo · Salario nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "amount", kind: "SOURCE", description: "Salario nuevo según el snapshot del anexo." },
  { key: "a.nue_otros", label: "Anexo · Otros pagos nuevos", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "amount", kind: "SOURCE", description: "Otros pagos según el lado «después» del anexo." },
  { key: "a.nue_total", label: "Anexo · Total nuevo", category: "Anexo", documentTypes: ["ADDENDUM"], dataType: "amount", kind: "SOURCE", description: "Total contractual nuevo según el anexo." },

  // ---------------- Resolución · catálogo VISIBLE exclusivo (short aliases r.*) ----------------
  // Documento sustitutivo del contrato cuando el Cargo destino es Especialista
  // Principal. Se mantienen variables CORTAS r.* (nunca nombres largos).
  { key: "r.nom", label: "Resolución · Nombre completo", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Nombre y apellidos del trabajador." },
  { key: "r.car", label: "Resolución · Cargo", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Cargo destino que pasa a ocupar el trabajador." },
  { key: "r.ent", label: "Resolución · Nombre de la entidad", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Entidad que emite la Resolución." },
  { key: "r.emp", label: "Resolución · Empresa", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Empresa a la que pertenece la UEB (vacío si la entidad no es UEB)." },
  { key: "r.sal", label: "Resolución · Salario", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "amount", kind: "SOURCE", description: "Salario correspondiente al nuevo Cargo." },
  { key: "r.ge", label: "Resolución · Grupo Escala", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Grupo Escala del nuevo Cargo (valor real, p. ej. XI)." },
  { key: "r.fun", label: "Resolución · Funciones / contenido de trabajo", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Funciones / contenido de trabajo del nuevo Cargo." },
  { key: "r.mun", label: "Resolución · Municipio", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Municipio donde se firma (dirección contractual de la entidad)." },
  { key: "r.dia", label: "Resolución · Día de firma", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "CALCULATED", description: "Día de la fecha de Resolución." },
  { key: "r.mes", label: "Resolución · Mes de firma", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "CALCULATED", description: "Mes de la fecha de Resolución en español." },
  { key: "r.ano", label: "Resolución · Año de firma", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "CALCULATED", description: "Año de la fecha de Resolución." },
  { key: "r.rev", label: "Resolución · Año de la Revolución", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Año de la Revolución configurado como texto en la información contractual." },
  { key: "r.rep", label: "Resolución · Representante", category: "Resolución", documentTypes: ["RESOLUTION"], dataType: "text", kind: "SOURCE", description: "Persona a nombre de quien sale la Resolución." },

  // ---------------- Movimiento de Nómina · catálogo visible (short aliases m.*) ----------------
  // Documento de Altas, Reubicaciones (cambio de puesto y/o salario efectivo) y Bajas.
  { key: "m.org", label: "Movimiento · Organismo", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Organismo configurado en la entidad (organization_entities.organism)." },
  { key: "m.emp", label: "Movimiento · Empresa", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Empresa según la jerarquía real (UEB → empresa padre; empresa; o grupo empresarial)." },
  { key: "m.uni", label: "Movimiento · Unidad", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Unidad concreta (UEB). Vacío si la entidad no es una UEB." },
  { key: "m.exp", label: "Movimiento · Expediente", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Número de identificación del trabajador (11 dígitos, preservado como texto)." },
  { key: "m.dia", label: "Movimiento · Día", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "integer", kind: "CALCULATED", description: "Día de la fecha efectiva del movimiento laboral." },
  { key: "m.mes", label: "Movimiento · Mes", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "CALCULATED", description: "Mes de la fecha efectiva del movimiento (nombre en español)." },
  { key: "m.ano", label: "Movimiento · Año", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "integer", kind: "CALCULATED", description: "Año de la fecha efectiva del movimiento." },
  { key: "m.nom", label: "Movimiento · Nombre", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Nombre o nombres del trabajador." },
  { key: "m.ap1", label: "Movimiento · Primer apellido", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Primer apellido del trabajador." },
  { key: "m.ap2", label: "Movimiento · Segundo apellido", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Segundo apellido del trabajador." },
  { key: "m.sex_m", label: "Movimiento · Sexo masculino", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» si el trabajador es masculino; vacío en caso contrario." },
  { key: "m.sex_f", label: "Movimiento · Sexo femenino", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» si el trabajador es femenino; vacío en caso contrario." },
  { key: "m.alta", label: "Movimiento · Alta", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» en una nueva contratación; vacío en el resto." },
  { key: "m.reu", label: "Movimiento · Reubicación", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» en un cambio de puesto y/o cambio salarial efectivo; vacío en el resto." },
  { key: "m.baja", label: "Movimiento · Baja", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "CALCULATED", description: "Devuelve «X» al dar de baja al trabajador; vacío en el resto." },
  { key: "m.area_act", label: "Movimiento · Área actual", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Área actual/anterior (en Alta, el área de incorporación)." },
  { key: "m.cargo_act", label: "Movimiento · Cargo actual", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Cargo actual/anterior (en Alta, el cargo de incorporación)." },
  { key: "m.area_nva", label: "Movimiento · Área nueva", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Área nueva/posterior. Vacío en Alta y Baja." },
  { key: "m.cargo_nvo", label: "Movimiento · Cargo nuevo", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Cargo nuevo/posterior. Vacío en Alta y Baja." },
  { key: "m.ge_act", label: "Movimiento · Grupo Escala actual", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Grupo Escala actual/anterior (número romano)." },
  { key: "m.sal_act", label: "Movimiento · Salario actual", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "amount", kind: "SOURCE", description: "Salario actual/anterior (snapshot)." },
  { key: "m.ge_nvo", label: "Movimiento · Grupo Escala nuevo", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "text", kind: "SOURCE", description: "Grupo Escala nuevo/posterior. Vacío en Alta y Baja." },
  { key: "m.sal_nvo", label: "Movimiento · Salario nuevo", category: "Movimiento de Nómina", documentTypes: ["PAYROLL_MOVEMENT"], dataType: "amount", kind: "SOURCE", description: "Salario nuevo/posterior. Vacío en Alta y Baja." },
]

export const documentVariableByKey = (key: string): DocumentVariableDefinition | undefined =>
  DOCUMENT_VARIABLES.find((definition) => definition.key === key)

/** Variables agrupadas por categoría (para el futuro selector visual de 11B.1). */
export const documentVariablesByCategory = (): Record<string, DocumentVariableDefinition[]> => {
  const map: Record<string, DocumentVariableDefinition[]> = {}
  DOCUMENT_VARIABLES.forEach((definition) => {
    const list = map[definition.category] || (map[definition.category] = [])
    list.push(definition)
  })
  return map
}

/* ------------------------------------------------------------------ */
/* Formatters centralizados (§45)                                      */
/* ------------------------------------------------------------------ */

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** "2026-10-15" → "15/10/2026". Acepta timestamp ISO completo. */
export const formatDocumentDate = (isoDate: string | null | undefined): string | null => {
  if (!isoDate) return null
  const [year, month, day] = isoDate.slice(0, 10).split("-")
  if (!year || !month || !day) return null
  return `${day}/${month}/${year}`
}

/**
 * Fase 21 (SC-4-04): "2026-10-15" → "15/10/26".
 * Formato numérico DD/MM/AA (dos dígitos por año) del modelo oficial.
 */
export const formatDocumentDateShort = (isoDate: string | null | undefined): string | null => {
  if (!isoDate) return null
  const [year, month, day] = isoDate.slice(0, 10).split("-")
  if (!year || !month || !day) return null
  return `${day}/${month}/${year.slice(-2)}`
}

/** "2026-10-15" → "15 de octubre de 2026". */
export const formatDocumentDateTextual = (isoDate: string | null | undefined): string | null => {
  if (!isoDate) return null
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number)
  if (!year || !month || !day || month < 1 || month > 12) return null
  return `${day} de ${MONTHS_ES[month - 1]} de ${year}`
}

export const documentSignatureDay = (isoDate: string | null | undefined): number | null => {
  if (!isoDate) return null
  const day = Number(isoDate.slice(0, 10).split("-")[2])
  return Number.isFinite(day) ? day : null
}

export const documentSignatureMonth = (isoDate: string | null | undefined): string | null => {
  if (!isoDate) return null
  const month = Number(isoDate.slice(0, 10).split("-")[1])
  return month >= 1 && month <= 12 ? MONTHS_ES[month - 1] : null
}

export const documentSignatureYear = (isoDate: string | null | undefined): number | null => {
  if (!isoDate) return null
  const year = Number(isoDate.slice(0, 10).split("-")[0])
  return Number.isFinite(year) ? year : null
}

/** 4000 → "4 000,00" (separador de miles con espacio, decimales con coma). */
export const formatDocumentAmount = (amount: number | string | null | undefined): string | null => {
  if (amount === null || amount === undefined || amount === "") return null
  const parsed = typeof amount === "number" ? amount : Number(amount)
  if (!Number.isFinite(parsed)) return null
  const [intPart, decPart] = Math.abs(parsed).toFixed(2).split(".")
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${parsed < 0 ? "-" : ""}${grouped},${decPart}`
}

/** Formatea s.dias: 1 → "1 día", >1 → "X días". */
export const formatSc404Dias = (value: number | string | null | undefined): string | null => {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed === 1 ? "1 día" : `${parsed} días`
}

/** Horas sin unidad: 8 → "8", 8.5 → "8,5". */
export const formatDocumentHours = (hours: number | string | null | undefined): string | null => {
  if (hours === null || hours === undefined || hours === "") return null
  const parsed = typeof hours === "number" ? hours : Number(hours)
  if (!Number.isFinite(parsed)) return null
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(".", ",")
}

/**
 * Duración humana entre dos fechas (§18/§59): las fechas siguen siendo la fuente
 * de verdad; la descripción jamás se almacena.
 * "2026-01-01" → "2026-07-01" ⇒ "6 meses"; 15 meses ⇒ "1 año y 3 meses".
 */
export const describeDocumentDuration = (
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string | null => {
  if (!startDate || !endDate) return null
  const [startY, startM, startD] = startDate.slice(0, 10).split("-").map(Number)
  const [endY, endM, endD] = endDate.slice(0, 10).split("-").map(Number)
  if (!startY || !endY) return null

  let months = (endY - startY) * 12 + (endM - startM)
  if (endD < startD) months -= 1

  // Resto de días: si cubre al menos medio mes, se redondea al mes superior
  const startMs = Date.UTC(startY, startM - 1, startD)
  const endMs = Date.UTC(endY, endM - 1, endD)
  const approxMonthMs = 30.44 * 24 * 60 * 60 * 1000
  const remainderDays = (endMs - startMs) / (24 * 60 * 60 * 1000) - months * 30.44
  if (remainderDays >= 15) months += 1

  if (months < 1) return "menos de un mes"

  const years = Math.floor(months / 12)
  const rest = months % 12
  const yearText =
    years === 0 ? "" : years === 1 ? "1 año" : `${years} años`
  const monthText =
    rest === 0 ? "" : rest === 1 ? "1 mes" : `${rest} meses`

  if (yearText && monthText) return `${yearText} y ${monthText}`
  return yearText || monthText
}
