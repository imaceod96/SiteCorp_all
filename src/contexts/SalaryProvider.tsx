import * as React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  addSalaryGroupValue,
  addSalaryGroup as addSalaryGroupCommand,
  canManageGlobalSalary as canManageGlobalSalaryQuery,
  canManageSalary as canManageSalaryQuery,
  canViewSalary as canViewSalaryQuery,
  createEntityEmpresarialScale as createEntityEmpresarialScaleCommand,
  createGlobalPresupuestadaScale as createGlobalPresupuestadaScaleCommand,
  deactivateSalaryGroup as deactivateSalaryGroupCommand,
  loadCurrentSalaryGroupValue,
  loadEntityEmpresarialScale,
  loadGlobalPresupuestadaScale,
  loadSalaryGroupValueHistory,
  loadSalaryScaleForEntity,
  loadSalaryScaleWithGroups,
  resolveSalaryValueForGroup,
  updateSalaryGroup as updateSalaryGroupCommand,
} from '@/domains/organization-structure'
import {
  SalaryContext,
  type SalaryScale,
  type SalaryGroup,
  type SalaryGroupValue,
  type SalaryGroupWithCurrent,
  type SalaryScaleWithGroups,
} from '@/contexts/SalaryContext'

/**
 * Contexto de escalas salariales (presentación).
 *
 * No habla con Supabase ni compone consultas: delega en los casos de uso del dominio de
 * estructura organizativa, que es el dueño de la escala, sus grupos y sus valores. Aquí sólo
 * queda lo que es de la interfaz: el estado de sesión (sin usuario no se consulta nada), el
 * registro del error y el valor que ve la pantalla cuando algo falla.
 *
 * La interfaz pública del contexto NO cambia: ninguna pantalla necesita saber de dónde salen
 * los datos.
 */
export const SalaryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isPlatformSuperAdmin } = useAuth()

  const resolveScaleForEntity = React.useCallback(async (entityId: string): Promise<SalaryScale | null> => {
    if (!user) return null
    try {
      return await loadSalaryScaleForEntity(entityId)
    } catch (err) {
      console.error('[SalaryContext] Error resolving scale for entity:', err)
      return null
    }
  }, [user])

  const fetchScaleWithGroups = React.useCallback(async (scaleId: string): Promise<SalaryScaleWithGroups | null> => {
    if (!user) return null
    try {
      return await loadSalaryScaleWithGroups(scaleId)
    } catch (err) {
      console.error('[SalaryContext] Error fetching scale with groups:', err)
      return null
    }
  }, [user])

  const fetchGlobalPresupuestadaScale = React.useCallback(async (): Promise<SalaryScale | null> => {
    if (!user) return null
    try {
      return await loadGlobalPresupuestadaScale()
    } catch (err) {
      console.error('[SalaryContext] Error fetching global presupuestada scale:', err)
      return null
    }
  }, [user])

  const fetchEntityEmpresarialScale = React.useCallback(async (entityId: string): Promise<SalaryScale | null> => {
    if (!user) return null
    try {
      return await loadEntityEmpresarialScale(entityId)
    } catch (err) {
      console.error('[SalaryContext] Error fetching entity empresarial scale:', err)
      return null
    }
  }, [user])

  const createGlobalPresupuestadaScale = React.useCallback(async (name: string, currencyCode: string, effectiveFrom: string): Promise<SalaryScale | null> => {
    if (!user) return null
    // `effectiveFrom` se conserva en la firma por compatibilidad con la pantalla: la
    // vigencia de una escala la gobiernan los valores de sus grupos.
    void effectiveFrom
    try {
      return await createGlobalPresupuestadaScaleCommand(name, currencyCode)
    } catch (err) {
      console.error('[SalaryContext] Error creating global presupuestada scale:', err)
      throw err
    }
  }, [user])

  const createEntityEmpresarialScale = React.useCallback(async (entityId: string, name: string, currencyCode: string, effectiveFrom: string): Promise<SalaryScale | null> => {
    if (!user) return null
    void effectiveFrom
    try {
      return await createEntityEmpresarialScaleCommand(entityId, name, currencyCode)
    } catch (err) {
      console.error('[SalaryContext] Error creating entity empresarial scale:', err)
      throw err
    }
  }, [user])

  const addSalaryGroup = React.useCallback(async (scaleId: string, description?: string): Promise<SalaryGroup | null> => {
    if (!user) return null
    try {
      return await addSalaryGroupCommand(scaleId, description)
    } catch (err) {
      console.error('[SalaryContext] Error adding salary group:', err)
      throw err
    }
  }, [user])

  const updateSalaryGroup = React.useCallback(async (groupId: string, updates: Partial<SalaryGroup>): Promise<SalaryGroup | null> => {
    if (!user) return null
    try {
      return await updateSalaryGroupCommand(groupId, updates)
    } catch (err) {
      console.error('[SalaryContext] Error updating salary group:', err)
      throw err
    }
  }, [user])

  const deactivateSalaryGroup = React.useCallback(async (groupId: string): Promise<boolean> => {
    if (!user) return false
    try {
      await deactivateSalaryGroupCommand(groupId)
      return true
    } catch (err) {
      console.error('[SalaryContext] Error deactivating salary group:', err)
      return false
    }
  }, [user])

  /**
   * Registra una nueva vigencia del importe salarial a través de la función atómica del
   * backend (nunca sobrescribe valores anteriores). Para cambios de importe sobre un grupo
   * existente existe el flujo de revisión (ReviewSalaryChangeDialog), que muestra el impacto
   * antes de aplicar.
   */
  const addSalaryValue = React.useCallback(async (
    groupId: string,
    amount: number,
    currencyCode: string,
    effectiveFrom: string
  ): Promise<SalaryGroupValue | null> => {
    if (!user) return null
    try {
      return await addSalaryGroupValue(groupId, amount, currencyCode, effectiveFrom)
    } catch (err) {
      console.error('[SalaryContext] Error adding salary value:', err)
      throw err
    }
  }, [user])

  const fetchSalaryHistory = React.useCallback(async (groupId: string): Promise<SalaryGroupValue[]> => {
    if (!user) return []
    try {
      return await loadSalaryGroupValueHistory(groupId)
    } catch (err) {
      console.error('[SalaryContext] Error fetching salary history:', err)
      return []
    }
  }, [user])

  const getCurrentSalaryValue = React.useCallback(async (groupId: string): Promise<SalaryGroupValue | null> => {
    if (!user) return null
    try {
      return await loadCurrentSalaryGroupValue(groupId)
    } catch (err) {
      console.error('[SalaryContext] Error getting current salary value:', err)
      return null
    }
  }, [user])

  const resolveSalaryValue = React.useCallback(async (
    entityId: string,
    groupId: string,
    effectiveDate?: string
  ): Promise<SalaryGroupValue | null> => {
    if (!user) return null
    try {
      return await resolveSalaryValueForGroup(
        entityId,
        groupId,
        effectiveDate || new Date().toISOString().split('T')[0]
      )
    } catch (err) {
      console.error('[SalaryContext] Error resolving salary value:', err)
      return null
    }
  }, [user])

  const canViewSalary = React.useCallback(async (entityId?: string): Promise<boolean> => {
    if (!user) return false
    try {
      if (isPlatformSuperAdmin) return true
      return await canViewSalaryQuery(entityId)
    } catch (err) {
      console.error('[SalaryContext] Error checking salary view permission:', err)
      return false
    }
  }, [user, isPlatformSuperAdmin])

  const canManageSalary = React.useCallback(async (entityId?: string): Promise<boolean> => {
    if (!user) return false
    try {
      if (isPlatformSuperAdmin) return true
      return await canManageSalaryQuery(entityId)
    } catch (err) {
      console.error('[SalaryContext] Error checking salary manage permission:', err)
      return false
    }
  }, [user, isPlatformSuperAdmin])

  const canManageGlobalSalary = React.useCallback(async (): Promise<boolean> => {
    if (!user) return false
    try {
      if (isPlatformSuperAdmin) return true
      return await canManageGlobalSalaryQuery()
    } catch (err) {
      console.error('[SalaryContext] Error checking global salary manage permission:', err)
      return false
    }
  }, [user, isPlatformSuperAdmin])

  return (
    <SalaryContext.Provider value={{
          resolveScaleForEntity,
          fetchScaleWithGroups,
          fetchGlobalPresupuestadaScale,
          fetchEntityEmpresarialScale,
          createGlobalPresupuestadaScale,
          createEntityEmpresarialScale,
          addSalaryGroup,
          updateSalaryGroup,
          deactivateSalaryGroup,
          addSalaryValue,
          fetchSalaryHistory,
          getCurrentSalaryValue,
          resolveSalaryValue,
          canViewSalary,
          canManageSalary,
          canManageGlobalSalary
        }}>
      {children}
    </SalaryContext.Provider>
  )
}
