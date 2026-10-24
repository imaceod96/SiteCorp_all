import * as React from 'react'
import type {
  SalaryScale,
  SalaryScaleWithGroups,
  SalaryGroup,
  SalaryGroupValue,
} from '@/modules/organization-structure'

/**
 * Contexto de escalas salariales (presentación).
 *
 * Las entidades las define el dominio `organization-structure` (dueño de la estructura
 * organizativa) y aquí sólo se reexportan: la interfaz pública de este contexto no cambia y
 * ningún componente necesita conocer de dónde salen.
 */
export type {
  SalaryScale,
  SalaryGroup,
  SalaryGroupValue,
  SalaryGroupCurrentValue,
  ResolvedSalaryGroupValue,
  SalaryGroupWithCurrent,
  SalaryScaleWithGroups,
} from '@/modules/organization-structure'

interface SalaryContextType {
  // Scale operations
  resolveScaleForEntity: (entityId: string) => Promise<SalaryScale | null>
  fetchScaleWithGroups: (scaleId: string) => Promise<SalaryScaleWithGroups | null>
  fetchGlobalPresupuestadaScale: () => Promise<SalaryScale | null>
  fetchEntityEmpresarialScale: (entityId: string) => Promise<SalaryScale | null>
  createGlobalPresupuestadaScale: (name: string, currencyCode: string, effectiveFrom: string) => Promise<SalaryScale | null>
  createEntityEmpresarialScale: (entityId: string, name: string, currencyCode: string, effectiveFrom: string) => Promise<SalaryScale | null>

  // Permissions
  canViewSalary: (entityId?: string) => Promise<boolean>
  canManageSalary: (entityId?: string) => Promise<boolean>
  canManageGlobalSalary: () => Promise<boolean>
  canCreateEntityEmpresarialScale: (entityId: string) => Promise<boolean>
  canManageEntityEmpresarialSalary: (entityId: string) => Promise<boolean>

  // Group operations
  addSalaryGroup: (scaleId: string, description?: string) => Promise<SalaryGroup | null>
  updateSalaryGroup: (groupId: string, updates: Partial<SalaryGroup>) => Promise<SalaryGroup | null>
  deactivateSalaryGroup: (groupId: string) => Promise<boolean>

  // Value operations
  addSalaryValue: (groupId: string, amount: number, currencyCode: string, effectiveFrom: string) => Promise<SalaryGroupValue | null>
  fetchSalaryHistory: (groupId: string) => Promise<SalaryGroupValue[]>
  getCurrentSalaryValue: (groupId: string) => Promise<SalaryGroupValue | null>

  // Resolution
  resolveSalaryValue: (entityId: string, groupId: string, effectiveDate?: string) => Promise<SalaryGroupValue | null>

  // Permissions
  canViewSalary: (entityId?: string) => Promise<boolean>
  canManageSalary: (entityId?: string) => Promise<boolean>
  canManageGlobalSalary: () => Promise<boolean>
}

const SalaryContext = React.createContext<SalaryContextType | undefined>(undefined)

export const useSalary = () => {
  const context = React.useContext(SalaryContext)
  if (!context) {
    throw new Error('useSalary must be used within a SalaryProvider')
  }
  return context
}

export { SalaryContext }
