import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import {
  changePassword,
  passwordChangeError,
  updateOwnAvatar,
  updateOwnProfile,
} from "@/domains/access-control"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Pencil, KeyRound, Upload, Check } from "lucide-react"

const Account = () => {
  const { user, profile, isPlatformSuperAdmin, isProfileActive, logout } = useAuth()
  const [formData, setFormData] = React.useState({
    full_name: profile?.full_name || "",
    username: profile?.username || "",
    avatar_url: profile?.avatar_url || "",
  })
  const [passwordData, setPasswordData] = React.useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  })
  const [loading, setLoading] = React.useState(false)
  const [passwordLoading, setPasswordLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Los datos de la cuenta y el avatar los guarda el dominio de control de acceso.
      await updateOwnProfile(user?.id ?? "", {
        fullName: formData.full_name,
        username: formData.username,
        avatarUrl: formData.avatar_url,
      })

      if (avatarFile) {
        await updateOwnAvatar(user?.id ?? "", avatarFile)
      }

      setSuccess("Cambios guardados correctamente.")
    } catch (err) {
      console.error("Error saving profile:", err)
      setError("No se pudieron guardar los cambios.")
    } finally {
      setLoading(false)
      setAvatarFile(null)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordLoading(true)
    setError(null)

    // La coincidencia de las contraseñas nuevas es una regla pura del dominio.
    const passwordError = passwordChangeError(
      passwordData.new_password,
      passwordData.confirm_password
    )
    if (passwordError) {
      setError(passwordError)
      setPasswordLoading(false)
      return
    }

    try {
      await changePassword(passwordData.new_password)

      setSuccess("Contraseña actualizada correctamente.")
      setPasswordData({ current_password: "", new_password: "", confirm_password: "" })
    } catch (err) {
      console.error("Error changing password:", err)
      setError("No se pudo cambiar la contraseña.")
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAvatarFile(e.target.files[0])
    }
  }

  return (
    <div className="space-y-6 p-6">
      <SiteCorpPageHeader
        title="Mi cuenta"
        description="Información de tu cuenta de usuario"
      />

      {error && (
        <SiteCorpAlert type="danger" title="Error">
          {error}
        </SiteCorpAlert>
      )}
      {success && (
        <SiteCorpAlert type="success" title="Éxito">
          {success}
        </SiteCorpAlert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <SiteCorpCard title="Información personal">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="Avatar" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <AvatarFallback className="bg-sitecorp-primary text-lg font-bold text-white">
                    {profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Foto de perfil</label>
                <SiteCorpButton type="button" variant="outline" size="sm" className="w-full justify-center">
                  <Upload className="h-4 w-4 mr-2" /> Cambiar foto
                </SiteCorpButton>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                  id="avatar-upload"
                />
                <label htmlFor="avatar-upload" className="sr-only">
                  Subir avatar
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Nombre completo</label>
              <SiteCorpInput
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Usuario</label>
              <SiteCorpInput
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Email</label>
              <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-ink">
                {user?.email}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Estado</span>
              <SiteCorpStatusBadge status={isProfileActive ? "success" : "warning"}>
                {isProfileActive ? "Activo" : "Inactivo"}
              </SiteCorpStatusBadge>
            </div>
            <SiteCorpButton type="submit" className="w-full justify-center" disabled={loading}>
              {loading ? <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Guardando...</span> : "Guardar cambios"}
            </SiteCorpButton>
          </form>
        </SiteCorpCard>

        <SiteCorpCard title="Seguridad">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-sitecorp-primary" />
              <div>
                <p className="text-sm font-medium text-ink">Cambiar contraseña</p>
                <p className="text-xs text-muted-foreground">Actualiza tu contraseña de acceso</p>
              </div>
            </div>
            <form onSubmit={handlePasswordChange} className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Contraseña actual</label>
                <SiteCorpInput
                  type="password"
                  value={passwordData.current_password}
                  onChange={(e) => setPasswordData({ ...passwordData, current_password: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Nueva contraseña</label>
                <SiteCorpInput
                  type="password"
                  value={passwordData.new_password}
                  onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Confirmar contraseña</label>
                <SiteCorpInput
                  type="password"
                  value={passwordData.confirm_password}
                  onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                  required
                />
              </div>
              <SiteCorpButton type="submit" className="w-full justify-center" disabled={passwordLoading}>
                {passwordLoading ? "Actualizando..." : "Actualizar contraseña"}
              </SiteCorpButton>
            </form>
          </div>
        </SiteCorpCard>

        <SiteCorpCard title="Roles y permisos">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <SiteCorpStatusBadge status={isPlatformSuperAdmin ? "success" : "warning"} />
              <span className="text-sm font-medium text-ink">
                {isPlatformSuperAdmin ? "SuperAdmin" : "Rol de plataforma"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {isPlatformSuperAdmin
                ? "Tienes acceso completo a la administración global de SiteCorp."
                : "Tienes acceso limitado a la plataforma. Contacta a tu administrador."}
            </p>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground">
                No puedes cambiar tu propio rol o permisos.
              </p>
            </div>
          </div>
        </SiteCorpCard>

        <SiteCorpCard title="Acción">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cierra tu sesión actual en este dispositivo.
            </p>
            <SiteCorpButton
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

export default Account
