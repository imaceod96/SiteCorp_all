import { type WeekDay, type SalaryGroupRef, type SalaryValue } from "./entities"

/**
 * Constantes de etiqueta para catálogos globales de la estructura organizativa.
 * Se conservan literalmente (texto exacto).
 */

/** Texto único usado por la UI cuando un cargo histórico no tiene categoría. */
export const NO_OCCUPATIONAL_CATEGORY_LABEL = "Sin categoría ocupacional configurada"

/** Texto único usado por la UI cuando un cargo no tiene nivel de preparación. */
export const NO_PREPARATION_LEVEL_LABEL = "Sin nivel de preparación configurado"

/** Texto único usado por la UI cuando un puesto no tiene información laboral configurada. */
export const NO_WORK_INFO_LABEL = "Sin configurar"

/** Día ISO-8601: 1 = Lunes … 7 = Domingo */
export const WEEK_DAYS: WeekDay[] = [
  { value: 1, label: "Lunes", short: "L" },
  { value: 2, label: "Martes", short: "M" },
  { value: 3, label: "Miércoles", short: "X" },
  { value: 4, label: "Jueves", short: "J" },
  { value: 5, label: "Viernes", short: "V" },
  { value: 6, label: "Sábado", short: "S" },
  { value: 7, label: "Domingo", short: "D" },
]

/**
 * Salario de referencia derivado: Grupo → escala aplicable → importe vigente.
 * Sin fallback: si el grupo no pertenece a la escala aplicable, devuelve null.
 */
export function salaryForGroup(
  applicableScaleId: string | null,
  group: SalaryGroupRef | null | undefined,
  valuesByGroup: Record<string, SalaryValue | null>
): SalaryValue | null {
  if (!applicableScaleId || !group) return null
  if (group.salary_scale_id !== applicableScaleId) return null
  return valuesByGroup[group.id] || null
}

/** Columnas exactas del Anexo 14 de Puestos. */
export const ANEXO_14_HEADERS = [
  "Nombre del puesto",
  "Categoría Ocupacional",
  "No. de puestos",
  "Nivel de preparación",
  "Grupo escala",
] as const

/** Valor por defecto cuando el puesto no tiene categoría ocupacional. */
export const NO_CATEGORY_VALUE = "Sin categoría ocupacional configurada"

/** Valor por defecto cuando un dato del Anexo 14 no está configurado. */
export const NOT_CONFIGURED_VALUE = "—"

/** Columnas de las 15 informaciones del modelo oficial del Anexo14B. */
export const ANEXO14_HEADERS = [
  "No",
  "Órgano y Cargos",
  "Categoría ocupacional",
  "Nombres y Apellidos del Trabajador",
  "Sexo",
  "Carnet de Identidad",
  "Nivel de Preparación",
  "Grupo Escala",
  "Total",
  "Escala",
  "CLA",
  "Turnos Nocturnos y Mixtos",
  "Maestría o Doctorado",
  "Años de Servicios",
  "Otros",
] as const
