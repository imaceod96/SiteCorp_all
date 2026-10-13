import {
  rpcCompanyClientDeletionSummary,
  selectCompanyClients,
} from "../infrastructure/company-client.repository"
import { companyClientDeletionError } from "../domain/rules"
import { toCompanyClient } from "../infrastructure/company-client.mapper"
import type { CompanyClient, CompanyClientDeletionSummary, CompanyClientId } from "../domain/entities"

/**
 * Company Client — Casos de uso de lectura (aplicación).
 *
 * La pantalla de clientes y estructura organizativa pide aquí la lista de clientes y
 * recibe el contrato de DOMINIO ya proyectado: ni compone consultas ni conoce el nombre
 * físico de la tabla.
 *
 * La lista está acotada por RLS (cada sesión ve los clientes a los que tiene acceso) y no
 * autoriza nada: seleccionar el cliente activo es un acto de interfaz que no amplía
 * privilegios.
 */
export async function loadCompanyClients(): Promise<CompanyClient[]> {
  const rows = await selectCompanyClients()
  return rows.map(toCompanyClient)
}

/**
 * RESUMEN de consecuencias antes de borrar el cliente (solo lectura).
 *
 * Las cifras las calcula el backend con el permiso de plataforma `tenants.delete`: la
 * interfaz nunca las inventa ni las estima. Si la consulta falla se registra el
 * diagnóstico técnico y se propaga un mensaje de usuario: sin resumen fiable no debe
 * ofrecerse la eliminación.
 */
export async function loadCompanyClientDeletionSummary(
  companyClientId: CompanyClientId
): Promise<CompanyClientDeletionSummary> {
  try {
    return await rpcCompanyClientDeletionSummary(companyClientId)
  } catch (error) {
    console.error("No se pudo obtener el resumen de eliminación del cliente.", {
      companyClientId,
      error,
    })
    throw new Error(companyClientDeletionError(error))
  }
}
