import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import {
  avatarFileError,
  changePassword,
  passwordChangeError,
  removeOwnAvatar,
  updateOwnAvatar,
  updateOwnProfile,
} from "@/modules/access-control"
import { SiteCorpPageHeader } from "@/components/ui/sitecorp-page-header"
import { SiteCorpCard } from "@/components/ui/sitecorp-card"
import { SiteCorpAlert } from "@/components/ui/sitecorp-alert"
import { SiteCorpStatusBadge } from "@/components/ui/sitecorp-status-badge"
import { Button as SiteCorpButton } from "@/components/ui/sitecorp-button"
import { SiteCorpInput } from "@/components/ui/sitecorp-input"
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/components/ui/avatar"
import { KeyRound, Upload, Check, Trash2 } from "lucide-react"

const Account = () => {
  const { user, profile, avatarUrl, isPlatformSuperAdmin, isProfileActive, refreshAvatar, logout } =
    useAuth()
  // El formulario NO incluye el avatar: `profiles.avatar_url` guarda la RUTA del objeto en el
  // bucket privado y la cambia exclusivamente la operación de avatar.
  const [formData, setFormData] = React.useState({
    full_name: profile?.full_name || "",
    username: profile?.username || "",
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
  const [avatarBusy, setAvatarBusy] = React.useState(false)
  // Previsualización: la URL FIRMADA del contexto, o el archivo recién elegido sin subir.
  const [avatarPreviewUrl, setAvatarPreviewUrl] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const localPreviewRef = React.useRef<string | null>(null)

  const releaseLocalPreview = React.useCallback(() => {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current)
      localPreviewRef.current = null
    }
  }, [])

  // La URL firmada se renueva sola en el contexto (foco y 80 % de vida): aquí sólo se refleja.
  React.useEffect(() => {
    if (avatarFile) return
    setAvatarPreviewUrl(avatarUrl)
  }, [avatarUrl, avatarFile])

  React.useEffect(() => releaseLocalPreview, [releaseLocalPreview])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Los datos de la cuenta los guarda el dominio de control de acceso (sin avatar).
      await updateOwnProfile(user?.id ?? "", {
        fullName: formData.full_name,
        username: formData.username,
      })

      if (avatarFile) {
        // Sube, guarda la RUTA en el perfil y retira el objeto anterior (reemplazo).
        const avatarPath = await updateOwnAvatar(
          user?.id ?? "",
          avatarFile,
          profile?.avatar_url ?? null
        )
        await refreshAvatar(avatarPath)
        releaseLocalPreview()
        setAvatarFile(null)
      }

      setSuccess("Cambios guardados correctamente.")
    } catch (err) {
      console.error("Error saving profile:", err)
      setError("No se pudieron guardar los cambios.")
    } finally {
      setLoading(false)
    }
  }

  /** Baja del avatar propio: limpia la ruta del perfil y retira el objeto. */
  const handleRemoveAvatar = async () => {
    setAvatarBusy(true)
    setError(null)
    setSuccess(null)

    try {
      await removeOwnAvatar(user?.id ?? "", profile?.avatar_url ?? null)
      await refreshAvatar(null)
      releaseLocalPreview()
      setAvatarFile(null)
      setSuccess("Avatar eliminado correctamente.")
    } catch (err) {
      console.error("Error removing avatar:", err)
      setError("No se pudo eliminar el avatar.")
    } finally {
      setAvatarBusy(false)
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

  /**
   * Selección del archivo: se valida ANTES de subir (tipo y tamaño del bucket) y se
   * previsualiza en local. La subida real ocurre al guardar, para que cancelar no deje basura.
   */
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setSuccess(null)

    const fileError = avatarFileError(file)
    if (fileError) {
      releaseLocalPreview()
      setAvatarFile(null)
      setAvatarPreviewUrl(avatarUrl)
      setError(fileError)
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    releaseLocalPreview()
    localPreviewRef.current = URL.createObjectURL(file)
    setAvatarPreviewUrl(localPreviewRef.current)
    setAvatarFile(file)
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
                {/*
                  La imagen se pinta con una URL FIRMADA (temporal): el bucket de avatares es
                  privado y `profiles.avatar_url` guarda sólo la ruta del objeto.
                */}
                {avatarPreviewUrl ? (
                  <AvatarImage
                    src={avatarPreviewUrl}
                    alt="Avatar"
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-sitecorp-primary text-lg font-bold text-white">
                  {profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink" htmlFor="avatar-upload">
                  Foto de perfil
                </label>
                <div className="flex flex-wrap gap-2">
                  <SiteCorpButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" /> Cambiar foto
                  </SiteCorpButton>
                  {(profile?.avatar_url || avatarFile) && (
                    <SiteCorpButton
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={avatarBusy || loading}
                      onClick={() => void handleRemoveAvatar()}
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Eliminar
                    </SiteCorpButton>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                  id="avatar-upload"
                />
                <p className="text-xs text-muted-foreground">
                  {avatarFile
                    ? `Seleccionado: ${avatarFile.name}. Pulsa «Guardar cambios» para aplicarlo.`
                    : "PNG, JPG o WEBP · máximo 2 MB"}
                </p>
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
