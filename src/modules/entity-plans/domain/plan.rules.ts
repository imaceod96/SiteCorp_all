import type {
  PlanCombination,
  PlanOperationType,
  PlanPackageStatus,
} from "./entities"

export const PLAN_COMBINATION_LABELS: Record<PlanCombination, string> = {
  BASIC: "Básico",
  BASIC_PRENOMINA: "Básico + Prenómina",
  BASIC_TRAINING_SST: "Básico + Capacitación y SST",
  BASIC_FULL: "Básico + Prenómina + Capacitación y SST",
}

export const PLAN_COMBINATION_BADGE_VARIANTS: Record<
  PlanCombination,
  "default" | "secondary" | "outline" | "success"
> = {
  BASIC: "outline",
  BASIC_PRENOMINA: "secondary",
  BASIC_TRAINING_SST: "secondary",
  BASIC_FULL: "success",
}

/**
 * Calcula de manera determinista la combinación permitida según los paquetes seleccionados.
 * El paquete Básico siempre es obligatorio e inmutable.
 */
export function calculatePlanCombination(
  prenomina: boolean,
  trainingSst: boolean
): PlanCombination {
  if (prenomina && trainingSst) {
    return "BASIC_FULL"
  }
  if (prenomina) {
    return "BASIC_PRENOMINA"
  }
  if (trainingSst) {
    return "BASIC_TRAINING_SST"
  }
  return "BASIC"
}

/**
 * Valida si una entidad es apta para recibir un plan en SiteCorp.
 * Requisito §3: Debe existir y estar identificada con is_sitecorp_account === true.
 */
export function canEntityHavePlan(
  entity: { is_sitecorp_account?: boolean | null } | null | undefined
): boolean {
  return entity?.is_sitecorp_account === true
}

/**
 * Valida y genera los mensajes de error normativos según el estado de la entidad (§3.3).
 */
export function validateEntityForPlanAssignment(
  entity: { id?: string; is_sitecorp_account?: boolean | null } | null | undefined
): { valid: boolean; error?: string } {
  if (!entity || !entity.id) {
    return {
      valid: false,
      error: "Error: la entidad seleccionada no existe. Debes crearla antes de asignarle un plan.",
    }
  }
  if (entity.is_sitecorp_account !== true) {
    return {
      valid: false,
      error:
        "Error: esta entidad no está registrada como cuenta SiteCorp. No es posible asignarle un plan.",
    }
  }
  return { valid: true }
}

/**
 * Determina qué paquetes se agregan, se retiran y el tipo de operación ante un cambio.
 */
export function diffPlanPackages(
  previous: { prenomina: boolean; trainingSst: boolean } | null,
  next: { prenomina: boolean; trainingSst: boolean }
): {
  isChanged: boolean
  operationType: PlanOperationType
  addedPackages: string[]
  removedPackages: string[]
} {
  if (!previous) {
    const added: string[] = []
    if (next.prenomina) added.push("Prenómina")
    if (next.trainingSst) added.push("Capacitación y SST")
    return {
      isChanged: true,
      operationType: "CREACION",
      addedPackages: added,
      removedPackages: [],
    }
  }

  const isChanged =
    previous.prenomina !== next.prenomina || previous.trainingSst !== next.trainingSst

  if (!isChanged) {
    return {
      isChanged: false,
      operationType: "AMPLIACION",
      addedPackages: [],
      removedPackages: [],
    }
  }

  const added: string[] = []
  const removed: string[] = []

  if (!previous.prenomina && next.prenomina) added.push("Prenómina")
  if (previous.prenomina && !next.prenomina) removed.push("Prenómina")

  if (!previous.trainingSst && next.trainingSst) added.push("Capacitación y SST")
  if (previous.trainingSst && !next.trainingSst) removed.push("Capacitación y SST")

  let operationType: PlanOperationType = "AMPLIACION"
  if (removed.length > 0 && added.length === 0) {
    operationType = "REDUCCION"
  } else if (added.length > 0 && removed.length === 0) {
    operationType = "AMPLIACION"
  } else {
    operationType = "AMPLIACION"
  }

  return {
    isChanged,
    operationType,
    addedPackages: added,
    removedPackages: removed,
  }
}

/**
 * Mapeo de módulos internos por paquete comercial (§4).
 */
export const PACKAGE_MODULE_MAP = {
  basic: [
    "summary",
    "candidates",
    "workers",
    "reentries",
    "hiring",
    "staffing",
    "vacations",
    "medical-certificates",
    "contract-alerts",
    "pending-documents",
    "settings",
  ],
  prenomina: ["prenomina"],
  training_sst: ["training", "sst"],
} as const

/**
 * Evalúa si una clave de módulo de entidad está habilitada en base al plan activo.
 */
export function isModuleEnabledInPlan(
  moduleKey: string,
  plan: { packagePrenomina: boolean; packageTrainingSst: boolean } | null | undefined
): boolean {
  // Si no hay plan aún o si el módulo pertenece al paquete básico, siempre está habilitado
  if (PACKAGE_MODULE_MAP.basic.includes(moduleKey as any)) {
    return true
  }

  // Si no hay plan registrado, por compatibilidad segura se asume habilitado hasta que se configure
  if (!plan) {
    return true
  }

  if (PACKAGE_MODULE_MAP.prenomina.includes(moduleKey as any)) {
    return plan.packagePrenomina === true
  }

  if (PACKAGE_MODULE_MAP.training_sst.includes(moduleKey as any)) {
    return plan.packageTrainingSst === true
  }

  return true
}
