import { supabase } from "@/lib/supabase"
import { rpcName, selectQuery, tableName } from "@/integrations/supabase/schema-target"
import type { User } from "@supabase/supabase-js"
import type { AuthMembershipRecord } from "../domain/entities"

/**
 * Control de acceso — Repositorio de AUTENTICACIÓN Y SESIÓN (infraestructura).
 *
 * Único punto desde el que se habla con Supabase Auth y con las dos RPC que resuelven el
 * nivel de plataforma. La CONFIGURACIÓN de Auth no se toca: no se cambian proveedores,
 * redirecciones ni políticas; sólo se consultan la sesión, el inicio y el cierre de sesión
 * y el cambio de contraseña del propio usuario, con los mismos contratos de RPC.
 *
 * Política de errores (la que ya tenía el proveedor de autenticación, sin cambios):
 *   · LECTURAS de identidad: un fallo no rompe la carga (perfil `null`, listas vacías).
 *   · RPC de permisos: `has_platform_permission` propaga el fallo; la variante «segura»
 *     de la capa de aplicación lo traduce a «sin permiso».
 *   · COMANDOS (contraseña, cierre de sesión): propagan el error; la pantalla decide el
 *     mensaje que ve el usuario.
 */

/** Bucket privado/publicado de los avatares de usuario (no cambia). */
const AVATARS_BUCKET = "avatars"

/** Usuario de la sesión actual, o `null` si no hay sesión. */
export async function selectSessionUser() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.user ?? null
}

/**
 * Suscripción a los cambios de estado de Auth.
 *
 * El manejador recibe el evento y el USUARIO de la sesión (o `null`), y devuelve la función
 * para darse de baja. La interpretación de cada evento es de la presentación.
 */
export function subscribeAuthStateChanges(
  handler: (event: string, user: User | null) => void
): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    handler(event, session?.user ?? null)
  })

  return () => subscription.unsubscribe()
}

/**
 * Inicio de sesión con correo y contraseña.
 *
 * Devuelve el MENSAJE de error del servidor o `null` si la sesión se abrió. El texto es el
 * del backend, tal como lo mostraba la pantalla de acceso.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<string | null> {
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  return signInError?.message ?? null
}

/** Cierre de la sesión actual. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/** Cambio de la contraseña del propio usuario autenticado. */
export async function updateOwnPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

/**
 * Avatar del propio usuario: subida al bucket de avatares y URL pública resuelta.
 *
 * La ruta es la MISMA que usaba la pantalla (`<user_id>/<nombre del archivo>`), de modo que
 * las políticas de Storage de cada usuario siguen resolviéndose igual.
 */
export async function uploadOwnAvatar(userId: string, file: File): Promise<string> {
  const filePath = `${userId}/${file.name}`

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(filePath, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const { data: publicUrlData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(filePath)
  return publicUrlData.publicUrl
}

/** Estado de superadministrador de plataforma (`is_platform_superadmin`). */
export async function rpcIsPlatformSuperAdmin(): Promise<boolean> {
  const { data } = await supabase.rpc("is_platform_superadmin")
  return Boolean(data)
}

/** Nivel de usuario de plataforma (`is_platform_user`: al menos un rol activo). */
export async function rpcIsPlatformUser(): Promise<boolean> {
  const { data } = await supabase.rpc("is_platform_user")
  return Boolean(data)
}

/** Membresías ACTIVAS de la sesión, con su cliente propietario. */
export async function selectActiveMemberships(userId: string): Promise<AuthMembershipRecord[]> {
  const { data } = await supabase
    .from(tableName("memberships"))
    .select(selectQuery(`*, tenant:${tableName("clients")}(*)`))
    .eq("user_id", userId)
    .eq("is_active", true)

  return (data as AuthMembershipRecord[] | null) || []
}

/**
 * Permiso de CLIENTE del solicitante (Nivel 2) mediante `has_tenant_permission`.
 *
 * El nombre del argumento (`permission_code`) es el contrato del backend y no cambia.
 * Propaga el fallo: la variante «segura» vive en la capa de aplicación.
 */
export async function rpcHasClientPermission(permissionCode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(rpcName("hasClientPermission"), {
    permission_code: permissionCode,
  })
  if (error) throw error
  return Boolean(data)
}
