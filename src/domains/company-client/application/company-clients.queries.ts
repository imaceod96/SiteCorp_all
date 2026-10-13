import { selectCompanyClients } from "../infrastructure/company-client.repository"
import { toCompanyClient } from "../infrastructure/company-client.mapper"
import type { CompanyClient } from "../domain/entities"

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
