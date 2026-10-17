import { test, expect } from "@playwright/test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import ExcelJS from "exceljs"
import {
  MONTHLY_SALARY_HOURS_DIVISOR,
  NIGHT_RATE_19_23,
  NIGHT_RATE_23_07,
  PRENOMINA_STATUS_LABELS,
  MONTH_LABELS,
  canManagePrenomina,
  canViewPrenomina,
  claConfigFromEntry,
  computeClaPreview,
  computeEntryPreview,
  computeNightOverlapHours,
  computeNightPreview,
  deletedNightIds,
  isPeriodClosed,
  validateClaMinutes,
  validateNightInput,
  validateWorkedDays,
} from "../src/modules/payroll-preparation/domain/rules"
import {
  formatDateDMY,
  formatDecimalInput,
  formatHours,
  formatMinutes,
  formatMinutesToHours,
  formatMoney,
  formatMoneyWithCurrency,
  formatTenureLabel,
  parseDecimalInput,
  parseIntegerInput,
} from "../src/modules/payroll-preparation/domain/formatters"
import {
  normalizeClaConfig,
  normalizeNightEntry,
  normalizeWorkerEntry,
} from "../src/modules/payroll-preparation/domain/normalization"
import {
  PRENOMINA_EXPORT_HEADERS,
  buildPrenominaFileName,
  buildPrenominaWorkbookBlob,
} from "../src/modules/payroll-preparation/infrastructure/payroll-preparation.workbook"
import type {
  PrenominaNightEntry,
  PrenominaWorkerEntry,
} from "../src/modules/payroll-preparation/domain/entities"

/**
 * PRENÓMINA — reglas, cálculos, validaciones, exportación y frontera del dominio.
 *
 * Comprueba, con DATOS SIMULADOS y sin tocar la base de datos, lo que decide si la migración
 * de este bloque se mantiene:
 *   1. Nocturnidad: solape real del horario con los tramos 19–23 y 23–07 (incluye medianoche).
 *   2. CLA: minutos → horas → tarifa por tramo, con sus redondeos exactos.
 *   3. División del salario escala (190,6), horas trabajadas y total del trabajador.
 *   4. Formato, lectura de decimales y normalización de filas/RPC.
 *   5. Validaciones de captura con los MISMOS mensajes que ve el usuario.
 *   6. Exportación a Excel: encabezados, metadatos, formatos y fila TOTAL GENERAL reales.
 *   7. Contratos de datos: tablas, columnas, filtros, órdenes y RPC `prenomina_*` con sus
 *      parámetros; permisos; presentación sin Supabase y ausencia de dependencias circulares.
 *
 * Distinción explícita de lo verificado:
 *   · PRUEBAS DE REGLAS Y CÁLCULOS → funciones puras ejecutadas de verdad (importes, horas,
 *     redondeos, validaciones y el libro de Excel en memoria).
 *   · PRUEBAS DE CONTRATOS        → se lee el código y se comprueba la RPC, sus parámetros, los
 *     filtros de las consultas y la frontera de Supabase.
 *   · PRUEBAS FUNCIONALES REALES  → NINGUNA: no se abre, captura ni cierra ningún período real.
 *     El flujo completo de la pantalla se ejerce por la interfaz, fuera de este archivo.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Código sin comentarios: lo que el módulo HACE, no lo que documenta. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

/** Todos los módulos de `src`: comprueba la frontera sin enumerar archivos a mano. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : /\.tsx?$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : []
  )

/* --------------------------------------------------------------------------- */
/* Datos simulados del período                                                 */
/* --------------------------------------------------------------------------- */

/** Registro del período con importes coherentes con las reglas (nada viene de la base real). */
const entry = (overrides: Partial<PrenominaWorkerEntry> = {}): PrenominaWorkerEntry => ({
  id: "entry-1",
  period_id: "period-1",
  organization_entity_id: "entity-1",
  worker_id: "worker-1",
  worker_name_snapshot: "Ana Pérez",
  identification_snapshot: "85010112345",
  area_name_snapshot: "Producción",
  job_name_snapshot: "Técnico",
  position_name_snapshot: "Técnico A",
  salary_group_id: "group-1",
  salary_group_sequence: 5,
  salary_scale_id: "scale-1",
  salary_scale_amount: 1906,
  salary_currency: "CUP",
  workday_hours: 8,
  worked_days: 20,
  worked_hours: 160,
  hourly_scale_rate: 10,
  scale_salary_payment: 1600,
  employment_start_date_snapshot: "2015-01-15",
  tenure_reference_date: "2026-01-31",
  tenure_years: 11,
  tenure_months: 0,
  tenure_total_months: 132,
  tenure_band_id: "band-1",
  tenure_band_label: "Más de 10 años",
  tenure_base_amount: 190.6,
  tenure_hourly_rate: 1,
  tenure_payment: 160,
  tenure_status: "OK",
  has_masters_degree_snapshot: true,
  has_doctorate_degree_snapshot: false,
  academic_category: "MASTER",
  academic_status: "OK",
  academic_monthly_amount: 381.2,
  academic_hourly_rate: 2,
  academic_payment: 320,
  cla_applied: true,
  cla_day_enabled: true,
  cla_day_used: true,
  cla_day_hourly_rate: 1,
  cla_day_minutes: 60,
  cla_day_hours: 1,
  cla_day_payment: 1,
  cla_night_enabled: true,
  cla_night_used: true,
  cla_night1_start: "19:00",
  cla_night1_end: "23:00",
  cla_night1_hourly_rate: 2,
  cla_night1_minutes: 30,
  cla_night1_hours: 0.5,
  cla_night1_payment: 1,
  cla_night2_start: "23:00",
  cla_night2_end: "07:00",
  cla_night2_hourly_rate: 3,
  cla_night2_minutes: 0,
  cla_night2_hours: 0,
  cla_night2_payment: 0,
  cla_total_payment: 2,
  night_payment_19_23: 2.4,
  night_payment_23_07: 9.2,
  total_night_payment: 11.6,
  total_payment: 2093.6,
  ...overrides,
})

/** Registro de nocturnidad del trabajador (19:00 → 07:00, una noche). */
const night = (overrides: Partial<PrenominaNightEntry> = {}): PrenominaNightEntry => ({
  id: "night-1",
  worker_entry_id: "entry-1",
  start_time: "19:00",
  end_time: "07:00",
  nights_worked: 1,
  hours_19_23_per_night: 4,
  hours_23_07_per_night: 8,
  payment_19_23: 2.4,
  payment_23_07: 9.2,
  total_payment: 11.6,
  ...overrides,
})

/* --------------------------------------------------------------------------- */
/* 1. Nocturnidad                                                              */
/* --------------------------------------------------------------------------- */

test("la nocturnidad se calcula por solape real del horario con cada tramo", () => {
  // Tramos fijos de negocio.
  expect(NIGHT_RATE_19_23).toBe(0.6)
  expect(NIGHT_RATE_23_07).toBe(1.15)

  // Horario que coincide exactamente con cada tramo.
  expect(computeNightOverlapHours("19:00", "23:00")).toEqual({ hours19_23: 4, hours23_07: 0 })
  expect(computeNightOverlapHours("23:00", "07:00")).toEqual({ hours19_23: 0, hours23_07: 8 })
  // Horario completo que CRUZA medianoche.
  expect(computeNightOverlapHours("19:00", "07:00")).toEqual({ hours19_23: 4, hours23_07: 8 })
  // Solapes parciales.
  expect(computeNightOverlapHours("20:00", "22:00")).toEqual({ hours19_23: 2, hours23_07: 0 })
  expect(computeNightOverlapHours("21:00", "01:00")).toEqual({ hours19_23: 2, hours23_07: 2 })
  // Horario diurno: no toca ningún tramo nocturno.
  expect(computeNightOverlapHours("08:00", "16:00")).toEqual({ hours19_23: 0, hours23_07: 0 })
  // Minutos sueltos: 15 minutos dentro del tramo 19–23.
  expect(computeNightOverlapHours("19:15", "19:30")).toEqual({ hours19_23: 0.25, hours23_07: 0 })
})

test("el importe de nocturnidad aplica la tarifa de cada tramo por las noches trabajadas", () => {
  // 4 h × 0,6 × 2 noches = 4,80 ; 8 h × 1,15 × 1 noche = 9,20.
  expect(computeNightPreview("19:00", "23:00", 2)).toEqual({
    hours19_23: 4,
    hours23_07: 0,
    payment19_23: 4.8,
    payment23_07: 0,
    totalPayment: 4.8,
  })
  expect(computeNightPreview("23:00", "07:00", 1)).toEqual({
    hours19_23: 0,
    hours23_07: 8,
    payment19_23: 0,
    payment23_07: 9.2,
    totalPayment: 9.2,
  })
  // Horario completo: suma de los dos tramos, con el total redondeado a 2 decimales.
  expect(computeNightPreview("19:00", "07:00", 1)).toEqual({
    hours19_23: 4,
    hours23_07: 8,
    payment19_23: 2.4,
    payment23_07: 9.2,
    totalPayment: 11.6,
  })
  // Un registro sin noches trabajadas no genera importe (las horas se conservan para auditar).
  const none = computeNightPreview("19:00", "07:00", 0)
  expect(none.payment19_23).toBe(0)
  expect(none.payment23_07).toBe(0)
  expect(none.totalPayment).toBe(0)
  expect(none.hours19_23).toBe(4)
})

/* --------------------------------------------------------------------------- */
/* 2. CLA                                                                      */
/* --------------------------------------------------------------------------- */

test("el CLA convierte minutos en horas por tramo sin redondear el importe antes de tiempo", () => {
  const preview = computeClaPreview({
    applied: true,
    dayEnabled: true,
    dayRate: 1,
    dayMinutes: 60,
    nightEnabled: true,
    night1Rate: 2,
    night1Minutes: 30,
    night2Rate: 3,
    night2Minutes: 0,
  })
  // 60 min = 1 h × 1 ; 30 min = 0,5 h × 2 ; tramo 2 sin minutos.
  expect(preview).toEqual({
    dayHours: 1,
    dayPayment: 1,
    night1Hours: 0.5,
    night1Payment: 1,
    night2Hours: 0,
    night2Payment: 0,
    totalPayment: 2,
  })

  // Las horas se redondean a 4 decimales y el importe se calcula con ESA cifra (2 decimales).
  const tiny = computeClaPreview({
    applied: true,
    dayEnabled: true,
    dayRate: 1,
    dayMinutes: 10,
    nightEnabled: false,
    night1Rate: null,
    night1Minutes: 0,
    night2Rate: null,
    night2Minutes: 0,
  })
  expect(tiny.dayHours).toBe(0.1667)
  expect(tiny.dayPayment).toBe(0.17)

  // Sin «Aplicar CLA» no se paga nada, aunque haya minutos capturados.
  const notApplied = computeClaPreview({
    applied: false,
    dayEnabled: true,
    dayRate: 1,
    dayMinutes: 120,
    nightEnabled: true,
    night1Rate: 2,
    night1Minutes: 60,
    night2Rate: 3,
    night2Minutes: 60,
  })
  expect(notApplied.totalPayment).toBe(0)
  expect(notApplied.dayPayment).toBe(0)

  // CLA y Nocturnidad son independientes: la modalidad no habilitada en el Cargo no se paga.
  const dayOnly = computeClaPreview({
    applied: true,
    dayEnabled: true,
    dayRate: 1,
    dayMinutes: 60,
    nightEnabled: false,
    night1Rate: 5,
    night1Minutes: 600,
    night2Rate: 5,
    night2Minutes: 600,
  })
  expect(dayOnly.night1Payment).toBe(0)
  expect(dayOnly.night2Payment).toBe(0)
  expect(dayOnly.totalPayment).toBe(1)
})

/* --------------------------------------------------------------------------- */
/* 3. Salario escala, horas trabajadas y total del trabajador                  */
/* --------------------------------------------------------------------------- */

test("la tarifa horaria y el total del trabajador conservan exactamente sus redondeos", () => {
  // Divisor fijo de negocio (no depende del mes).
  expect(MONTHLY_SALARY_HOURS_DIVISOR).toBe(190.6)

  const nights = [computeNightPreview("19:00", "07:00", 1)]
  const cla = computeClaPreview({
    applied: true,
    dayEnabled: true,
    dayRate: 1,
    dayMinutes: 60,
    nightEnabled: true,
    night1Rate: 2,
    night1Minutes: 30,
    night2Rate: 3,
    night2Minutes: 0,
  })
  const preview = computeEntryPreview(1906, 190.6, 8, 20, nights, 381.2, cla)

  // 1906 / 190,6 = 10 h ; 190,6 / 190,6 = 1 h ; 381,2 / 190,6 = 2 h (mismo divisor y horas).
  expect(preview.hourlyRate).toBe(10)
  expect(preview.tenureHourlyRate).toBe(1)
  expect(preview.academicHourlyRate).toBe(2)
  // 20 días × 8 h = 160 h (4 decimales) y cada concepto se paga con esas horas.
  expect(preview.workedHours).toBe(160)
  expect(preview.scaleSalaryPayment).toBe(1600)
  expect(preview.tenurePayment).toBe(160)
  expect(preview.academicPayment).toBe(320)
  // Nocturnidad 2,40 + 9,20 = 11,60 ; CLA 2,00 ; TOTAL 1600 + 160 + 320 + 11,6 + 2.
  expect(preview.nightPayment19_23).toBe(2.4)
  expect(preview.nightPayment23_07).toBe(9.2)
  expect(preview.totalNightPayment).toBe(11.6)
  expect(preview.claTotalPayment).toBe(2)
  expect(preview.totalPayment).toBe(2093.6)

  // La tarifa horaria se redondea a 6 decimales (1 / 190,6 = 0,005247).
  expect(computeEntryPreview(1, null, 8, 1, []).hourlyRate).toBe(0.005247)
  // Sin importe (o importe 0) la tarifa es 0 y no se inventa ningún pago.
  const zero = computeEntryPreview(0, null, 8, 20, [], null, null)
  expect(zero.hourlyRate).toBe(0)
  expect(zero.scaleSalaryPayment).toBe(0)
  expect(zero.totalNightPayment).toBe(0)
  expect(zero.claTotalPayment).toBe(0)
  expect(zero.totalPayment).toBe(0)
})

test("la configuración CLA del período sale del snapshot del registro", () => {
  const config = claConfigFromEntry(entry())
  // Horarios recortados a HH:MM y tarifas del snapshot (no del Cargo actual).
  expect(config).toEqual({
    applicable: true,
    day_enabled: true,
    day_rate: 1,
    night_enabled: true,
    night1_start: "19:00",
    night1_end: "23:00",
    night1_rate: 2,
    night2_start: "23:00",
    night2_end: "07:00",
    night2_rate: 3,
  })

  // Un registro sin CLA configurada no queda «aplicable».
  const without = claConfigFromEntry(
    entry({ cla_day_enabled: false, cla_night_enabled: false, cla_day_hourly_rate: null })
  )
  expect(without.applicable).toBe(false)
  expect(without.day_rate).toBeNull()
})

/* --------------------------------------------------------------------------- */
/* 4. Formato, lectura de valores y normalización                              */
/* --------------------------------------------------------------------------- */

test("el formato y la lectura de decimales no cambian", () => {
  // Separador decimal: lo decide el runtime (datos ICU), no el módulo. Se comprueba lo que SÍ
  // es contrato: 2 decimales fijos, sin notación científica y con la moneda del período.
  const decimal = "[.,]"
  expect(formatMoney(0)).toMatch(new RegExp(`^0${decimal}00$`))
  expect(formatMoney(5)).toMatch(new RegExp(`^5${decimal}00$`))
  expect(formatMoney(null)).toMatch(new RegExp(`^0${decimal}00$`))
  expect(formatMoneyWithCurrency(12.75)).toMatch(new RegExp(`^12${decimal}75 CUP$`))
  // Horas y minutos.
  expect(formatHours(190.6)).toMatch(new RegExp(`^190${decimal}6$`))
  expect(formatHours(null)).toBe("0")
  expect(formatMinutes(90)).toBe("90")
  expect(formatMinutesToHours(90)).toMatch(new RegExp(`^90 min → 1${decimal}5 h$`))
  // Captura decimal con coma española.
  expect(formatDecimalInput(20.5)).toMatch(new RegExp(`^20${decimal}5$`))
  expect(formatDecimalInput(null)).toBe("")
  expect(parseDecimalInput("20,5")).toBe(20.5)
  expect(parseDecimalInput("20")).toBe(20)
  expect(parseDecimalInput("")).toBe(0)
  expect(parseDecimalInput("   ")).toBe(0)
  expect(parseDecimalInput("abc")).toBe(0)
  expect(parseIntegerInput("3,9")).toBe(3)
  // Antigüedad y fechas.
  expect(formatTenureLabel(3, 0)).toBe("3 años")
  expect(formatTenureLabel(1, 1)).toBe("1 año, 1 mes")
  expect(formatTenureLabel(2, 3)).toBe("2 años, 3 meses")
  expect(formatTenureLabel(null, 0)).toBe("—")
  expect(formatDateDMY("2015-01-15T00:00:00")).toBe("15/01/2015")
  expect(formatDateDMY(null)).toBe("—")
})

test("las filas de la base y la respuesta de la RPC se normalizan igual", () => {
  // Los números llegan como texto y las banderas como nulos: se tipan igual que antes.
  const raw = {
    ...entry(),
    worked_days: "20.5" as unknown as number,
    salary_scale_amount: null,
    workday_hours: "8" as unknown as number,
    tenure_years: "11" as unknown as number,
    has_masters_degree_snapshot: null as unknown as boolean,
    academic_category: "MASTER",
    cla_day_minutes: "60" as unknown as number,
    cla_day_hourly_rate: "1" as unknown as number,
    total_payment: null as unknown as number,
  }
  const normalized = normalizeWorkerEntry(raw)
  expect(normalized.worked_days).toBe(20.5)
  expect(normalized.salary_scale_amount).toBeNull()
  expect(normalized.workday_hours).toBe(8)
  expect(normalized.tenure_years).toBe(11)
  expect(normalized.has_masters_degree_snapshot).toBe(false)
  expect(normalized.academic_category).toBe("MASTER")
  expect(normalized.cla_day_minutes).toBe(60)
  expect(normalized.cla_day_hourly_rate).toBe(1)
  expect(normalized.total_payment).toBe(0)

  // Una categoría académica desconocida nunca se propaga.
  const unknownCategory = normalizeWorkerEntry({
    ...entry(),
    academic_category: "OTRA",
  } as PrenominaWorkerEntry)
  expect(unknownCategory.academic_category).toBeNull()
  expect(normalizeWorkerEntry({ ...entry(), academic_status: "" }).academic_status).toBe("OK")

  const normalizedNight = normalizeNightEntry({
    ...night(),
    nights_worked: "2" as unknown as number,
    payment_19_23: null as unknown as number,
  })
  expect(normalizedNight.nights_worked).toBe(2)
  expect(normalizedNight.payment_19_23).toBe(0)
  expect(normalizedNight.total_payment).toBe(11.6)

  // Respuesta vacía de `prenomina_cla_config`: sin CLA aplicable.
  expect(normalizeClaConfig(null)).toEqual({
    applicable: false,
    day_enabled: false,
    day_rate: null,
    night_enabled: false,
    night1_start: null,
    night1_end: null,
    night1_rate: null,
    night2_start: null,
    night2_end: null,
    night2_rate: null,
  })
  expect(normalizeClaConfig({ applicable: true, day_enabled: true, day_rate: "1.5" }).day_rate).toBe(1.5)
})

/* --------------------------------------------------------------------------- */
/* 5. Validaciones (mismos mensajes)                                           */
/* --------------------------------------------------------------------------- */

test("las validaciones de captura devuelven los mismos mensajes que ve el usuario", () => {
  // Días trabajados.
  expect(validateWorkedDays(-1)).toBe("Los días trabajados no pueden ser negativos")
  expect(validateWorkedDays(0)).toBeNull()
  expect(validateWorkedDays(20.5)).toBeNull()

  // Horarios nocturnos.
  expect(validateNightInput({ id: null, start: "", end: "07:00", nights: 1 })).toBe(
    "Cada registro nocturno debe tener hora de inicio y fin"
  )
  expect(validateNightInput({ id: null, start: "19:00", end: "", nights: 1 })).toBe(
    "Cada registro nocturno debe tener hora de inicio y fin"
  )
  expect(validateNightInput({ id: null, start: "19:00", end: "07:00", nights: 0 })).toBe(
    "Las noches trabajadas deben ser mayores que cero"
  )
  expect(validateNightInput({ id: "night-1", start: "19:00", end: "07:00", nights: 1 })).toBeNull()

  // Minutos CLA: enteros >= 0 (vacío = 0, sin decimales ni signos).
  expect(validateClaMinutes("", "CLA diurno")).toEqual({ minutes: 0, error: null })
  expect(validateClaMinutes("150", "CLA diurno")).toEqual({ minutes: 150, error: null })
  expect(validateClaMinutes("0", "CLA diurno")).toEqual({ minutes: 0, error: null })
  expect(validateClaMinutes("-3", "CLA diurno").error).toBe(
    "CLA diurno: los minutos deben ser un número entero mayor o igual que 0"
  )
  expect(validateClaMinutes("1,5", "CLA nocturno (tramo 1)").error).toBe(
    "CLA nocturno (tramo 1): los minutos deben ser un número entero mayor o igual que 0"
  )
  expect(validateClaMinutes("abc", "CLA nocturno (tramo 2)").minutes).toBe(0)

  // Registros eliminados en la captura: se calculan a partir de los identificadores originales.
  expect(
    deletedNightIds(["a", "b", "c"], [{ id: "a" }, { id: null }])
  ).toEqual(["b", "c"])
  expect(deletedNightIds([], [])).toEqual([])
  expect(deletedNightIds(["a"], [{ id: "a" }, { id: "b" }])).toEqual([])
})

/* --------------------------------------------------------------------------- */
/* 6. Estados y permisos (reglas puras)                                        */
/* --------------------------------------------------------------------------- */

test("los estados del período y los permisos se deciden con reglas puras", () => {
  expect(PRENOMINA_STATUS_LABELS).toEqual({ BORRADOR: "Borrador", CERRADA: "Cerrada" })
  expect(MONTH_LABELS[0]).toBe("Enero")
  expect(MONTH_LABELS[11]).toBe("Diciembre")

  // BORRADOR = captura ; CERRADA = sólo consulta.
  expect(isPeriodClosed("CERRADA")).toBe(true)
  expect(isPeriodClosed("BORRADOR")).toBe(false)
  expect(isPeriodClosed(null)).toBe(false)

  // `prenomina.view` o `prenomina.manage` permiten ver ; sólo `prenomina.manage` permite capturar.
  expect(canViewPrenomina(["prenomina.view"])).toBe(true)
  expect(canViewPrenomina(["prenomina.manage"])).toBe(true)
  expect(canViewPrenomina(["workers.view"])).toBe(false)
  expect(canManagePrenomina(["prenomina.view"])).toBe(false)
  expect(canManagePrenomina(["prenomina.manage"])).toBe(true)
})

/* --------------------------------------------------------------------------- */
/* 7. Exportación a Excel (libro real, datos simulados)                        */
/* --------------------------------------------------------------------------- */

test("la exportación conserva encabezados, metadatos y fila TOTAL GENERAL", async () => {
  const entries = [
    entry(),
    entry({ id: "entry-2", worker_id: "worker-2", worker_name_snapshot: "Luis Gómez" }),
  ]
  const nightsByEntry = {
    "entry-1": [night()],
    "entry-2": [night({ id: "night-2", worker_entry_id: "entry-2" })],
  }
  const blob = await buildPrenominaWorkbookBlob(entries, nightsByEntry, {
    entityName: "Entidad Demo",
    year: 2026,
    month: 3,
    status: "BORRADOR",
    generatedAt: new Date("2026-04-01T10:00:00.000Z"),
  })

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  const sheet = workbook.getWorksheet("Prenómina")
  expect(sheet, "el libro debe tener la hoja «Prenómina»").toBeTruthy()
  if (!sheet) return

  // Metadatos de cabecera (filas 1–6) y encabezados en la fila 8.
  expect(sheet.getRow(1).getCell(1).value).toBe("PRENÓMINA")
  expect(sheet.getRow(2).getCell(1).value).toBe("Entidad:")
  expect(sheet.getRow(2).getCell(2).value).toBe("Entidad Demo")
  expect(sheet.getRow(3).getCell(2).value).toBe("Marzo")
  expect(sheet.getRow(4).getCell(2).value).toBe("2026")
  expect(sheet.getRow(6).getCell(2).value).toBe("Borrador")
  expect(PRENOMINA_EXPORT_HEADERS).toHaveLength(25)
  const headerValues = sheet.getRow(8).values as unknown[]
  expect(headerValues.slice(1)).toEqual([...PRENOMINA_EXPORT_HEADERS])

  // Fila del trabajador: snapshot, identificación como TEXTO y conceptos del mes.
  const row = sheet.getRow(9)
  expect(row.getCell(1).value).toBe(1)
  expect(row.getCell(2).value).toBe("Ana Pérez")
  expect(row.getCell(3).value).toBe("85010112345")
  expect(row.getCell(3).numFmt).toBe("@")
  expect(row.getCell(8).value).toBe(1906)
  expect(row.getCell(12).value).toBe(1600)
  expect(row.getCell(13).value).toBe("15/01/2015")
  expect(row.getCell(14).value).toBe("11 años")
  expect(row.getCell(15).value).toBe("Más de 10 años")
  expect(row.getCell(18).value).toBe(160)
  expect(row.getCell(19).value).toBe(2.4)
  expect(row.getCell(20).value).toBe(9.2)
  expect(row.getCell(21).value).toBe(11.6)
  expect(row.getCell(22).value).toBe(2)
  expect(row.getCell(23).value).toBe("Máster")
  expect(row.getCell(24).value).toBe(320)
  expect(row.getCell(25).value).toBe(2093.6)
  expect(sheet.getRow(10).getCell(2).value).toBe("Luis Gómez")

  // TOTAL GENERAL: suma de los dos trabajadores, redondeada a 2 decimales.
  const total = sheet.getRow(11)
  expect(total.getCell(2).value).toBe("TOTAL GENERAL")
  expect(total.getCell(12).value).toBe(3200)
  expect(total.getCell(18).value).toBe(320)
  expect(total.getCell(19).value).toBe(4.8)
  expect(total.getCell(20).value).toBe(18.4)
  expect(total.getCell(21).value).toBe(23.2)
  expect(total.getCell(22).value).toBe(4)
  expect(total.getCell(24).value).toBe(640)
  expect(total.getCell(25).value).toBe(4187.2)
})

test("el nombre del archivo exportado se conserva", () => {
  expect(buildPrenominaFileName("Entidad Ávila", 2026, 3)).toBe(
    "Prenomina_Entidad_Avila_Marzo_2026.xlsx"
  )
  expect(buildPrenominaFileName("", 2025, 12)).toBe("Prenomina_Entidad_Diciembre_2025.xlsx")
})

/* --------------------------------------------------------------------------- */
/* 8. Contratos: consultas, RPC, permisos y frontera                           */
/* --------------------------------------------------------------------------- */

test("las consultas de períodos, registros y nocturnidad conservan tablas, filtros y órdenes", () => {
  const repository = code(
    "src/modules/payroll-preparation/infrastructure/payroll-preparation.repository.ts"
  )

  // Períodos de la entidad, del más reciente al más antiguo.
  expect(repository).toMatch(/\.from\("prenomina_periods"\)/)
  expect(repository).toMatch(
    /"id, organization_entity_id, period_year, period_month, status, created_at, closed_at"/
  )
  expect(repository).toMatch(/\.eq\("organization_entity_id", entityId\)/)
  expect(repository).toMatch(/\.order\("period_year", \{ ascending: false \}\)/)
  expect(repository).toMatch(/\.order\("period_month", \{ ascending: false \}\)/)
  expect(repository).toMatch(/\.eq\("id", periodId\)/)
  expect(repository).toMatch(/\.maybeSingle\(\)/)

  // Totales del histórico sin traer todas las filas.
  expect(repository).toMatch(/\.from\("prenomina_worker_entries"\)/)
  expect(repository).toMatch(/\.select\("period_id, total_payment"\)/)
  expect(repository).toMatch(/totals\[row\.period_id\] = \(totals\[row\.period_id\] \|\| 0\) \+ Number\(row\.total_payment \|\| 0\)/)

  // Registros del período y su nocturnidad.
  expect(repository).toMatch(/\.select\("\*"\)/)
  expect(repository).toMatch(/\.eq\("period_id", periodId\)/)
  expect(repository).toMatch(/\.order\("worker_name_snapshot"\)/)
  expect(repository).toMatch(/\.from\("prenomina_night_entries"\)/)
  expect(repository).toMatch(/\.in\("worker_entry_id", entryIds\)/)
  expect(repository).toMatch(/\.order\("display_order"\)/)
  expect(repository).toMatch(/\.order\("created_at"\)/)

  // Aislamiento: la entidad se filtra explícitamente (además de RLS).
  expect(repository.match(/organization_entity_id/g)?.length).toBeGreaterThanOrEqual(2)
})

test("las RPC de prenómina conservan sus nombres y sus parámetros", () => {
  const repository = code(
    "src/modules/payroll-preparation/infrastructure/payroll-preparation.repository.ts"
  )

  expect(repository).toMatch(/\.rpc\("prenomina_cla_config", \{ p_entry_id: entryId \}\)/)
  expect(repository).toMatch(/\.rpc\("prenomina_create_period", \{/)
  expect(repository).toMatch(/p_entity_id: entityId/)
  expect(repository).toMatch(/p_year: year/)
  expect(repository).toMatch(/p_month: month/)
  expect(repository).toMatch(/\.rpc\("prenomina_refresh_workers", \{/)
  expect(repository).toMatch(/p_period_id: periodId/)
  expect(repository).toMatch(/\.rpc\("prenomina_upsert_inputs", \{/)
  expect(repository).toMatch(/p_entry_id: entryId/)
  expect(repository).toMatch(/p_worked_days: workedDays/)
  expect(repository).toMatch(/p_salary_scale_amount: salaryScaleAmount/)
  expect(repository).toMatch(/p_workday_hours: workdayHours/)
  expect(repository).toMatch(/\.rpc\("prenomina_save_cla", \{/)
  expect(repository).toMatch(/p_applied: applied/)
  expect(repository).toMatch(/p_day_used: dayUsed/)
  expect(repository).toMatch(/p_day_minutes: dayMinutes/)
  expect(repository).toMatch(/p_night_used: nightUsed/)
  expect(repository).toMatch(/p_night1_minutes: night1Minutes/)
  expect(repository).toMatch(/p_night2_minutes: night2Minutes/)
  expect(repository).toMatch(/\.rpc\("prenomina_save_night", \{/)
  expect(repository).toMatch(/p_night_id: nightId/)
  expect(repository).toMatch(/p_start: start/)
  expect(repository).toMatch(/p_end: end/)
  expect(repository).toMatch(/p_nights: nights/)
  expect(repository).toMatch(/\.rpc\("prenomina_delete_night", \{ p_night_id: nightId \}\)/)
  expect(repository).toMatch(/\.rpc\("prenomina_close_period", \{ p_period_id: periodId \}\)/)
  expect(repository).toMatch(/\.rpc\("prenomina_reopen_period", \{ p_period_id: periodId \}\)/)

  // Ningún comando calcula importes: el backend recalcula antes de persistir.
  const commands = code(
    "src/modules/payroll-preparation/application/payroll-preparation.commands.ts"
  )
  expect(commands).not.toMatch(/@\/lib\/supabase/)
  expect(commands).not.toMatch(/Math\./)
})

test("los permisos prenomina.view y prenomina.manage se conservan sin cambios", () => {
  const catalog = read("src/modules/access-control/domain/permissions.catalog.ts")
  expect(catalog).toMatch(/"prenomina\.view": "Ver prenómina"/)
  expect(catalog).toMatch(/"prenomina\.manage": "Gestionar prenómina"/)

  // La pantalla sigue preguntando al dominio de control de acceso y usa las reglas puras.
  const page = code("src/modules/payroll-preparation/presentation/pages/EntityPrenomina.tsx")
  expect(page).toMatch(/useEntityPermissions\(entityId\)/)
  expect(page).toMatch(/canViewPrenomina\(permissions\)/)
  expect(page).toMatch(/canManagePrenomina\(permissions\)/)
  // Mismos mensajes y mismos textos de interfaz.
  expect(page).toMatch(/No tiene permiso para ver la prenómina de esta entidad\./)
  expect(page).toMatch(/Abrir \/ Crear prenómina/)
  expect(page).toMatch(/Actualizar trabajadores/)
  expect(page).toMatch(/Cerrar prenómina/)
  expect(page).toMatch(/Exportar Excel/)
  expect(page).toMatch(/Prenómina reabierta \(borrador\)/)
})

test("las pantallas de prenómina consumen el dominio y no consultan Supabase", () => {
  const presentation = [
    "src/modules/payroll-preparation/presentation/pages/EntityPrenomina.tsx",
    "src/modules/payroll-preparation/presentation/components/WorkerPrenominaDialog.tsx",
  ]

  for (const file of presentation) {
    const source = code(file)
    expect(source, `${file} no debe consultar Supabase`).not.toMatch(/@\/lib\/supabase/)
    expect(source, `${file} no debe invocar RPC`).not.toMatch(/\.rpc\(/)
    expect(source, `${file} no debe componer consultas`).not.toMatch(/supabase\.from\(/)
    expect(source, `${file} no debe usar la fachada retirada`).not.toMatch(/@\/lib\/prenomina/)
    expect(source, `${file} debe consumir el módulo`).toMatch(
      /@\/(domains|modules)\/payroll-preparation/
    )
  }

  // El diálogo usa las reglas y validaciones del dominio, no copias locales.
  const dialog = code("src/modules/payroll-preparation/presentation/components/WorkerPrenominaDialog.tsx")
  for (const rule of [
    "validateWorkedDays",
    "validateNightInput",
    "validateClaMinutes",
    "deletedNightIds",
    "computeNightPreview",
    "computeClaPreview",
    "computeEntryPreview",
  ]) {
    expect(dialog, `el diálogo debe usar ${rule}`).toMatch(new RegExp(`\\b${rule}\\b`))
  }

  // La pantalla delega en el dominio la resolución del CLA del período.
  expect(code("src/modules/payroll-preparation/presentation/pages/EntityPrenomina.tsx")).toMatch(
    /resolveEntryClaConfig\(entry, period\?\.status\)/
  )
})

test("la fachada src/lib/prenomina.ts se retiró y ningún módulo la importa", () => {
  expect(existsSync("src/lib/prenomina.ts")).toBe(false)

  const retired = /from "@\/lib\/prenomina"/
  const offenders = sourceFiles("src").filter((file) => retired.test(code(file)))
  expect(offenders, "ningún módulo debe importar la fachada retirada").toEqual([])

  // La fachada del pago académico también se retiró (bloque de administración global): su
  // único consumidor pasó al dominio de estructura organizativa.
  expect(existsSync("src/lib/academic-payment.ts")).toBe(false)

  const retiredAcademicPayment = /from "@\/lib\/academic-payment"/
  const academicOffenders = sourceFiles("src").filter((file) =>
    retiredAcademicPayment.test(code(file))
  )
  expect(academicOffenders, "ningún módulo debe importar la fachada retirada").toEqual([])
})

test("el dominio de prenómina no depende de la presentación ni forma ciclos", () => {
  const domain = sourceFiles("src/modules/payroll-preparation")

  for (const file of domain) {
    const source = code(file)
    expect(source, `${file} no debe depender de la presentación`).not.toMatch(
      /from "@\/(pages|components|contexts|hooks)\//
    )
    // Único dominio permitido como dependencia: la categoría académica (estructura organizativa).
    expect(source, `${file} no debe depender de otro dominio`).not.toMatch(
      /from "@\/(domains|modules)\/(?!organization-structure)/
    )
  }

  // Y ningún OTRO dominio depende de prenómina: la dependencia va en un solo sentido.
  const consumers = sourceFiles("src/modules")
    .filter((file) => !file.startsWith("src/modules/payroll-preparation/"))
    .filter((file) => /@\/(domains|modules)\/payroll-preparation/.test(read(file)))
  expect(consumers, "ningún otro dominio debe depender de prenómina").toEqual([])

  // Los movimientos de nómina son otro módulo: no se mezclan.
  const movements = code(
    "src/modules/payroll-movements/application/payroll-movements.commands.ts"
  )
  expect(movements).not.toMatch(/payroll-preparation/)

  // La ruta de la pantalla no cambia.
  expect(read("src/App.tsx")).toMatch(
    /<Route path="\/entity\/:entityId\/payroll-preparation" element=\{<EntityPrenomina \/>\} \/>/
  )
})
