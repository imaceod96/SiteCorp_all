import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useEntityPermissions } from "@/hooks/use-entity-permissions"
import {
  buildDistribution,
  fetchCandidatesSummary,
  fetchCatalogRefs,
  fetchContractsSummary,
  fetchContractDataReadiness,
  fetchDocumentTemplatesStatus,
  fetchEntityScope,
  fetchExpirationsSummary,
  fetchMovementsSummary,
  fetchOccupancySummary,
  fetchPlantillaSummary,
  fetchRepresentativeStatus,
  fetchSalaryScaleStatus,
  fetchVacationsSummary,
  fetchWorkersByAge,
  fetchWorkersByEducationLevel,
  fetchWorkersBySex,
  fetchWorkersBySkinColor,
  type SummaryScope,
} from "@/domains/entity-summary"

/**
 * Datos REALES del dashboard de entidad (Resumen) vía React Query.
 *
 * - La query key incluye SIEMPRE `entityId` y `scope` (y las entidades del ámbito).
 * - Cada bloque se habilita sólo con su permiso real (permiso → enabled query).
 * - `staleTime: 0` + `refetchOnMount: "always"`: al volver a Resumen se obtienen
 *   valores actuales (ninguna mutación deja cache obsoleta indefinidamente).
 */
const REFRESH_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always",
} as const

export function useEntitySummaryDashboard(entityId: string | undefined) {
  const { has, loading: permissionsLoading } = useEntityPermissions(entityId)
  const [scope, setScope] = React.useState<SummaryScope>("self")

  const scopeQuery = useQuery({
    queryKey: ["entity-summary", entityId, "scope", scope],
    queryFn: () => fetchEntityScope(entityId as string, scope),
    enabled: !!entityId,
    ...REFRESH_OPTIONS,
  })

  const descendantCount = scopeQuery.data?.descendantCount ?? 0
  const descendantsAvailable = descendantCount > 0

  // Si no hay descendientes accesibles, el ámbito ampliado no aporta nada: se vuelve a SELF.
  React.useEffect(() => {
    if (scope === "descendants" && scopeQuery.isSuccess && descendantCount === 0) {
      setScope("self")
    }
  }, [scope, scopeQuery.isSuccess, descendantCount])

  const entityIds = React.useMemo(
    () => scopeQuery.data?.entityIds ?? (entityId ? [entityId] : []),
    [scopeQuery.data, entityId]
  )
  const scopeReady = !!entityId && scopeQuery.isSuccess

  const canStaffing = has(["staffing.view", "staffing.manage"])
  const canWorkers = has(["workers.view", "workers.manage"])
  const canCandidates = has(["candidates.view", "candidates.manage"])
  const canContracts = has([
    "contracts.view",
    "contracts.manage",
    "workers.view",
    "workers.manage",
  ])
  const canAlerts = has(["contract_alerts.view", "workers.view", "workers.manage"])
  const canVacations = has(["vacations.view", "vacations.manage"])
  const canContractData = has([
    "contract_data.view",
    "contract_data.manage",
    "workers.view",
    "workers.manage",
  ])
  const canRepresentative = has([
    "representatives.view",
    "representatives.manage",
    "contract_data.view",
    "contract_data.manage",
    "workers.view",
    "workers.manage",
  ])
  const canSalary = has([
    "salary.view",
    "salary.manage",
    "contract_data.view",
    "contract_data.manage",
    "workers.view",
    "workers.manage",
  ])
  const canTemplates = has([
      "document_templates.view",
      "document_templates.manage",
      "contracts.view",
      "contracts.manage",
      "contract_addendums.view",
      "contract_addendums.manage",
    ])
  
    // Reports require workers.view or workers.manage
    const canReports = canWorkers
  
    const catalogRefsQuery = useQuery({
      queryKey: ["entity-summary", entityId, "catalog-refs"],
      queryFn: () => fetchCatalogRefs(),
      enabled: scopeReady && canReports,
      ...REFRESH_OPTIONS,
    })
  
    const ageReportQuery = useQuery({
      queryKey: ["entity-summary", entityId, scope, "reports", "age", entityIds],
      queryFn: () => fetchWorkersByAge(entityIds),
      enabled: scopeReady && canReports,
      ...REFRESH_OPTIONS,
    })
  
    const sexReportQuery = useQuery({
      queryKey: ["entity-summary", entityId, scope, "reports", "sex", entityIds],
      queryFn: () => fetchWorkersBySex(entityIds, catalogRefsQuery.data!),
      enabled: scopeReady && canReports && !!catalogRefsQuery.data,
      ...REFRESH_OPTIONS,
    })
  
    const skinColorReportQuery = useQuery({
      queryKey: ["entity-summary", entityId, scope, "reports", "skin-color", entityIds],
      queryFn: () => fetchWorkersBySkinColor(entityIds, catalogRefsQuery.data!),
      enabled: scopeReady && canReports && !!catalogRefsQuery.data,
      ...REFRESH_OPTIONS,
    })
  
    const educationReportQuery = useQuery({
      queryKey: ["entity-summary", entityId, scope, "reports", "education", entityIds],
      queryFn: () => fetchWorkersByEducationLevel(entityIds, catalogRefsQuery.data!),
      enabled: scopeReady && canReports && !!catalogRefsQuery.data,
      ...REFRESH_OPTIONS,
    })
  
    const plantillaQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "plantilla", entityIds],
    queryFn: () => fetchPlantillaSummary(entityIds),
    enabled: scopeReady && canStaffing,
    ...REFRESH_OPTIONS,
  })

  const occupancyQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "occupancy", entityIds],
    queryFn: () => fetchOccupancySummary(entityIds),
    enabled: scopeReady && canWorkers,
    ...REFRESH_OPTIONS,
  })

  const candidatesQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "candidates", entityIds],
    queryFn: () => fetchCandidatesSummary(entityIds),
    enabled: scopeReady && canCandidates,
    ...REFRESH_OPTIONS,
  })

  const contractsQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "contracts", entityIds],
    queryFn: () => fetchContractsSummary(entityIds),
    enabled: scopeReady && canContracts,
    ...REFRESH_OPTIONS,
  })

  const expirationsQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "expirations", entityIds],
    queryFn: () => fetchExpirationsSummary(entityIds),
    enabled: scopeReady && canAlerts,
    ...REFRESH_OPTIONS,
  })

  const movementsQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "movements", entityIds],
    queryFn: () => fetchMovementsSummary(entityIds),
    enabled: scopeReady && canWorkers,
    ...REFRESH_OPTIONS,
  })

  const vacationsQuery = useQuery({
    queryKey: ["entity-summary", entityId, scope, "vacations", entityIds],
    queryFn: () => fetchVacationsSummary(entityIds),
    enabled: scopeReady && canVacations,
    ...REFRESH_OPTIONS,
  })

  const contractDataQuery = useQuery({
    queryKey: ["entity-summary", entityId, "config", "contract-data"],
    queryFn: () => fetchContractDataReadiness(entityId as string),
    enabled: !!entityId && canContractData,
    ...REFRESH_OPTIONS,
  })

  const representativeQuery = useQuery({
    queryKey: ["entity-summary", entityId, "config", "representative"],
    queryFn: () => fetchRepresentativeStatus(entityId as string),
    enabled: !!entityId && canRepresentative,
    ...REFRESH_OPTIONS,
  })

  const salaryQuery = useQuery({
    queryKey: ["entity-summary", entityId, "config", "salary-scale"],
    queryFn: () => fetchSalaryScaleStatus(entityId as string),
    enabled: !!entityId && canSalary,
    ...REFRESH_OPTIONS,
  })

  const templatesQuery = useQuery({
    queryKey: ["entity-summary", entityId, "config", "document-templates"],
    queryFn: () => fetchDocumentTemplatesStatus(entityId as string),
    enabled: !!entityId && canTemplates,
    ...REFRESH_OPTIONS,
  })

  const staffing = React.useMemo(() => {
    const authorized = plantillaQuery.data?.authorized ?? 0
    const occupied = occupancyQuery.data?.occupied ?? 0
    const inconsistent = !!occupancyQuery.data && occupied > authorized
    return {
      authorized,
      occupied,
      vacancies: Math.max(0, authorized - occupied),
      occupancyPct: authorized > 0 ? (occupied / authorized) * 100 : 0,
      inconsistent,
    }
  }, [plantillaQuery.data, occupancyQuery.data])

  const distribution = React.useMemo(() => {
    if (plantillaQuery.data && occupancyQuery.data) {
      return buildDistribution(plantillaQuery.data, occupancyQuery.data)
    }
    return null
  }, [plantillaQuery.data, occupancyQuery.data])

  const hasConfigurationRow =
    canContractData || canRepresentative || canSalary || canTemplates

  return {
    // ámbito
    scope,
    setScope,
    descendantsAvailable,
    descendantCount,
    entityIds,
    scopeReady,
    scopeLoading: scopeQuery.isLoading,

    // permisos (para adaptar el layout sin dejar huecos)
    permissions: {
      staffing: canStaffing,
      workers: canWorkers,
      candidates: canCandidates,
      contracts: canContracts,
      alerts: canAlerts,
      vacations: canVacations,
      configuration: hasConfigurationRow,
      contractData: canContractData,
      representative: canRepresentative,
      salary: canSalary,
      templates: canTemplates,
    },
    permissionsLoading,
    has,

    // bloque principal
    plantilla: plantillaQuery.data ?? null,
    plantillaLoading: plantillaQuery.isLoading,
    occupancy: occupancyQuery.data ?? null,
    occupancyLoading: occupancyQuery.isLoading,
    staffing,

    // secciones
    candidates: candidatesQuery.data ?? null,
    candidatesLoading: candidatesQuery.isLoading,
    contracts: contractsQuery.data ?? null,
    contractsLoading: contractsQuery.isLoading,
    expirations: expirationsQuery.data ?? null,
    expirationsLoading: expirationsQuery.isLoading,
    movements: movementsQuery.data ?? null,
    movementsLoading: movementsQuery.isLoading,
    vacations: vacationsQuery.data ?? null,
        vacationsLoading: vacationsQuery.isLoading,
        distribution,
        distributionLoading: plantillaQuery.isLoading || occupancyQuery.isLoading,
    
        // --- NUEVOS REPORTES (pestaña Reportes dentro de Resumen) ---
        reports: {
          age: ageReportQuery.data ?? null,
          ageLoading: ageReportQuery.isLoading,
          sex: sexReportQuery.data ?? null,
          sexLoading: sexReportQuery.isLoading,
          skinColor: skinColorReportQuery.data ?? null,
          skinColorLoading: skinColorReportQuery.isLoading,
          education: educationReportQuery.data ?? null,
          educationLoading: educationReportQuery.isLoading,
        },
    
        // configuración
        contractData: contractDataQuery.data ?? null,
    contractDataLoading: contractDataQuery.isLoading,
    representative: representativeQuery.data ?? null,
    representativeLoading: representativeQuery.isLoading,
    salary: salaryQuery.data ?? null,
    salaryLoading: salaryQuery.isLoading,
    templates: templatesQuery.data ?? null,
    templatesLoading: templatesQuery.isLoading,
  }
}

export type EntitySummaryDashboard = ReturnType<typeof useEntitySummaryDashboard>
