import * as React from "react"
import {
  loadEntityPlan,
  type EntityPlan,
} from "../../application/entity-plans.service"
import { isModuleEnabledInPlan } from "../../domain/plan.rules"
import { SITECORP_PLAN_CHANGED_EVENT } from "../../infrastructure/entity-plans.repository"

export interface UseEntityPlanResult {
  plan: EntityPlan | null
  loading: boolean
  refresh: () => Promise<void>
  isModuleEnabled: (moduleKey: string) => boolean
  canAccessPrenomina: boolean
  canAccessTrainingSst: boolean
}

export function useEntityPlan(entityId: string | null | undefined): UseEntityPlanResult {
  const [plan, setPlan] = React.useState<EntityPlan | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!entityId) {
      setPlan(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const data = await loadEntityPlan(entityId)
      setPlan(data)
    } catch (err) {
      console.warn(`[useEntityPlan] Error cargando plan para entidad ${entityId}:`, err)
    } finally {
      setLoading(false)
    }
  }, [entityId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // Escuchar cambios de plan en tiempo real (cuando se guardan modificaciones desde Gestión → Plan)
  React.useEffect(() => {
    if (!entityId) return

    const handlePlanChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ entityId?: string }>
      if (!customEvent.detail || customEvent.detail.entityId === entityId) {
        void refresh()
      }
    }

    window.addEventListener(SITECORP_PLAN_CHANGED_EVENT, handlePlanChanged)
    return () => {
      window.removeEventListener(SITECORP_PLAN_CHANGED_EVENT, handlePlanChanged)
    }
  }, [entityId, refresh])

  const isModuleEnabled = React.useCallback(
    (moduleKey: string): boolean => {
      return isModuleEnabledInPlan(moduleKey, plan)
    },
    [plan]
  )

  const canAccessPrenomina = plan ? plan.packagePrenomina === true : true
  const canAccessTrainingSst = plan ? plan.packageTrainingSst === true : true

  return {
    plan,
    loading,
    refresh,
    isModuleEnabled,
    canAccessPrenomina,
    canAccessTrainingSst,
  }
}
