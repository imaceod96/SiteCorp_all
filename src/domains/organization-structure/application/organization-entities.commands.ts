import {
  insertOrganizationEntity,
  updateOrganizationEntity,
} from "../infrastructure/organization-entities.repository"
import { buildOrganizationEntityPayload } from "../domain/organization-entities.rules"
import type { SaveOrganizationEntityInput } from "../domain/entities"

/**
 * Entidades organizativas — Comando de alta y edición.
 *
 * Reglas que se conservan:
 *   · el cliente propietario se fija SÓLO al crear y proviene del cliente desde el que
 *     se abre el formulario (nunca «el primero»);
 *   · al editar, el cliente de la entidad NO se modifica: es lo que garantiza el
 *     aislamiento entre clientes;
 *   · el estado inicial de una entidad nueva es ACTIVO (lo fija el formulario) y el
 *     código interno se autogenera.
 *
 * El permiso no se comprueba aquí: RLS decide quién puede crear o editar entidades.
 */
export async function saveOrganizationEntity(input: SaveOrganizationEntityInput): Promise<void> {
  const { editingEntity, companyClientId, data } = input

  if (!editingEntity && !companyClientId) {
    throw new Error("No hay un cliente seleccionado para crear la entidad.")
  }

  const payload = buildOrganizationEntityPayload({ data, editingEntity })

  try {
    if (editingEntity) {
      await updateOrganizationEntity(editingEntity.id, payload)
      return
    }

    await insertOrganizationEntity(payload, companyClientId)
  } catch (error) {
    // Diagnóstico único de la escritura: el payload NO sale de aquí, así que se
    // registra en el punto donde todavía está disponible.
    const requestError = error as {
      code?: string
      message?: string
      details?: string | null
      hint?: string | null
    }

    console.error("[organization-entity] No se pudo guardar la entidad", {
      code: requestError?.code,
      message: requestError?.message,
      details: requestError?.details,
      hint: requestError?.hint,
      payload,
    })

    throw error
  }
}
