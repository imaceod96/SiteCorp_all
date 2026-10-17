/**
 * Interruptor y vocabulario del PLURIEMPLEO (capa compartida).
 *
 * Vive aquí —y no en un módulo de dominio— porque lo necesitan DOS módulos que no
 * pueden depender entre sí: Personas (opción «Pluriempleo» de la ficha del trabajador)
 * y Contratos (operaciones contractuales abiertas desde los vencimientos). Este archivo
 * no importa nada: es el punto neutro de la capa compartida.
 *
 * Las migraciones del Bloque 1 al 6 están APLICADAS y verificadas en Supabase: existen
 * `create_worker_pluriemploy` y los parámetros `p_target_assignment_id` /
 * `p_target_contract_id` / `p_assignment_id` que esta capa envía. Por eso la función
 * queda ACTIVADA. Un trabajador con un solo contrato conserva EXACTAMENTE el
 * comportamiento anterior: los parámetros nuevos sólo se envían cuando hay un contrato
 * identificado.
 */
export const PLURIEMPLEO_ENABLED = true

/** Etiqueta visible de la opción y del movimiento de la bitácora laboral. */
export const PLURIEMPLEO_LABEL = "Pluriempleo"

/** Tipo del movimiento de bitácora del segundo contrato (`worker_employment_movements`). */
export const PLURIEMPLEO_MOVEMENT_TYPE = "PLURIEMPLEO"

/** Límite de contratos vigentes simultáneos por trabajador y entidad. */
export const PLURIEMPLEO_MAX_ACTIVE_CONTRACTS = 2

export const PLURIEMPLEO_DISABLED_MESSAGE =
  "La función de Pluriempleo todavía no está habilitada en esta instalación."

export const PLURIEMPLEO_TARGET_REQUIRED_MESSAGE =
  "El trabajador tiene 2 contratos activos: identifique el contrato afectado."
