import { supabase } from "@/lib/supabase"
import type { MigrationTemplateData } from "../domain/entities"

/**
 * Personas — Repositorio de la carga inicial de trabajadores (infraestructura).
 *
 * Datos de referencia que la migración necesita antes de crear personas: la plantilla que
 * resuelve el backend (`get_migration_template_data`) con sus áreas, cargos, puestos, tipos de
 * contrato, formas de pago y representantes vigentes.
 *
 * El nombre de la RPC y sus parámetros son exactamente los que ya enviaba la aplicación.
 */
export async function rpcMigrationTemplateData(
  entityId: string,
  migrationType: string
): Promise<MigrationTemplateData> {
  const { data, error } = await supabase.rpc("get_migration_template_data", {
    entity_id: entityId,
    migration_type: migrationType,
  })
  if (error) throw error
  return (data || {
    areas: [],
    jobs: [],
    positions: [],
    contract_types: [],
    payment_methods: [],
    representatives: [],
  }) as MigrationTemplateData
}
