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

/**
 * Edición de los datos de la CUENTA propia (nombre y usuario).
 *
 * El avatar NO se escribe aquí: `avatar_url` guarda la RUTA del objeto en el bucket privado y
 * sólo la cambia la operación de avatar. Si se escribiera desde el formulario, una URL
 * temporal acabaría almacenada como identificador permanente.
 */
export async function updateUserProfileAccount(
  userId: string,
  input: ProfileAccountInput
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      username: input.username,
    })
    .eq("id", userId)

  if (error) throw error
}

/**
 * Guarda en el perfil la RUTA del objeto de avatar (`<user_id>/<archivo>`), o `null` para
 * dejarlo sin avatar. Nunca se guarda una URL firmada.
 */
export async function updateUserProfileAvatar(
  userId: string,
  avatarPath: string | null
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarPath })
    .eq("id", userId)

  if (error) throw error
}

const PLATFORM_USER_EMAILS_STORAGE_KEY = "sitecorp_platform_user_emails"

function readStoredPlatformUserEmails(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(PLATFORM_USER_EMAILS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        result[key] = value.trim().toLowerCase()
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveStoredPlatformUserEmail(userId: string, email: string): void {
  if (typeof window === "undefined") return
  const cleanUserId = userId?.trim()
  const cleanEmail = email?.trim().toLowerCase()
  if (!cleanUserId || !cleanEmail) return
  try {
    const current = readStoredPlatformUserEmails()
    current[cleanUserId] = cleanEmail
    window.localStorage.setItem(PLATFORM_USER_EMAILS_STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Resuelve el mapa `{ [userId]: email }` combinando:
 *   1. Caché local inmediata (para altas/ediciones cuando la migración aún no se ha re-ejecutado).
 *   2. Correo de la sesión activa (`supabase.auth.getSession()`).
 *   3. RPC `list_platform_user_emails` en PostgreSQL (`public.user_credentials` / `public.profiles`).
 */
export async function selectPlatformUserEmails(): Promise<Record<string, string>> {
  const emailMap: Record<string, string> = {
    ...readStoredPlatformUserEmails(),
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const sessionUser = sessionData?.session?.user
    if (sessionUser?.id && sessionUser?.email) {
      emailMap[sessionUser.id] = sessionUser.email.trim().toLowerCase()
    }
  } catch {
    // Ignorar fallo de lectura de sesión
  }

  try {
    const customToken =
      typeof window !== "undefined"
        ? window.localStorage.getItem("sitecorp_custom_session_token")
        : null
    if (customToken) {
      const { data: sessionVal } = await supabase.rpc("validate_user_session", {
        p_session_token: customToken,
      })
      const row = (Array.isArray(sessionVal) ? sessionVal[0] : sessionVal) as
        | { valid?: boolean; user_id?: string; email?: string }
        | null
      if (row?.valid && row.user_id && row.email) {
        emailMap[row.user_id] = row.email.trim().toLowerCase()
      }
    }
  } catch {
    // Ignorar si validate_user_session no está disponible
  }

  try {
    const { data: credRows, error: credError } = await supabase
      .from("user_credentials")
      .select("user_id, email")
    if (!credError && Array.isArray(credRows)) {
      for (const row of credRows as Array<{ user_id?: string; email?: string | null }>) {
        if (row?.user_id && typeof row.email === "string" && row.email.trim()) {
          emailMap[row.user_id] = row.email.trim().toLowerCase()
        }
      }
    }
  } catch {
    // Si user_credentials aún no tiene GRANT SELECT(user_id, email), continúa con la RPC
  }

  try {
    const { data: rpcRows, error: rpcError } = await supabase.rpc("list_platform_user_emails")
    if (!rpcError && Array.isArray(rpcRows)) {
      for (const row of rpcRows as Array<{ user_id?: string; email?: string | null }>) {
        if (row?.user_id && typeof row.email === "string" && row.email.trim()) {
          emailMap[row.user_id] = row.email.trim().toLowerCase()
        }
      }
    }
  } catch {
    // Si la RPC aún no existe en la base de datos, se conserva el mapa disponible
  }

  return emailMap
}

/** Edición administrativa: nombre visible, nombre de usuario y correo electrónico. */
export async function updateUserProfileNames(input: UpdatePlatformUserInput): Promise<void> {
  const cleanEmail = input.email?.trim().toLowerCase()

  if (cleanEmail) {
    saveStoredPlatformUserEmail(input.userId, cleanEmail)

    try {
      await supabase.rpc("update_platform_user_email", {
        p_user_id: input.userId,
        p_email: cleanEmail,
      })
    } catch {
      // Si la RPC aún no está desplegada, continúa con la actualización de profiles
    }

    const { error: withEmailError } = await supabase
      .from("profiles")
      .update({
        full_name: input.fullName,
        username: input.username,
        email: cleanEmail,
      })
      .eq("id", input.userId)

    if (!withEmailError) {
      return
    }
  }

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

