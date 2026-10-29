/**
 * Dominio de Planes por Entidad (SiteCorp)
 *
 * Cada entidad cliente con is_sitecorp_account = true tiene un plan propio
 * que determina de forma estricta qué módulos funcionales están habilitados.
 */

export type PlanCombination =
  | "BASIC"
  | "BASIC_PRENOMINA"
  | "BASIC_TRAINING_SST"
  | "BASIC_FULL"

export type PlanOperationType = "CREACION" | "AMPLIACION" | "REDUCCION"

export interface PlanPackageStatus {
  basic: boolean
  prenomina: boolean
  training_sst: boolean
}

export interface EntityPlan {
  id: string
  entityId: string
  companyClientId: string
  packageBasic: boolean // Siempre true
  packagePrenomina: boolean
  packageTrainingSst: boolean
  planCombination: PlanCombination
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
}

export interface EntityPlanHistoryRecord {
  id: string
  planId: string
  entityId: string
  operationType: PlanOperationType
  previousCombination: PlanCombination | null
  newCombination: PlanCombination
  previousPackages: PlanPackageStatus | null
  newPackages: PlanPackageStatus
  addedPackages: string[]
  removedPackages: string[]
  reason: string | null
  changedBy: string | null
  changedByEmail: string | null
  createdAt: string
}

export interface SiteCorpAccountEntityOption {
  id: string
  name: string
  code: string
  companyClientId: string
  companyClientName?: string
  entityType: string
  isSiteCorpAccount: boolean
  accountCode?: string | null
}
