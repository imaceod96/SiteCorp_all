import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import {
  changeInitialPassword,
  passwordChangeError,
  passwordStrengthError,
} from "@/modules/access-control"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/shared/components/ui/sitecorp-alert"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { KeyRound, ShieldCheck } from "lucide-react"

/**
 * Cambio OBLIGATORIO de la contraseña inicial.
 *
 * La monta `AppRoutes` en exclusiva mientras `passwordChangeRequired === "required"`: NO se
 * monta ningún layout ni página protegida, así que no puede saltarse por navegación. Aun
 * así, la barrera REAL es del backend (helper SQL + RLS + Edge Function): esta pantalla es la
 * parte de experiencia, no la de seguridad.
 *
 * La contraseña la actualiza el servidor (Edge Function) y la confirma con `mark_password_changed`;
 * este componente nunca invoca la RPC de confirmación.
 */
const MustChangePassword = () => {
  const { refreshPasswordRequirement, logout } = useAuth()
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Reglas puras del dominio (el servidor vuelve a validar).
    const strengthError = passwordStrengthError(newPassword)
    if (strengthError) {
      setError(strengthError)
      return
    }
    const mismatchError = passwordChangeError(newPassword, confirmPassword)
    if (mismatchError) {
      setError(mismatchError)
      return
    }

    setLoading(true)
    try {
      await changeInitialPassword(newPassword)
      // Limpia el estado local y vuelve a resolver el requisito: si el servidor confirmó el
      // cambio, el bloqueo se levanta y `AppRoutes` deja pasar al usuario a la aplicación.
      setNewPassword("")
      setConfirmPassword("")
      await refreshPasswordRequirement()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo cambiar la contraseña. Inténtalo de nuevo."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sitecorp-background p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <SiteCorpBrand variant="full" size="lg" className="w-full max-w-[420px] h-auto" />
        </div>

        <SiteCorpCard>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sitecorp-primary/10">
              <KeyRound className="h-5 w-5 text-sitecorp-primary" />
            </span>
            <div>
              <p className="text-base font-semibold text-ink">Cambia tu contraseña inicial</p>
              <p className="text-xs text-muted-foreground">
                Es obligatorio cambiar la contraseña temporal antes de continuar.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4">
              <SiteCorpAlert type="danger" title="Error">
                {error}
              </SiteCorpAlert>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Nueva contraseña</label>
              <SiteCorpInput
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Confirmar contraseña</label>
              <SiteCorpInput
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="rounded-lg bg-muted p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-ink">
                <ShieldCheck className="h-4 w-4 text-sitecorp-primary" /> Requisitos de seguridad
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Al menos 12 caracteres</li>
                <li>Una letra mayúscula y una minúscula</li>
                <li>Al menos un número</li>
                <li>Al menos un símbolo</li>
              </ul>
            </div>

            <SiteCorpButton type="submit" className="w-full justify-center" disabled={loading}>
              {loading ? "Actualizando..." : "Cambiar contraseña y continuar"}
            </SiteCorpButton>
          </form>

          <div className="mt-4 border-t border-border pt-4">
            <SiteCorpButton
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={logout}
            >
              Cerrar sesión
            </SiteCorpButton>
          </div>
        </SiteCorpCard>
      </div>
    </div>
  )
}

export default MustChangePassword
