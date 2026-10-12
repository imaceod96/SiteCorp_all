import { supabase } from "@/lib/supabase"
import { tableName } from "@/integrations/supabase/schema-target"
import type { CompanyClientId } from "../domain/entities"
import { toCompanyClient } from "./company-client.mapper"

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
