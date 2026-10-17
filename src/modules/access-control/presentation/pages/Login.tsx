import * as React from "react"
import { useNavigate } from "react-router-dom"
import { signIn } from "@/modules/access-control"
import { SiteCorpInput } from "@/shared/components/ui/sitecorp-input"
import { Button as SiteCorpButton } from "@/shared/components/ui/sitecorp-button"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpCard } from "@/shared/components/ui/sitecorp-card"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpBrand } from "@/shared/components/sitecorp-brand"

const Login = () => {
  const navigate = useNavigate()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // El inicio de sesión lo resuelve el dominio de control de acceso; el mensaje de
      // error es el del servidor, tal como se mostraba antes.
      const signInError = await signIn(email, password)

      if (signInError) {
        setError(signInError)
        return
      }

      navigate("/")
    } catch (err) {
      setError("Error inesperado. Inténtalo de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sitecorp-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <SiteCorpBrand
            variant="full"
            size="lg"
            className="w-full max-w-[420px] h-auto sm:h-auto"
          />
        </div>

        <SiteCorpCard>
          <SiteCorpPageHeader title="Iniciar sesión" />

          {error && (
            <div className="mb-4">
              <SiteCorpAlert type="danger" title="Error">
                {error}
              </SiteCorpAlert>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Email</label>
              <SiteCorpInput
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Contraseña</label>
              <SiteCorpInput
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <SiteCorpButton type="submit" className="w-full" disabled={loading}>
              {loading ? "Iniciando sesión..." : "Iniciar sesión"}
            </SiteCorpButton>
          </form>
        </SiteCorpCard>
      </div>
    </div>
  )
}

export default Login