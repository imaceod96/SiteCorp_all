/**
 * PRENÓMINA — Punto de entrada del dominio (Application / Domain / Infrastructure).
 *
 * Preparación MENSUAL del pago de los trabajadores activos: períodos, captura por trabajador,
 * Nocturnidad, CLA, antigüedad, categoría académica y exportación a Excel.
 *
 * Es un dominio INDEPENDIENTE de los Movimientos de Nómina (`@/domains/payroll-movements`):
 *   · Movimientos de Nómina → hechos laborales (alta, baja, reubicación) y su documento.
 *   · Prenómina           → captura y cálculo del mes, con sus propios períodos y estados.
 *
 * Los nombres públicos se conservan respecto de la etapa anterior (`@/lib/prenomina`), así que
 * las pantallas y el diálogo sólo cambian la ruta de importación.
 *
 * El cálculo DEFINITIVO vive en la base de datos (RPC `prenomina_*`); las reglas de
 * `domain/rules.ts` son su espejo exacto para previsualizar y exportar.
 */

// ---------------------------------------------------------------------------
// Domain — reglas, cálculos, formato y validaciones puras
// ---------------------------------------------------------------------------

export {
  MONTHLY_SALARY_HOURS_DIVISOR,
  NIGHT_RATE_19_23,
  NIGHT_RATE_23_07,
  PRENOMINA_STATUS_LABELS,
  MONTH_LABELS,
  isPeriodClosed,
  canViewPrenomina,
  canManagePrenomina,
  claConfigFromEntry,
  computeNightOverlapHours,
  computeNightPreview,
  computeClaPreview,
  computeEntryPreview,
  validateWorkedDays,
  validateNightInput,
  validateClaMinutes,
  deletedNightIds,
} from "./domain/rules"

export {
  formatMoney,
  formatMoneyWithCurrency,
  formatHours,
  formatMinutes,
  formatMinutesToHours,
  formatDecimalInput,
  parseDecimalInput,
  parseIntegerInput,
  formatTenureLabel,
  formatDateDMY,
} from "./domain/formatters"

export type {
  NightOverlapHours,
  NightPreview,
  ClaPreviewInput,
  ClaPreview,
  EntryPreview,
} from "./domain/rules"

export type {
  PrenominaStatus,
  PrenominaPeriod,
  PrenominaWorkerEntry,
  PrenominaNightEntry,
  PrenominaClaConfig,
  PrenominaExportMeta,
  PrenominaNightInput,
  PrenominaClaInput,
} from "./domain/entities"

// ---------------------------------------------------------------------------
// Application — casos de uso
// ---------------------------------------------------------------------------

export {
  fetchPrenominaPeriods,
  fetchPrenominaPeriodTotals,
  fetchPrenominaPeriod,
  fetchPrenominaEntries,
  fetchPrenominaNights,
  fetchPrenominaClaConfig,
  resolveEntryClaConfig,
} from "./application/payroll-preparation.queries"

export {
  createPrenominaPeriod,
  refreshPrenominaWorkers,
  savePrenominaInputs,
  savePrenominaCla,
  savePrenominaNight,
  deletePrenominaNight,
  closePrenominaPeriod,
  reopenPrenominaPeriod,
} from "./application/payroll-preparation.commands"

// ---------------------------------------------------------------------------
// Infrastructure — exportación a Excel (mismo libro y mismos importes)
// ---------------------------------------------------------------------------

export {
  PRENOMINA_EXPORT_HEADERS,
  buildPrenominaFileName,
  buildPrenominaWorkbookBlob,
  savePrenominaExcelBlob,
} from "./infrastructure/payroll-preparation.workbook"
