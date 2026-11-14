import * as React from "react"
import { useLocation } from "react-router-dom"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true
    return window.matchMedia("(min-width: 768px)").matches
  })

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const media = window.matchMedia("(min-width: 768px)")
    const onChange = () => setIsDesktop(media.matches)
    onChange()
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return isDesktop
}

export interface ResponsiveShellRenderState {
  /** Verdadero únicamente en móvil/tablet estrecha cuando la barra está contraída a solo iconos. */
  collapsed: boolean
  isDesktop: boolean
  expandSidebar: () => void
  collapseSidebar: () => void
}

interface ResponsiveAppShellProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  renderHeader: (state: ResponsiveShellRenderState) => React.ReactNode
  renderNav: (state: ResponsiveShellRenderState) => React.ReactNode
  renderFooter: (state: ResponsiveShellRenderState) => React.ReactNode
  children: React.ReactNode
}

/**
 * Marco responsivo unificado para los tres espacios de SiteCorp:
 * - Escritorio (>= 768px): barra lateral fija completa de `256 px`.
 * - Móvil (< 768px): barra lateral contraíble a una columna de iconos (`56 px`) para
 *   dar máximo espacio al área de trabajo; al expandirse se despliega a `256 px` sobre
 *   el contenido con cierre automático al navegar, pulsar el fondo o `Escape`.
 */
export const ResponsiveAppShell = React.forwardRef<HTMLDivElement, ResponsiveAppShellProps>(
  ({ className, renderHeader, renderNav, renderFooter, children, ...props }, ref) => {
    const isDesktop = useIsDesktop()
    const [mobileExpanded, setMobileExpanded] = React.useState(false)
    const location = useLocation()

    const collapsed = !isDesktop && !mobileExpanded
    const expandSidebar = React.useCallback(() => setMobileExpanded(true), [])
    const collapseSidebar = React.useCallback(() => setMobileExpanded(false), [])

    // Colapsar automáticamente el menú desplegado en móvil al cambiar de ruta
    React.useEffect(() => {
      setMobileExpanded(false)
    }, [location.pathname])

    // Si pasa a escritorio, limpiar estado móvil
    React.useEffect(() => {
      if (isDesktop) setMobileExpanded(false)
    }, [isDesktop])

    // Cerrar con Escape cuando está desplegado en móvil
    React.useEffect(() => {
      if (isDesktop || !mobileExpanded) return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setMobileExpanded(false)
      }
      window.addEventListener("keydown", handleKeyDown)
      return () => window.removeEventListener("keydown", handleKeyDown)
    }, [isDesktop, mobileExpanded])

    const shellState: ResponsiveShellRenderState = React.useMemo(
      () => ({
        collapsed,
        isDesktop,
        expandSidebar,
        collapseSidebar,
      }),
      [collapsed, isDesktop, expandSidebar, collapseSidebar]
    )

    return (
      <div
        ref={ref}
        className={cn("flex h-dvh w-full overflow-hidden", className)}
        {...props}
      >
        {/* Fondo atenuado cuando el sidebar móvil está desplegado */}
        {!isDesktop && mobileExpanded && (
          <button
            type="button"
            aria-label="Contraer menú lateral"
            onClick={collapseSidebar}
            className="fixed inset-0 z-30 bg-ink/40 backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none md:hidden"
          />
        )}

        {/* Sidebar (contraíble a iconos en móvil, fijo completo en escritorio) */}
        <aside
          aria-label="Navegación principal"
          className={cn(
            "fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r border-border bg-card transition-[width] duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "w-14" : "w-64 shadow-xl md:shadow-none"
          )}
        >
          {/* Cabecera */}
          <div
            className={cn(
              "flex h-14 md:h-16 shrink-0 items-center border-b border-border",
              collapsed ? "justify-center px-1.5" : "justify-between gap-2 px-4"
            )}
          >
            {collapsed ? (
              <button
                type="button"
                onClick={expandSidebar}
                aria-label="Expandir menú lateral"
                title="Expandir menú"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-sitecorp-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PanelLeftOpen className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="min-w-0 flex-1">{renderHeader(shellState)}</div>
                {!isDesktop && (
                  <button
                    type="button"
                    onClick={collapseSidebar}
                    aria-label="Contraer menú lateral"
                    title="Contraer menú"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Navegación con scroll interno */}
          <nav
            className={cn(
              "flex-1 overflow-y-auto overflow-x-hidden",
              collapsed ? "px-1.5 py-3" : "p-4"
            )}
          >
            {renderNav(shellState)}
          </nav>

          {/* Pie fijo */}
          <div
            className={cn(
              "shrink-0 border-t border-border",
              collapsed ? "p-1.5" : "p-3"
            )}
          >
            {renderFooter(shellState)}
          </div>
        </aside>

        {/* Área de trabajo principal */}
        <main className="ml-14 md:ml-64 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-sitecorp-background">
          {children}
        </main>
      </div>
    )
  }
)
ResponsiveAppShell.displayName = "ResponsiveAppShell"
