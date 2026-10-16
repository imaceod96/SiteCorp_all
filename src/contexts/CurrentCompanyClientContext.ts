import * as React from "react"
import type { LegacyTenantSummary } from "@/modules/company-client"

/**
 * Company Client — Estado de INTERFAZ del cliente activo.
 *
 * `CompanyClientSummary` es la forma del cliente activo que expone el contexto.
 * Coincide campo a campo con el tipo de compatibilidad del dominio
 * (`LegacyTenantSummary`), es decir, con el subconjunto de columnas de `tenants`
 * que la aplicación consume, por lo que `toCompanyClient(...)` lo proyecta al
 * contrato de dominio SIN adaptador adicional. La equivalencia es una garantía
 * del compilador, no una coincidencia: si ambas formas divergen, `tsc` falla.
 *
 * ALCANCE: este contexto es SOLO estado de interfaz. NO autoriza nada: la
 * autorización real la aplican RLS y las RPC de Supabase con la sesión actual.
 */
export type CompanyClientSummary = LegacyTenantSummary

interface CurrentCompanyClientContextType {
  currentCompanyClient: CompanyClientSummary | null
  setCurrentCompanyClient: (companyClient: CompanyClientSummary | null) => void
  clearCurrentCompanyClient: () => void
}

const CurrentCompanyClientContext = React.createContext<
  CurrentCompanyClientContextType | undefined
>(undefined)

export const useCurrentCompanyClient = (): CurrentCompanyClientContextType => {
  const context = React.useContext(CurrentCompanyClientContext)
  if (context === undefined) {
    throw new Error(
      "useCurrentCompanyClient must be used within a CurrentCompanyClientProvider"
    )
  }
  return context
}

export { CurrentCompanyClientContext }
