import * as React from "react"
import {
  MANUAL_METADATA,
  ARCHITECTURE_OVERVIEW,
  ENTITY_INITIAL_SETUP_FLOW,
  MANUAL_SECTIONS,
  ROLES_MATRIX,
  GLOSSARY_TERMS,
  type ManualSection,
} from "../../domain/manual-data"
import { UserManualPdfService } from "../../application/pdf-generator.service"
import { ManualViewWireframe } from "../components/ManualViewWireframe"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"
import { SiteCorpPageHeader } from "@/shared/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { Button } from "@/shared/components/ui/button"
import { Input } from "@/shared/components/ui/input"
import { Badge } from "@/shared/components/ui/badge"
import { toast } from "sonner"
import {
  Download,
  BookOpen,
  Search,
  Layers,
  Shield,
  FileText,
  Building2,
  Users,
  CheckCircle2,
  ExternalLink,
  Printer,
  ChevronRight,
  HelpCircle,
  Sparkles,
} from "lucide-react"
import { useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"

export const UserManualPage: React.FC = () => {
  const location = useLocation()
  const isEntityMode = location.pathname.startsWith("/entity/")
  const mode: "gestor" | "entity" = isEntityMode ? "entity" : "gestor"

  const baseSections = React.useMemo(() => {
    return isEntityMode
      ? MANUAL_SECTIONS.filter((s) => s.category !== "global")
      : MANUAL_SECTIONS
  }, [isEntityMode])

  const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all")
  const [activeSectionId, setActiveSectionId] = React.useState<string>(baseSections[0]?.id || "")

  React.useEffect(() => {
    if (baseSections.length > 0 && !baseSections.some((s) => s.id === activeSectionId)) {
      setActiveSectionId(baseSections[0].id)
    }
  }, [baseSections, activeSectionId])

  const handleDownloadPdf = async () => {
    try {
      setIsGeneratingPdf(true)
      toast.info(
        isEntityMode
          ? "Generando Manual de Gestión de Entidad en PDF..."
          : "Generando Manual de Gestores SiteCorp en PDF...",
        {
          description: "Compilando especificaciones, esquemas visuales y procedimientos paso a paso.",
        }
      )
      await UserManualPdfService.generateAndDownloadManual(mode)
      toast.success("¡Manual descargado con éxito!", {
        description: isEntityMode
          ? `Archivo: Manual_SiteCorp_Gestion_Entidad_v${MANUAL_METADATA.version}.pdf`
          : `Archivo: Manual_SiteCorp_Gestores_Plataforma_v${MANUAL_METADATA.version}.pdf`,
      })
    } catch (err) {
      console.error("Error al generar PDF:", err)
      toast.error("Ocurrió un error al compilar el PDF", {
        description: err instanceof Error ? err.message : "Error inesperado",
      })
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  // Filtrado de secciones
  const filteredSections = React.useMemo(() => {
    return baseSections.filter((sec) => {
      const matchesCategory =
        selectedCategory === "all" || sec.category === selectedCategory
      const matchesSearch =
        searchTerm.trim() === "" ||
        sec.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sec.subtitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sec.purpose.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (sec.route && sec.route.toLowerCase().includes(searchTerm.toLowerCase()))
      return matchesCategory && matchesSearch
    })
  }, [baseSections, selectedCategory, searchTerm])

  const categories = React.useMemo(() => {
    if (isEntityMode) {
      return [
        { id: "all", label: "Todas las Vistas de Entidad", count: baseSections.length },
        {
          id: "operativa",
          label: "Operación de Personal",
          count: baseSections.filter((s) => s.category === "operativa").length,
        },
        {
          id: "sst_bienestar",
          label: "SST y Salud Ocupacional",
          count: baseSections.filter((s) => s.category === "sst_bienestar").length,
        },
      ].filter((cat) => cat.count > 0 || cat.id === "all")
    }
    return [
      { id: "all", label: "Todas las Vistas (Plataforma y Entidad)", count: baseSections.length },
      {
        id: "global",
        label: "Administración Global",
        count: baseSections.filter((s) => s.category === "global").length,
      },
      {
        id: "operativa",
        label: "Gestión de Entidad",
        count: baseSections.filter((s) => s.category === "operativa").length,
      },
      {
        id: "sst_bienestar",
        label: "SST y Salud Ocupacional",
        count: baseSections.filter((s) => s.category === "sst_bienestar").length,
      },
    ].filter((cat) => cat.count > 0 || cat.id === "all")
  }, [isEntityMode, baseSections])

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* Header institucional superior */}
      <div className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <SiteCorpBrand variant="isotype" size="sm" />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                    {isEntityMode ? "Manual de Usuario · Gestión de Entidad" : "Manual de Gestores SiteCorp"}
                  </h1>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                    {isEntityMode ? "Entidad Operativa" : "Gestión Global"}
                  </Badge>
                  <span className="hidden sm:inline-block text-xs text-slate-400 font-mono">
                    v{MANUAL_METADATA.version}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {isEntityMode
                    ? "Guía operativa de personal, plantilla, contratación, SST, descansos y prenómina"
                    : "Gobernanza completa de plataforma, clientes, planes comerciales y operaciones globales"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                className="hidden sm:flex items-center gap-1.5 text-xs text-slate-700"
              >
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>

              <Button
                size="sm"
                onClick={handleDownloadPdf}
                disabled={isGeneratingPdf}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-2 shadow-xs transition-all"
              >
                <Download className="h-4 w-4" />
                {isGeneratingPdf ? "Generando PDF..." : "Descargar Manual en PDF"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Banner de introducción & Arquitectura */}
        <div className="rounded-2xl border border-slate-200 bg-linear-to-r from-slate-900 via-slate-850 to-blue-950 p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
          <div className="relative z-10 max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5" />
              Documentación Operativa y Técnica
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Ecosistema SiteCorp: Gestión Integral de Talento, Nómina y SST
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Este manual contiene la especificación funcional y visual de las 17 interfaces
              principales del sistema. A través de este portal interactivo o del documento PDF
              descargable, los usuarios pueden consultar los procedimientos paso a paso, los
              permisos requeridos y las reglas de negocio de cada proceso operativo.
            </p>

            <div className="pt-2 flex flex-wrap gap-4 text-xs text-slate-300">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Nivel Global (/admin) y Nivel Entidad (/entity)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Seguridad Multi-Tenant con Row Level Security</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Secuencia de Configuración en 5 Pasos Obligatorios</span>
              </div>
            </div>
          </div>
        </div>

        {/* Guía en 5 Pasos para Configuración Inicial de Entidad (Exclusivo Gestores) */}
        {!isEntityMode && (
          <div className="rounded-2xl border-2 border-indigo-200 bg-linear-to-b from-indigo-50/70 to-white p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-indigo-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-xs">
                  5
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    {ENTITY_INITIAL_SETUP_FLOW.title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {ENTITY_INITIAL_SETUP_FLOW.subtitle}
                  </p>
                </div>
              </div>
              <Badge className="bg-indigo-600 text-white hover:bg-indigo-700 text-xs px-2.5 py-1">
                Flujo Técnico Obligatorio
              </Badge>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {ENTITY_INITIAL_SETUP_FLOW.description}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
              {ENTITY_INITIAL_SETUP_FLOW.steps.map((st) => (
                <div
                  key={st.stepNumber}
                  className="rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs space-y-2 flex flex-col justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs">
                        {st.stepNumber}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">Paso {st.stepNumber}/5</span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-900 leading-snug">
                      {st.shortName}
                    </h4>
                    <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed">
                      {st.objective}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <span className="text-[10px] font-semibold text-indigo-600 block">
                      Prelación obligatoria:
                    </span>
                    <span className="text-[10px] text-slate-500 line-clamp-2">
                      {st.whyOrderMatters}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Barra de Filtros y Búsqueda */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por módulo, vista o palabra clave (ej. SST, Prenómina, Plan)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 text-xs h-9 bg-slate-50/50"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5",
                  selectedCategory === cat.id
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <span>{cat.label}</span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.2 rounded-full",
                    selectedCategory === cat.id
                      ? "bg-blue-500 text-white"
                      : "bg-slate-200 text-slate-700"
                  )}
                >
                  {cat.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Layout en dos columnas: Índice lateral y Fichas de Vista */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna Izquierda: Índice Rápido (Sticky) */}
          <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-blue-600" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Índice de Vistas ({filteredSections.length})
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">Clic para saltar</span>
              </div>

              <div className="mt-3 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                {filteredSections.map((sec, idx) => {
                  const isActive = activeSectionId === sec.id
                  return (
                    <a
                      key={sec.id}
                      href={`#sec-${sec.id}`}
                      onClick={() => setActiveSectionId(sec.id)}
                      className={cn(
                        "flex items-center justify-between p-2 rounded-lg text-xs transition-colors group",
                        isActive
                          ? "bg-blue-50/80 text-blue-700 font-semibold"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className={cn(
                            "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono shrink-0",
                            isActive
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                          )}
                        >
                          {(idx + 1).toString().padStart(2, "0")}
                        </span>
                        <span className="truncate">{sec.title}</span>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-transform",
                          isActive ? "text-blue-600 translate-x-0.5" : "text-slate-300"
                        )}
                      />
                    </a>
                  )
                })}

                {filteredSections.length === 0 && (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No se encontraron vistas con el filtro seleccionado.
                  </p>
                )}
              </div>
            </div>

            {/* Tarjeta de descarga rápida lateral */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-blue-900 font-semibold text-xs">
                <FileText className="h-4 w-4 text-blue-600" />
                <span>¿Deseas imprimir o compartir el manual?</span>
              </div>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                Descarga el manual completo en PDF para distribuirlo a los nuevos administradores,
                supervisores de SST y jefes de recursos humanos.
              </p>
              <Button
                size="sm"
                onClick={handleDownloadPdf}
                disabled={isGeneratingPdf}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Descargar Documento PDF
              </Button>
            </div>
          </div>

          {/* Columna Derecha: Contenido Extenso de Vistas */}
          <div className="lg:col-span-8 space-y-8">
            {filteredSections.map((sec, idx) => (
              <div
                key={sec.id}
                id={`sec-${sec.id}`}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6 scroll-mt-24 transition-all"
              >
                {/* Cabecera de la ficha */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-mono text-[10px] font-bold">
                        VISTA {(idx + 1).toString().padStart(2, "0")}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider",
                          sec.category === "global" && "bg-purple-50 text-purple-700 border-purple-200",
                          sec.category === "operativa" && "bg-blue-50 text-blue-700 border-blue-200",
                          sec.category === "sst_bienestar" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                          sec.category === "configuracion" && "bg-amber-50 text-amber-700 border-amber-200"
                        )}
                      >
                        {sec.category === "global" ? "Plataforma Global" : "Entidad Operativa"}
                      </Badge>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">{sec.title}</h3>
                    <p className="text-xs text-slate-500">{sec.subtitle}</p>
                  </div>

                  {sec.route && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-mono text-xs border border-slate-200">
                      <span>{sec.route}</span>
                    </div>
                  )}
                </div>

                {/* Resumen de propósito y roles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200 text-xs">
                  <div className="space-y-1">
                    <span className="font-semibold text-slate-700 block">Propósito Operativo:</span>
                    <p className="text-slate-600 leading-relaxed">{sec.purpose}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="font-semibold text-slate-700 block">Roles y Permisos:</span>
                    <p className="text-slate-600">
                      <span className="font-medium text-slate-800">Roles:</span>{" "}
                      {sec.rolesAllowed.join(", ")}
                    </p>
                    <p className="text-slate-500 font-mono text-[11px] mt-0.5">
                      <span className="font-medium text-slate-700">Permisos:</span>{" "}
                      {sec.permissionsRequired.length > 0
                        ? sec.permissionsRequired.join(", ")
                        : "Acceso estándar"}
                    </p>
                  </div>
                </div>

                {/* Interfaz visual simulada (Wireframe Mockup) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-blue-600" />
                      Esquema Visual de la Interfaz
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      Simulación interactiva de pantalla
                    </span>
                  </div>
                  <ManualViewWireframe section={sec} />
                </div>

                {/* Elementos clave */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Componentes Clave de la Pantalla
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {sec.keyElements.map((elem, eidx) => (
                      <div
                        key={eidx}
                        className="p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors"
                      >
                        <span className="font-semibold text-xs text-blue-700 block">
                          {elem.name}
                        </span>
                        <p className="text-xs text-slate-600 mt-0.5">{elem.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Flujo paso a paso */}
                {sec.workflows && sec.workflows.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Procedimiento Operativo Paso a Paso
                    </h4>
                    {sec.workflows.map((wf, widx) => (
                      <div
                        key={widx}
                        className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
                      >
                        <h5 className="font-semibold text-xs text-slate-900 flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-blue-600" />
                          {wf.title}
                        </h5>
                        <div className="space-y-2 pl-3 border-l-2 border-blue-200">
                          {wf.steps.map((st, sidx) => (
                            <div key={sidx} className="flex items-start gap-2.5 text-xs">
                              <span className="font-bold text-blue-600 shrink-0">
                                {sidx + 1}.
                              </span>
                              <span className="text-slate-700 leading-relaxed">{st}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reglas de Negocio / Validaciones */}
                {sec.businessRules && sec.businessRules.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
                    <h5 className="font-semibold text-xs text-amber-900 flex items-center gap-1.5">
                      <Shield className="h-4 w-4 text-amber-700" />
                      Reglas de Negocio y Criterios de Validación
                    </h5>
                    <ul className="space-y-1.5 pl-4 list-disc text-xs text-amber-800">
                      {sec.businessRules.map((br, bidx) => (
                        <li key={bidx} className="leading-relaxed">
                          {br}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Sección de Glosario y Normativa */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <HelpCircle className="h-5 w-5 text-blue-600" />
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Glosario de Términos y Cumplimiento Normativo
              </h3>
              <p className="text-xs text-slate-500">
                Conceptos clave y normatividad laboral peruana integrada en SiteCorp
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {GLOSSARY_TERMS.map((term, tidx) => (
              <div
                key={tidx}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/40 space-y-1"
              >
                <span className="font-bold text-xs text-blue-900 block">{term.term}</span>
                <p className="text-xs text-slate-600 leading-relaxed">{term.definition}</p>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="text-xs text-slate-500">
              © 2026 SiteCorp. Todos los derechos reservados · Versión {MANUAL_METADATA.version}
            </div>
            <Button
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 px-4"
            >
              <Download className="h-4 w-4 mr-2" />
              Descargar Manual Completo en PDF
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserManualPage
