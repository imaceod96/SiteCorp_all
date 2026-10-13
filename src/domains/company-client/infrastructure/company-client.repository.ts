import { supabase } from "@/lib/supabase"
import { tableName } from "@/integrations/supabase/schema-target"
import type { CompanyClientId } from "../domain/entities"
import { toCompanyClient, type LegacyTenantSummary } from "./company-client.mapper"

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
