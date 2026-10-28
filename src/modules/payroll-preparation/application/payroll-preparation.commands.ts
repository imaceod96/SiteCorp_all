import {
  rpcClosePrenominaPeriod,
  rpcCreatePrenominaPeriod,
  rpcDeletePrenominaNight,
  rpcRefreshPrenominaWorkers,
  rpcReopenPrenominaPeriod,
  rpcSavePrenominaCla,
  rpcSavePrenominaInputs,
  rpcSavePrenominaNight,
} from "../infrastructure/payroll-preparation.repository"

/**
 * Prenómina — Casos de uso de ESCRITURA (Application).
 *
 * Ninguno calcula importes: la captura se envía y el backend recalcula el período antes de
 * persistir (mismas RPC y mismos parámetros que la etapa anterior).
 */

/** Abre (o recupera) el período mensual de la entidad. Devuelve su identificador. */
export const createPrenominaPeriod = (entityId: string, year: number, month: number): Promise<string> =>
  rpcCreatePrenominaPeriod(entityId, year, month)

/** Añade los trabajadores activos que falten y refresca los snapshots del período. */
export const refreshPrenominaWorkers = (periodId: string): Promise<number> =>
  rpcRefreshPrenominaWorkers(periodId)

/** Guarda los días trabajados y los datos base capturados del trabajador. */
export const savePrenominaInputs = (
  entryId: string,
  workedDays: number,
  salaryScaleAmount: number | null,
  workdayHours: number | null
): Promise<void> => rpcSavePrenominaInputs(entryId, workedDays, salaryScaleAmount, workdayHours)

/** Guarda la captura CLA (minutos por modalidad del Cargo). */
export const savePrenominaCla = (
  entryId: string,
  applied: boolean,
  dayUsed: boolean,
  dayMinutes: number,
  nightUsed: boolean,
  night1Minutes: number,
  night2Minutes: number
): Promise<void> =>
  rpcSavePrenominaCla(
    entryId,
    applied,
    dayUsed,
    dayMinutes,
    nightUsed,
    night1Minutes,
    night2Minutes
  )

/** Crea o actualiza un horario nocturno del trabajador. */
export const savePrenominaNight = (
  entryId: string,
  nightId: string | null,
  start: string,
  end: string,
  nights: number
): Promise<string> => rpcSavePrenominaNight(entryId, nightId, start, end, nights)

/** Elimina un horario nocturno del trabajador. */
export const deletePrenominaNight = (nightId: string): Promise<void> =>
  rpcDeletePrenominaNight(nightId)

/** Cierra el período: pasa a CERRADA y congela la captura. */
export const closePrenominaPeriod = (periodId: string): Promise<void> =>
  rpcClosePrenominaPeriod(periodId)

/** Reabre el período: vuelve a BORRADOR. */
export const reopenPrenominaPeriod = (periodId: string): Promise<void> =>
  rpcReopenPrenominaPeriod(periodId)
