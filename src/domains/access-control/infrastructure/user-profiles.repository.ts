import { supabase } from "@/lib/supabase"
import type {
  AuthProfileRecord,
  ProfileAccountInput,
  UpdatePlatformUserInput,
} from "../domain/entities"

/**
 * Control de acceso — Repositorio de PERFILES (infraestructura).
 *
 * Único punto que escribe `public.profiles`. La tabla es la MISMA para todos los niveles:
 * la cuenta propia, la administración de plataforma y la administración de usuarios de un
 * cliente la editan desde aquí, y la lectura de sesión también pasa por aquí.
 *
 * No decide autorización: RLS y los privilegios del backend son los que permiten o rechazan
 * cada escritura. `profiles` NO almacena el correo (vive en `auth.users` y nunca se escribe
 * desde el cliente).
 */

/** Perfil de la sesión: fila completa de `profiles`. Sin fila devuelve `null`. */
export async function selectUserProfileById(userId: string): Promise<AuthProfileRecord | null> {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single()
  return (data as AuthProfileRecord | null) || null
}

/** Todos los perfiles visibles, del más reciente al más antiguo (listado de plataforma). */
export async function selectAllUserProfiles(): Promise<AuthProfileRecord[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as AuthProfileRecord[] | null) || []
}

/** Edición de los datos de la CUENTA propia (nombre, usuario y avatar). */
export async function updateUserProfileAccount(
  userId: string,
  input: ProfileAccountInput
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      username: input.username,
      avatar_url: input.avatarUrl,
    })
    .eq("id", userId)

  if (error) throw error
}

/** Avatar de la cuenta propia ya alojado en Storage (URL pública resuelta). */
export async function updateUserProfileAvatar(userId: string, avatarUrl: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId)

  if (error) throw error
}

/** Edición administrativa: sólo el nombre visible y el nombre de usuario. */
export async function updateUserProfileNames(input: UpdatePlatformUserInput): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: input.fullName, username: input.username })
    .eq("id", input.userId)

  if (error) throw error
}

/** Activación/desactivación del perfil (estado del usuario en la plataforma). */
export async function setUserProfileActive(userId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId)

  if (error) throw error
}
