import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronUp, KeyRound, LogOut, User as UserIcon } from "lucide-react"

interface SidebarUserMenuProps {
  /**
   * Ruta de la cuenta personal del usuario, o `null` si el usuario no tiene una
   * pantalla de cuenta disponible (p. ej. usuario normal de empresa). Si es null
   * solo se ofrece "Cerrar sesión".
   */
  accountPath?: string | null
  className?: string
}

/**
 * Bloque del usuario autenticado, fijo en la parte inferior del sidebar.
 *
 * Muestra el NOMBRE COMPLETO del usuario (o el email como último recurso) y, al
 * pulsarlo, un menú con las opciones que antes vivían en "Mi cuenta": ver/editar
 * la cuenta, cambiar contraseña y cerrar sesión. No cambia de contexto: la cuenta
 * personal pertenece al usuario, no a la entidad.
 */
export function SidebarUserMenu({ accountPath = null, className }: SidebarUserMenuProps) {
  const { user, profile, avatarUrl, logout } = useAuth()
  const navigate = useNavigate()

  // Fuente de verdad del nombre: profiles.full_name (igual que la pantalla de
  // cuenta). Si no existe, se usa el nombre de los metadatos de Auth y, por
  // último, el email. Nunca se duplica el nombre en otra tabla.
  const name = React.useMemo(() => {
    const fullName = String(profile?.full_name || "").trim()
    if (fullName) return fullName

    const metadata = (user?.user_metadata || {}) as Record<string, unknown>
    const metaName = [metadata.full_name, metadata.name].find(
      (value) => typeof value === "string" && value.trim().length > 0,
    ) as string | undefined
    if (metaName) return metaName.trim()

    const username = String(profile?.username || "").trim()
    if (username) return username

    return ""
  }, [profile, user])

  const email = user?.email || ""
  const displayName = name || email || "Usuario"
  const initials = React.useMemo(() => {
    const parts = displayName.split(/\s+/).filter(Boolean)
    const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "")
    return letters.join("") || "U"
  }, [displayName])

  const handleAccount = () => {
    if (accountPath) navigate(accountPath)
  }

  const handleLogout = async () => {
    await logout()
    navigate("/login")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={displayName}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted",
            className,
          )}
        >
          <Avatar className="h-9 w-9">
            {/*
              La imagen se pinta con la URL FIRMADA del contexto, nunca con la ruta guardada
              en `profiles.avatar_url`: el bucket de avatares es privado.
            */}
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
            <AvatarFallback className="bg-sitecorp-primary text-xs font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{displayName}</span>
            {name && email ? (
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            ) : null}
          </span>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="min-w-0">
          <span className="block truncate text-sm font-medium">{displayName}</span>
          {email ? <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accountPath ? (
          <>
            <DropdownMenuItem onSelect={handleAccount}>
              <UserIcon className="mr-2 h-4 w-4" />
              Mi cuenta
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAccount}>
              <KeyRound className="mr-2 h-4 w-4" />
              Cambiar contraseña
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
