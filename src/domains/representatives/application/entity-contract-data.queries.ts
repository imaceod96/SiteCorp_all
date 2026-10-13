import { loadEntityPermission } from "@/domains/access-control"
import {
  fetchEntityContractData,
  fetchRepresentativePositionList,
  fetchRepresentativePositions,
} from "../infrastructure/representatives.repository"
import type {
  EntityContractDataWorkspace,
  RepresentativePositionConfig,
  RepresentativePositionRow,
} from "../domain/entities"

/**
 * Representantes y datos contractuales — Consulta de la pantalla de datos contractuales.
 *
 * Compone en una sola carga:
 *   · los dos permisos que gobiernan la pantalla (`contract_data.view` /
 *     `contract_data.manage`) en ESTA entidad;
 *   · los datos contractuales de la entidad;
 *   · los cargos de representación CONFIGURADOS (incluidos los inactivos);
 *   · la persona que ocupa cada cargo HOY, resuelta por el backend.
 *
 * Devuelve `null` cuando el solicitante no puede ni ver ni gestionar los datos
 * contractuales: la pantalla muestra entonces su mensaje de acceso denegado y NO
 * consulta ningún dato. El permiso es una PREGUNTA al backend (`can_access_entity`);
 * la autorización efectiva de cada operación la sigue imponiendo RLS y
 * `save_entity_contract_data`.
 *
 * Un fallo al comprobar los permisos se interpreta como «sin permiso» (comportamiento
 * que ya tenía la pantalla): nunca se concede acceso por un error de red.
 */
export async function loadEntityContractDataWorkspace(
  entityId: string
): Promise<EntityContractDataWorkspace | null> {
  const [canView, canManage] = await Promise.all([
    loadEntityPermission(entityId, "contract_data.view").catch(() => false),
    loadEntityPermission(entityId, "contract_data.manage").catch(() => false),
  ])

  if (!canView && !canManage) return null

  const [contractData, positionRows, todayOccupants] = await Promise.all([
    fetchEntityContractData(entityId),
    fetchRepresentativePositionList(entityId),
    fetchRepresentativePositions(entityId),
  ])

  const occupants = new Map<string, RepresentativePositionRow>(
    (todayOccupants || []).map((row) => [row.position_id, row])
  )

  const positions: RepresentativePositionConfig[] = positionRows.map((position) => {
    const occupant = occupants.get(position.id)
    return {
      ...position,
      assignment_id: occupant?.assignment_id ?? null,
      person_name: occupant?.person_name ?? null,
      effective_from: occupant?.effective_from ?? null,
    }
  })

  return { contractData, canManage, positions }
}
