import {
  rpcPrenominaClaConfig,
  selectPrenominaEntries,
  selectPrenominaNights,
  selectPrenominaPeriod,
  selectPrenominaPeriodTotals,
  selectPrenominaPeriods,
} from "../infrastructure/payroll-preparation.repository"
import { claConfigFromEntry } from "../domain/rules"
import type {
  PrenominaClaConfig,
  PrenominaNightEntry,
  PrenominaPeriod,
  PrenominaStatus,
  PrenominaWorkerEntry,
} from "../domain/entities"

/**
 * Prenómina — Casos de uso de CONSULTA (Application).
 *
 * Los nombres públicos se conservan respecto de la etapa anterior (`@/lib/prenomina`): las
 * pantallas y el diálogo siguen llamando exactamente igual.
 */

/** Períodos de la entidad, del más reciente al más antiguo. */
export const fetchPrenominaPeriods = (entityId: string): Promise<PrenominaPeriod[]> =>
  selectPrenominaPeriods(entityId)

/** Total por período (histórico) ya sumado por la base de datos. */
export const fetchPrenominaPeriodTotals = (entityId: string): Promise<Record<string, number>> =>
  selectPrenominaPeriodTotals(entityId)

/** Un período concreto, o nulo si no existe. */
export const fetchPrenominaPeriod = (periodId: string): Promise<PrenominaPeriod | null> =>
  selectPrenominaPeriod(periodId)

/** Registros de trabajador del período (snapshot del mes). */
export const fetchPrenominaEntries = (periodId: string): Promise<PrenominaWorkerEntry[]> =>
  selectPrenominaEntries(periodId)

/** Nocturnidad de los registros indicados, agrupada por registro del período. */
export const fetchPrenominaNights = (
  entryIds: string[]
): Promise<Record<string, PrenominaNightEntry[]>> => selectPrenominaNights(entryIds)

/**
 * Configuración CLA del Cargo actual del trabajador (Assignment vigente).
 * Autorizada con prenomina.view/manage, no requiere permisos de Plantilla.
 */
export const fetchPrenominaClaConfig = (entryId: string): Promise<PrenominaClaConfig> =>
  rpcPrenominaClaConfig(entryId)

/**
 * Configuración CLA que se muestra al abrir la captura mensual de un trabajador:
 *   · período CERRADA → snapshot congelado del propio registro (no se consulta el Cargo).
 *   · período BORRADOR → configuración vigente del Cargo (RPC); si falla, snapshot.
 * Se conserva el comportamiento exacto que tenía la pantalla.
 */
export const resolveEntryClaConfig = async (
  entry: PrenominaWorkerEntry,
  periodStatus: PrenominaStatus | null | undefined
): Promise<PrenominaClaConfig> => {
  if (periodStatus === "CERRADA") return claConfigFromEntry(entry)
  try {
    return await rpcPrenominaClaConfig(entry.id)
  } catch {
    return claConfigFromEntry(entry)
  }
}
