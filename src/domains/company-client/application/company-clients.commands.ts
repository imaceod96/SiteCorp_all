import { companyClientDeletionError, companyClientNameError } from "../domain/rules"
import type {
  CompanyClient,
  CompanyClientDeletionResult,
  CompanyClientId,
  CompanyClientInput,
} from "../domain/entities"
import { toCompanyClient } from "../infrastructure/company-client.mapper"
import {
  invokeDeleteCompanyClient,
  rpcCreateCompanyClient,
  updateCompanyClientRow,
} from "../infrastructure/company-client.repository"

/**
 * Company Client — Casos de uso de ESCRITURA y administración (aplicación).
 *
 * Aquí vive el ciclo de vida administrativo del cliente: alta, edición y borrado con su
 * confirmación. La pantalla sólo compone el formulario y muestra el resultado; no conoce
 * el nombre físico de la tabla, ni de las RPC, ni el contrato de la Edge Function.
 *
 * Dos garantías se conservan intactas respecto de la etapa anterior:
 *   · El CÓDIGO del cliente lo genera el servidor y es inmutable: nunca se envía.
 *   · La AUTORIDAD es del backend (superadministrador para el alta; `tenants.delete` y la
 *     confirmación por nombre para el borrado) y el borrado se ejecuta en una única
 *     transacción que además limpia el Storage privado del cliente.
 *
 * El mensaje final de cada fallo lo decide una regla PURA del dominio: se traduce lo que
 * tiene un significado estable y se conserva literal cualquier otro mensaje del servidor,
 * sin descartar nunca el diagnóstico técnico (que se registra íntegro).
 */

/**
 * Alta de un cliente. Devuelve el cliente YA proyectado al contrato de dominio.
 *
 * El identificador es el que asigna el servidor: la aplicación no propone UUID ni código.
 */
export async function createCompanyClient(
  input: CompanyClientInput
): Promise<CompanyClient> {
  try {
    const row = await rpcCreateCompanyClient(input)
    return toCompanyClient(row)
  } catch (error) {
    throw new Error(companyClientNameError(error))
  }
}

/** Edición de los datos editables del cliente (el código nunca se modifica). */
export async function updateCompanyClient(
  companyClientId: CompanyClientId,
  input: CompanyClientInput
): Promise<void> {
  try {
    await updateCompanyClientRow(companyClientId, input)
  } catch (error) {
    throw new Error(companyClientNameError(error))
  }
}

/**
 * Borrado definitivo del cliente, con la confirmación por nombre que exige el backend.
 *
 * La interfaz sólo puede llamarlo tras mostrar el resumen de consecuencias obtenido con
 * `loadCompanyClientDeletionSummary`: nunca se elimina «a ciegas».
 */
export async function deleteCompanyClient(
  companyClientId: CompanyClientId,
  confirmationName: string
): Promise<CompanyClientDeletionResult> {
  const invocation = await invokeDeleteCompanyClient(companyClientId, confirmationName)

  if (invocation.error) {
    // Diagnóstico técnico completo: el mensaje final puede ser traducido, pero el error
    // original y el mensaje del backend nunca se descartan.
    console.error("Fallo al eliminar el cliente.", {
      companyClientId,
      backendMessage: invocation.backendMessage,
      error: invocation.error,
    })

    throw new Error(
      invocation.backendMessage || companyClientDeletionError(invocation.error)
    )
  }

  return invocation.data
}
