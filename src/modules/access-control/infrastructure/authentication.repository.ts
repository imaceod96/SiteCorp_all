import { supabase } from "@/lib/supabase"
import { rpcName, selectQuery, tableName } from "@/integrations/supabase/schema-target"
import { avatarObjectPath } from "../domain/account.rules"
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
 * Política de errores:
 *   · LECTURAS de IDENTIDAD (`rpcIsPlatformSuperAdmin`, `rpcIsPlatformUser`,
 *     `selectActiveMemberships`): un fallo de red o de RPC se PROPAGA. «No se pudo
 *     determinar el privilegio» no es «no tiene el privilegio»: convertir un error en
 *     `false` o en una lista vacía degradaba al usuario a otra interfaz sin avisar.
 *     Quien decide qué hacer con el fallo es la capa de aplicación.
 *   · PERFIL del usuario: lectura tolerante (un fallo deja `null`), porque la ausencia de
 *     perfil no concede nada.
 *   · RPC de permisos: `has_platform_permission` propaga el fallo; la variante «segura»
 *     de la capa de aplicación lo traduce a «sin permiso».
 *   · COMANDOS (contraseña, cierre de sesión): propagan el error; la pantalla decide el
 *     mensaje que ve el usuario.
 */

/** Bucket PRIVADO de los avatares de usuario (`public = false`). */
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
 * Cambio de la contraseña INICIAL mediante la Edge Function `change-initial-password`.
 *
 * El cuerpo solo lleva la contraseña nueva: el `user_id` lo determina el servidor desde el
 * token verificado y la confirmación del ciclo de vida (`mark_password_changed`) la ejecuta la
 * propia función con `service_role`. El cliente nunca invoca la RPC de confirmación.
 */
export async function invokeChangeInitialPassword(newPassword: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("change-initial-password", {
    body: { new_password: newPassword },
  })

  if (error) throw error

  const result = data as { success?: boolean; error?: string } | null
  if (!result || result.success !== true) {
    throw new Error(result?.error ?? "No se pudo cambiar la contraseña.")
  }
}

/**
 * Sube el avatar del PROPIO usuario al bucket privado y devuelve la RUTA del objeto.
 *
 * Nunca devuelve una URL: el bucket es privado y la única URL válida es la firmada y temporal
 * que se resuelve al pintar. La ruta la compone el dominio (`<user_id>/<archivo>`), de modo que
 * un nombre de archivo con separadores no puede salir de la carpeta del usuario.
 *
 * `upsert: true` permite reemplazar el avatar anterior sin dejar objetos huérfanos con el
 * mismo nombre; las políticas de Storage siguen exigiendo que el titular esté activo.
 */
export async function uploadOwnAvatar(userId: string, file: File): Promise<string> {
  const filePath = avatarObjectPath(userId, file.name)

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(filePath, file, { contentType: file.type, upsert: true })
  if (uploadError) throw uploadError

  return filePath
}

/**
 * URL TEMPORAL (firmada) de un objeto de avatar, con su caducidad en milisegundos.
 * Devuelve `null` si Storage no pudo firmar (objeto ausente o sin permiso de lectura): la
 * interfaz cae entonces a las iniciales y nunca rompe la pantalla.
 */
export async function createAvatarSignedUrl(
  path: string,
  expiresInSeconds: number
): Promise<{ url: string; expiresAt: number } | null> {
  const { data, error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)

  if (error || !data?.signedUrl) return null

  return { url: data.signedUrl, expiresAt: Date.now() + expiresInSeconds * 1000 }
}

/** Retira un objeto de avatar (reemplazo del anterior o baja del avatar propio). */
export async function deleteAvatarObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(AVATARS_BUCKET).remove([path])
  if (error) throw error
}

/**
 * Estado de superadministrador de plataforma (`is_platform_superadmin`).
 *
 * Un error de la RPC se propaga: no se traduce a `false` (eso convertiría un fallo de red
 * en «no eres superadministrador» y degradaría al usuario a otra interfaz).
 */
export async function rpcIsPlatformSuperAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_superadmin")
  if (error) throw error
  return Boolean(data)
}

/**
 * Nivel de usuario de plataforma (`is_platform_user`: al menos un rol activo).
 *
 * Un error de la RPC se propaga, por la misma razón que en el caso anterior.
 */
export async function rpcIsPlatformUser(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_platform_user")
  if (error) throw error
  return Boolean(data)
}

/**
 * Membresías ACTIVAS de la sesión, con su cliente propietario.
 *
 * Un error de la consulta se propaga: una lista vacía por fallo de red no es «el usuario no
 * tiene membresías», y esa confusión decidía a qué interfaz pertenece el usuario.
 */
export async function selectActiveMemberships(userId: string): Promise<AuthMembershipRecord[]> {
  const { data, error } = await supabase
    .from(tableName("memberships"))
    .select(selectQuery(`*, tenant:${tableName("clients")}(*)`))
    .eq("user_id", userId)
    .eq("is_active", true)

  if (error) throw error
  return (data as AuthMembershipRecord[] | null) ?? []
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
