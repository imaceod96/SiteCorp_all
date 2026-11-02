import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Check,
  ChevronsUpDown,
  Building2,
  Layers,
  Network,
  Search,
} from "lucide-react"
import { useCurrentEntity } from "@/app/providers/current-entity.context"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  useAccessibleEntities,
  getEntityTypeLabel,
  getEntityTypeBadgeClasses,
  type HierarchicalEntityNode,
} from "../hooks/use-accessible-entities"
import type { OrganizationEntity, OrganizationEntityRow } from "../../domain/entities"

interface EntitySwitcherProps {
  className?: string
}

function getEntityIcon(type: string) {
  switch (type) {
    case "business_group":
      return <Network className="h-3.5 w-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
    case "company":
      return <Building2 className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
    case "ueb":
      return <Layers className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
    default:
      return <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
}

export function EntitySwitcher({ className }: EntitySwitcherProps) {
  const { currentEntity, setCurrentEntity } = useCurrentEntity()
  const { hierarchicalList, canSwitch, isLoading } = useAccessibleEntities()
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const location = useLocation()
  const navigate = useNavigate()

  const currentType = currentEntity?.entity_type || ""
  const currentTypeLabel = getEntityTypeLabel(currentType)
  const currentBadgeClasses = getEntityTypeBadgeClasses(currentType)

  // Filtrado de la lista jerárquica si el usuario escribe en el buscador
  const filteredList = React.useMemo(() => {
    if (!searchQuery.trim()) return hierarchicalList
    const query = searchQuery.toLowerCase().trim()
    return hierarchicalList.filter(
      (node) =>
        node.entity.name.toLowerCase().includes(query) ||
        (node.entity.code && node.entity.code.toLowerCase().includes(query)) ||
        node.typeLabel.toLowerCase().includes(query)
    )
  }, [hierarchicalList, searchQuery])

  // Cambio de entidad preservando la subruta activa si es posible
  const handleSelectEntity = (selectedEntity: OrganizationEntity) => {
    if (selectedEntity.id === currentEntity?.id) {
      setIsOpen(false)
      return
    }

    // Actualizar entidad en contexto
    setCurrentEntity(selectedEntity as OrganizationEntityRow)
    setIsOpen(false)
    setSearchQuery("")

    // Calcular la nueva ruta preservando la subsección activa
    const currentPath = location.pathname
    if (currentEntity && currentPath.includes(`/entity/${currentEntity.id}`)) {
      const newPath = currentPath.replace(
        `/entity/${currentEntity.id}`,
        `/entity/${selectedEntity.id}`
      )
      navigate(newPath)
    } else {
      navigate(`/entity/${selectedEntity.id}/summary`)
    }
  }

  // CASO 1: El usuario solo tiene acceso a UNA entidad (o está cargando)
  // No puede utilizar el desplegable: se renderiza como texto plano sin botón ni flecha
  if (!canSwitch || isLoading) {
    return (
      <div className={cn("min-w-0 flex flex-col items-start gap-0.5", className)}>
        <span
          className="block max-w-[145px] truncate text-xs font-semibold text-ink"
          title={currentEntity?.name || "Entidad"}
        >
          {currentEntity?.name || "Entidad"}
        </span>
        {currentEntity && (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-medium border leading-tight",
              currentBadgeClasses
            )}
          >
            {currentTypeLabel}
          </span>
        )}
      </div>
    )
  }

  // CASO 2: El usuario tiene permisos para ver más entidades
  // Se renderiza un desplegable interactivo con árbol jerárquico
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label="Cambiar entidad de trabajo"
          className={cn(
            "group flex min-w-0 max-w-[170px] items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all",
            "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary",
            isOpen && "bg-muted shadow-xs",
            className
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="truncate text-xs font-semibold text-ink transition-colors group-hover:text-sitecorp-primary"
              title={currentEntity?.name || "Seleccionar entidad"}
            >
              {currentEntity?.name || "Entidad"}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.2 text-[9.5px] font-medium border leading-tight shrink-0",
                  currentBadgeClasses
                )}
              >
                {currentTypeLabel}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                Cambiar
              </span>
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-ink" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-80 p-0 shadow-lg border-border"
      >
        {/* Cabecera del desplegable */}
        <div className="border-b border-border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Entidades disponibles
            </h4>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {hierarchicalList.length}
            </span>
          </div>

          {/* Buscador rápido si hay más de 4 entidades */}
          {hierarchicalList.length > 4 && (
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar entidad..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1 text-xs text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sitecorp-primary"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Lista jerárquica con scroll */}
        <div className="max-h-80 overflow-y-auto p-1.5 space-y-0.5">
          {filteredList.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No se encontraron entidades coincidentes.
            </div>
          ) : (
            filteredList.map((node: HierarchicalEntityNode) => {
              const isSelected = node.entity.id === currentEntity?.id
              const depthPadding =
                node.depth === 0
                  ? "pl-2"
                  : node.depth === 1
                  ? "pl-6"
                  : "pl-10"

              return (
                <button
                  key={node.entity.id}
                  type="button"
                  onClick={() => handleSelectEntity(node.entity)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md py-1.5 pr-2.5 text-left text-xs transition-colors",
                    depthPadding,
                    isSelected
                      ? "bg-sitecorp-primary/10 font-semibold text-sitecorp-primary"
                      : "text-ink hover:bg-muted"
                  )}
                >
                  {/* Conector visual para jerarquías hijas */}
                  {node.depth > 0 && (
                    <span className="text-muted-foreground/60 select-none -mr-1">
                      └─
                    </span>
                  )}

                  {getEntityIcon(node.entity.entity_type)}

                  <span className="flex-1 truncate" title={node.entity.name}>
                    {node.entity.name}
                  </span>

                  <span
                    className={cn(
                      "rounded px-1 py-0.2 text-[9px] font-medium border shrink-0",
                      node.typeColor
                    )}
                  >
                    {node.typeLabel}
                  </span>

                  {isSelected && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-sitecorp-primary ml-1" />
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Pie con sugerencia contextual */}
        <div className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          Selecciona una entidad para alternar el espacio de trabajo.
        </div>
      </PopoverContent>
    </Popover>
  )
}
