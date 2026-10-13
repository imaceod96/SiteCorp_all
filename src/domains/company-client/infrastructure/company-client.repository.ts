import { supabase } from "@/lib/supabase"
import { rpcName, tableName } from "@/integrations/supabase/schema-target"
import type {
  CompanyClientDeletionResult,
  CompanyClientDeletionSummary,
  CompanyClientId,
  CompanyClientInput,
} from "../domain/entities"
import { toCompanyClient, type LegacyTenantSummary } from "./company-client.mapper"

/**
 * Company Client — Repositorio ÚNICO del cliente propietario (infraestructura).
 *
 * Único punto que habla con Supabase para el ciclo de vida del cliente: su lectura
 * (unitaria y de lista), su alta, su edición y las dos operaciones de su borrado (el
 * resumen previo de solo lectura y el borrado definitivo). Nadie más conoce el nombre
 * físico de la tabla ni de las RPC.
 *
 * La AUTORIZACIÓN no se decide aquí ni en el dominio: la aplican RLS y las funciones
 * del backend (`create_company_client` exige superadministrador; el resumen y el
 * borrado exigen `tenants.delete` y la confirmación por nombre). Este repositorio
 * propaga los fallos tal cual: la traducción a mensajes de usuario es una regla de
 * dominio que aplican los casos de uso.
 */

/**
 * Obtiene un cliente por su UUID y lo proyecta al dominio.
 *
 * El UUID es el MISMO antes y después del renombrado (`tenants.id` →
 * `company_clients.id`): la migración no genera identificadores nuevos. El nombre
 * físico de la tabla lo resuelve la frontera de nomenclatura.
 *
 * La fila solo es visible si la sesión actual puede leerla según RLS. Un
 * resultado sin fila devuelve `null`; los errores de consulta se propagan.
 * Este repositorio no cambia el cliente activo ni concede autorización.
 */
export async function getCompanyClientById(
  companyClientId: CompanyClientId
) {
  const { data, error } = await supabase
    .from(tableName("clients"))
    .select("id, name, code, description, is_active, created_at, updated_at")
    .eq("id", companyClientId)
    .maybeSingle()

  if (error) throw error
  return data ? toCompanyClient(data) : null
}

/**
 * Lista de clientes visibles para la sesión actual, ordenada por nombre.
 *
 * Es una lectura de LISTA y de solo lectura: sólo devuelve los clientes que RLS deja ver
 * (el superadministrador de plataforma los ve todos). No autoriza nada y no cambia el
 * cliente activo —eso sigue siendo responsabilidad del contexto de interfaz—.
 */
export async function selectCompanyClients(): Promise<LegacyTenantSummary[]> {
  const { data, error } = await supabase
    .from(tableName("clients"))
    .select("id, name, code, description, is_active, created_at, updated_at")
    .order("name")

  if (error) throw error
  return (data as LegacyTenantSummary[] | null) || []
}

/**
 * ALTA del cliente mediante la RPC del backend.
 *
 * Los nombres de los ARGUMENTOS no cambian (la migración SQL los preserva) y el código
 * lo genera la base de datos: la aplicación nunca lo propone. La RPC exige
 * superadministrador de plataforma, de modo que la comprobación de la interfaz es sólo
 * informativa.
 */
export async function rpcCreateCompanyClient(
  input: CompanyClientInput
): Promise<LegacyTenantSummary> {
  const { data, error } = await supabase.rpc(rpcName("createClient"), {
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_is_active: input.isActive ?? true,
  })

  if (error) throw error
  return data as LegacyTenantSummary
}

/**
 * EDICIÓN de los datos editables del cliente.
 *
 * El código NO se envía nunca: es inmutable y la base de datos rechaza cualquier
 * intento de cambiarlo. La fila queda sujeta a RLS.
 */
export async function updateCompanyClientRow(
  companyClientId: CompanyClientId,
  input: CompanyClientInput
): Promise<void> {
  const { error } = await supabase
    .from(tableName("clients"))
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_active: input.isActive ?? true,
    })
    .eq("id", companyClientId)

  if (error) throw error
}

/**
 * RESUMEN (solo lectura) de lo que se eliminaría del cliente.
 *
 * Lo calcula el backend con el permiso de plataforma `tenants.delete`; la interfaz no
 * estima ninguna cifra. El nombre del argumento no cambia (la migración SQL lo preserva).
 */
export async function rpcCompanyClientDeletionSummary(
  companyClientId: CompanyClientId
): Promise<CompanyClientDeletionSummary> {
  const { data, error } = await supabase.rpc(rpcName("deletionSummary"), {
    p_tenant_id: companyClientId,
  })

  if (error) throw error
  return data as CompanyClientDeletionSummary
}

/** Resultado crudo de invocar el borrado: o los datos, o el error con su mensaje. */
export type CompanyClientDeleteInvocation =
  | { data: CompanyClientDeletionResult; error: null; backendMessage: null }
  | {
      data: null
      error: unknown
      /** Mensaje que devolvió el backend en el cuerpo de la respuesta, si pudo leerse. */
      backendMessage: string | null
    }

/**
 * BORRADO definitivo del cliente.
 *
 * El contrato físico es la Edge Function `delete-workspace`, que exige el cuerpo legacy
 * (`tenant_id`, `confirmation_name`) y delega en la RPC transaccional
 * (`delete_workspace` / `delete_company_client`): autorización, confirmación por nombre,
 * borrado en base de datos y limpieza de los objetos privados del cliente, todo en una
 * sola operación. Aquí sólo se invoca y se extrae el mensaje del backend; la decisión de
 * qué mensaje ve el usuario la toma el caso de uso.
 */
export async function invokeDeleteCompanyClient(
  companyClientId: CompanyClientId,
  confirmationName: string
): Promise<CompanyClientDeleteInvocation> {
  const { data, error } = await supabase.functions.invoke("delete-workspace", {
    body: { tenant_id: companyClientId, confirmation_name: confirmationName },
  })

  if (!error) {
    return { data: data as CompanyClientDeletionResult, error: null, backendMessage: null }
  }

  let backendMessage: string | null = null
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === "function") {
    try {
      const payload = (await context.json()) as { error?: string }
      backendMessage = payload?.error ?? null
    } catch {
      backendMessage = null
    }
  }

  return { data: null, error, backendMessage }
}
