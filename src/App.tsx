import * as React from "react"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as Sonner } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { AuthProvider } from "@/contexts/AuthProvider"
import { CurrentCompanyClientProvider } from "@/contexts/CurrentCompanyClientProvider"
import { useCurrentEntity } from "@/contexts/CurrentEntityContext"
import { CurrentEntityProvider } from "@/contexts/CurrentEntityProvider"
import { SalaryProvider } from "@/contexts/SalaryProvider"
import { PlatformAdminLayout } from "@/components/platform-admin-layout"
import EntityRouteWrapper from "@/components/entity-route-wrapper"
import { CompanyClientLayout } from "@/components/company-client-layout"
import { SiteCorpBrand } from "@/components/sitecorp-brand"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import Login from "./pages/Login"
import Index from "./pages/Index"
import Organization from "./pages/Organization"
import OrganizationDetail from "./pages/OrganizationDetail"
import Candidates from "./pages/Candidates"
import Hiring from "./pages/Hiring"
import Admin from "./pages/Admin"
import Account from "./pages/Account"
import Organizations from "./pages/Organizations"
import PlatformUsers from "./pages/PlatformUsers"
import RolesPermissions from "./pages/RolesPermissions"
import CompanyClientUsers from "./pages/CompanyClientUsers"
import CompanyClientInvitations from "./pages/CompanyClientInvitations"
import CompanyClientRoles from "./pages/CompanyClientRoles"
import AdminSettingsSalaryScale from "./pages/AdminSettingsSalaryScale"
import EntitySummary from "./pages/EntitySummary"
import EntityCandidates from "./pages/EntityCandidates"
import EntityPrenomina from "./pages/EntityPrenomina"
import CandidateDetail from "./pages/CandidateDetail"
import CandidateEdit from "./pages/CandidateEdit"
import EntityStaffing from "./pages/EntityStaffing"
import EntityWorkers from "./pages/EntityWorkers"
import EntityReentries from "./pages/EntityReentries"
import EntityHiring from "./pages/EntityHiring"
import EntityContractAlerts from "./pages/EntityContractAlerts"
import EntityVacations from "./pages/EntityVacations"
import EntityMedicalCertificates from "./pages/EntityMedicalCertificates"
import EntityPendingDocuments from "./pages/EntityPendingDocuments"
import WorkerDetail from "./pages/WorkerDetail"
import EntitySettings from "./pages/EntitySettings"
import EntitySettingsUsers from "./pages/EntitySettingsUsers"
import EntitySettingsRoles from "./pages/EntitySettingsRoles"
import EntitySettingsSalary from "./pages/EntitySettingsSalary"
import EntitySettingsTenureScale from "./pages/EntitySettingsTenureScale"
import EntitySettingsGoverningDocuments from "./pages/EntitySettingsGoverningDocuments"
import EntitySettingsStaffing from "./pages/EntitySettingsStaffing"
import EntitySettingsContractData from "./pages/EntitySettingsContractData"
import EntitySettingsDocumentTemplates from "./pages/EntitySettingsDocumentTemplates"
import EntitySettingsDocumentTemplateDetail from "./pages/EntitySettingsDocumentTemplateDetail"
import EntitySettingsInitialImport from "./pages/EntitySettingsInitialImport"
import NotFound from "./pages/NotFound"

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

// Loading screen component
//
// Pantalla NEUTRAL obligatoria: se muestra mientras se resuelve la sesión y la identidad
// (perfil, nivel de plataforma y membresías) y hasta que se puede decidir la interfaz. Fondo
// blanco a pantalla completa, logo oficial centrado e indicador de carga accesible. Sin menú
// lateral, sin encabezado de cliente, sin tarjetas y sin ningún contenido cargando detrás.
// No introduce ningún retraso: desaparece en cuanto la identidad y el destino están resueltos.
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

// Identity error screen component
//
// Estado neutral de error: la identidad NO se pudo determinar (fallo de red o de RPC). No se
// elige ninguna interfaz ni se concede ningún privilegio por defecto; el usuario puede
// reintentar sin cerrar el navegador. El mensaje no expone detalle técnico.
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

// /panel compatibility redirect: resolves to the sibling canonical route
// /entity/<REAL_ENTITY_ID>/summary (NOT /entity/<id>/panel/summary)
const EntityPanelRedirect = () => {
  const { entityId } = useParams<{ entityId: string }>()
  return <Navigate to={`/entity/${entityId}/summary`} replace />
}

// Main routing logic
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

  // La identidad no se pudo determinar (fallo de red o de RPC): estado neutral de error con
  // reintento manual. Nunca se elige interfaz ni se conceden privilegios por defecto.
  if (identityError) {
    return <IdentityErrorScreen onRetry={retryIdentity} />
  }

  // Mientras la identidad no esté resuelta NO se decide ninguna interfaz: pantalla neutral.
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

  // Entity routes are evaluated BEFORE platform/company-client branching.
  // currentCompanyClient is intentionally NOT used here: Platform users may have
  // a null active client, and a stale non-null client must not hide entity
  // routes. EntityRouteWrapper remains responsible for authorization.
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

  // Platform User (any active Platform Role, including SuperAdmin)
  // -> Global Platform Administration.
  // currentCompanyClient is intentionally NOT required: a Platform User's
  // default application is Global Administration.
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

  // Client user -> Company Client application
  // Las rutas `/tenant/*` se conservan: son el contrato de navegación vigente.
  //
  // Esta rama es la ÚLTIMA y se alcanza SÓLO con la identidad resuelta y sin error: un usuario
  // de cliente se identifica DESPUÉS de resolver su identidad (perfil, nivel de plataforma y
  // membresías), nunca por descarte prematuro mientras la identidad es desconocida.
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
