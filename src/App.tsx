import * as React from "react"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as Sonner } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom"
import { AuthProvider, useAuth } from "@/app/providers"
import { CurrentCompanyClientProvider } from "@/app/providers"
import { CurrentEntityProvider } from "@/app/providers"
import { SalaryProvider } from "@/app/providers"
import { PlatformAdminLayout } from "@/components/platform-admin-layout"
import EntityRouteWrapper from "@/components/entity-route-wrapper"
import { CompanyClientLayout } from "@/components/company-client-layout"
import { SiteCorpBrand } from "@/components/sitecorp-brand"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import Login from "@/modules/access-control/presentation/pages/Login"
import Index from "@/modules/organization-structure/presentation/pages/Index"
import Organization from "@/modules/organization-structure/presentation/pages/Organization"
import OrganizationDetail from "@/modules/organization-structure/presentation/pages/OrganizationDetail"
import Candidates from "@/modules/people/presentation/pages/Candidates"
import Hiring from "@/modules/people/presentation/pages/Hiring"
import Admin from "@/modules/access-control/presentation/pages/Admin"
import Account from "@/modules/access-control/presentation/pages/Account"
import Organizations from "@/modules/access-control/presentation/pages/Organizations"
import PlatformUsers from "@/modules/access-control/presentation/pages/PlatformUsers"
import RolesPermissions from "@/modules/access-control/presentation/pages/RolesPermissions"
import CompanyClientUsers from "@/modules/company-client/presentation/pages/CompanyClientUsers"
import CompanyClientInvitations from "@/modules/company-client/presentation/pages/CompanyClientInvitations"
import CompanyClientRoles from "@/modules/company-client/presentation/pages/CompanyClientRoles"
import AdminSettingsSalaryScale from "@/modules/organization-structure/presentation/pages/AdminSettingsSalaryScale"
import EntitySummary from "@/modules/entity-summary/presentation/pages/EntitySummary"
import EntityCandidates from "@/modules/people/presentation/pages/EntityCandidates"
import EntityPrenomina from "@/modules/payroll-preparation/presentation/pages/EntityPrenomina"
import CandidateDetail from "@/modules/people/presentation/pages/CandidateDetail"
import CandidateEdit from "@/modules/people/presentation/pages/CandidateEdit"
import EntityStaffing from "@/modules/organization-structure/presentation/pages/EntityStaffing"
import EntityWorkers from "@/modules/people/presentation/pages/EntityWorkers"
import EntityReentries from "@/modules/people/presentation/pages/EntityReentries"
import EntityHiring from "@/modules/people/presentation/pages/EntityHiring"
import EntityContractAlerts from "@/modules/contracts/presentation/pages/EntityContractAlerts"
import EntityVacations from "@/modules/vacations-licenses/vacations/presentation/pages/EntityVacations"
import EntityMedicalCertificates from "@/modules/vacations-licenses/medical-certificates/presentation/pages/EntityMedicalCertificates"
import EntityPendingDocuments from "@/modules/document-generation/presentation/pages/EntityPendingDocuments"
import WorkerDetail from "@/modules/people/presentation/pages/WorkerDetail"
import EntitySettings from "@/modules/organization-structure/presentation/pages/EntitySettings"
import EntitySettingsUsers from "@/modules/organization-structure/presentation/pages/EntitySettingsUsers"
import EntitySettingsRoles from "@/modules/organization-structure/presentation/pages/EntitySettingsRoles"
import EntitySettingsSalary from "@/modules/organization-structure/presentation/pages/EntitySettingsSalary"
import EntitySettingsTenureScale from "@/modules/organization-structure/presentation/pages/EntitySettingsTenureScale"
import EntitySettingsGoverningDocuments from "@/modules/organization-structure/presentation/pages/EntitySettingsGoverningDocuments"
import EntitySettingsStaffing from "@/modules/organization-structure/presentation/pages/EntitySettingsStaffing"
import EntitySettingsContractData from "@/modules/organization-structure/presentation/pages/EntitySettingsContractData"
import EntitySettingsDocumentTemplates from "@/modules/document-templates/presentation/pages/EntitySettingsDocumentTemplates"
import EntitySettingsDocumentTemplateDetail from "@/modules/document-templates/presentation/pages/EntitySettingsDocumentTemplateDetail"
import EntitySettingsInitialImport from "@/modules/organization-structure/presentation/pages/EntitySettingsInitialImport"
import NotFound from "@/app/pages/NotFound"

const queryClient = new QueryClient()

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error("SiteCorp render error:", error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-sitecorp-background p-6">
          <div className="w-full max-w-lg rounded-2xl border border-sitecorp-danger/30 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-sitecorp-danger">Error de la aplicación</p>
            <p className="mt-2 text-sm text-ink">
              SiteCorp no pudo renderizar la interfaz. Recarga la página para continuar.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-sitecorp-background p-3 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="mt-4 rounded-lg bg-sitecorp-primary px-4 py-2 text-sm font-medium text-white"
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

const LoadingScreen = () => (
  <div className="flex min-h-screen w-full items-center justify-center bg-white">
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-6 px-6 text-center"
    >
      <SiteCorpBrand
        variant="full"
        size="lg"
        className="w-full max-w-[280px] sm:max-w-[420px]"
        alt="SiteCorp"
      />
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-sitecorp-primary/25 border-t-sitecorp-primary motion-reduce:animate-none"
      />
      <p className="text-sm text-muted-foreground">Cargando SiteCorp...</p>
    </div>
  </div>
)

const IdentityErrorScreen = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex min-h-screen w-full items-center justify-center bg-white">
    <div role="alert" className="w-full max-w-md px-6 text-center">
      <SiteCorpBrand
        variant="full"
        size="md"
        className="mx-auto w-full max-w-[240px]"
        alt="SiteCorp"
      />
      <p className="mt-6 text-sm font-semibold text-ink">No se pudo verificar tu identidad</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Comprueba tu conexión e inténtalo de nuevo. Si el problema continúa, cierra sesión y
        vuelve a entrar.
      </p>
      <SiteCorpButton className="mt-6" onClick={onRetry}>
        Reintentar
      </SiteCorpButton>
    </div>
  </div>
)

const EntityPanelRedirect = () => {
  const { entityId } = useParams<{ entityId: string }>()
  return <Navigate to={`/entity/${entityId}/summary`} replace />
}

const AppRoutes = () => {
  const {
    authLoading,
    authReady,
    identityError,
    retryIdentity,
    user,
    isPlatformUser,
    isProfileActive,
  } = useAuth()
  const location = useLocation()

  if (authLoading) {
    return <LoadingScreen />
  }

  if (identityError) {
    return <IdentityErrorScreen onRetry={retryIdentity} />
  }

  if (!authReady) {
    return <LoadingScreen />
  }

  if (!user || !isProfileActive) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (location.pathname.startsWith("/entity/")) {
    return (
      <Routes>
        <Route element={<EntityRouteWrapper />}>
          <Route path="/entity/:entityId/summary" element={<EntitySummary />} />
          <Route path="/entity/:entityId/panel" element={<EntityPanelRedirect />} />
          <Route path="/entity/:entityId/candidates" element={<EntityCandidates />} />
          <Route path="/entity/:entityId/payroll-preparation" element={<EntityPrenomina />} />
          <Route path="/entity/:entityId/candidates/:candidateId" element={<CandidateDetail />} />
          <Route path="/entity/:entityId/candidates/:candidateId/edit" element={<CandidateEdit />} />
          <Route path="/entity/:entityId/workers" element={<EntityWorkers />} />
          <Route path="/entity/:entityId/workers/:workerId" element={<WorkerDetail />} />
          <Route path="/entity/:entityId/reentries" element={<EntityReentries />} />
          <Route path="/entity/:entityId/staffing" element={<EntityStaffing />} />
          <Route path="/entity/:entityId/staffing/workers/:workerId" element={<WorkerDetail />} />
          <Route path="/entity/:entityId/hiring" element={<EntityHiring />} />
          <Route path="/entity/:entityId/contracts/alerts" element={<EntityContractAlerts />} />
          <Route path="/entity/:entityId/vacations" element={<EntityVacations />} />
          <Route path="/entity/:entityId/medical-certificates" element={<EntityMedicalCertificates />} />
          <Route path="/entity/:entityId/documents/pending" element={<EntityPendingDocuments />} />
          <Route path="/entity/:entityId/settings" element={<EntitySettings />} />
          <Route path="/entity/:entityId/settings/staffing" element={<EntitySettingsStaffing />} />
          <Route path="/entity/:entityId/settings/initial-import" element={<EntitySettingsInitialImport />} />
          <Route path="/entity/:entityId/settings/users" element={<EntitySettingsUsers />} />
          <Route path="/entity/:entityId/settings/roles" element={<EntitySettingsRoles />} />
          <Route path="/entity/:entityId/settings/salary" element={<EntitySettingsSalary />} />
          <Route path="/entity/:entityId/settings/tenure-scale" element={<EntitySettingsTenureScale />} />
          <Route path="/entity/:entityId/settings/governing-documents" element={<EntitySettingsGoverningDocuments />} />
          <Route path="/entity/:entityId/settings/contract-data" element={<EntitySettingsContractData />} />
          <Route path="/entity/:entityId/settings/document-templates" element={<EntitySettingsDocumentTemplates />} />
          <Route path="/entity/:entityId/settings/document-templates/:templateId" element={<EntitySettingsDocumentTemplateDetail />} />
        </Route>
      </Routes>
    )
  }

  if (isPlatformUser) {
    return (
      <Routes>
        <Route element={<PlatformAdminLayout />}>
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/companies" element={<Organizations />} />
          <Route path="/admin/users" element={<PlatformUsers />} />
          <Route path="/admin/roles" element={<RolesPermissions />} />
          <Route path="/admin/account" element={<Account />} />
          <Route path="/admin/settings/salary-scale" element={<AdminSettingsSalaryScale />} />
          <Route path="/organization/:entityId" element={<OrganizationDetail />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<CompanyClientLayout />}>
        <Route path="/" element={<Index />} />
        <Route path="/organization" element={<Organization />} />
        <Route path="/organization/:entityId" element={<OrganizationDetail />} />
        <Route path="/candidates" element={<Candidates />} />
        <Route path="/hiring" element={<Hiring />} />
        <Route path="/tenant/users" element={<CompanyClientUsers />} />
        <Route path="/tenant/roles" element={<CompanyClientRoles />} />
        <Route path="/tenant/invitations" element={<CompanyClientInvitations />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <CurrentCompanyClientProvider>
              <CurrentEntityProvider>
                <SalaryProvider>
                  <AppRoutes />
                </SalaryProvider>
              </CurrentEntityProvider>
            </CurrentCompanyClientProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
)

export default App