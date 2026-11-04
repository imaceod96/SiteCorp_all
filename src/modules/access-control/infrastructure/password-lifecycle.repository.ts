import { supabase } from "@/lib/supabase"
import { getStoredSessionUserMetadata } from "./authentication.repository"
import type { PasswordLifecycleRead } from "../domain/password.rules"

/**
 * Control de acceso — Repositorio del CICLO DE VIDA DE CONTRASEÑA (infraestructura).
 *
 * Lee el estado de cambio obligatorio de contraseña desde `public.user_password_lifecycle`
 * y/o desde los metadatos verificados por PostgreSQL (`validate_user_session` /
 * `authenticate_user_credentials`, que consultan `public.user_credentials.must_change_password`
 * y `public.user_password_lifecycle.must_change_password`).
 */
export async function selectOwnPasswordLifecycle(userId: string): Promise<PasswordLifecycleRead> {
  const sessionMeta = getStoredSessionUserMetadata()

  try {
    const { data, error } = await supabase
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", userId)
      .maybeSingle()

    if (!error && data) {
      return { status: "record", mustChange: Boolean(data.must_change_password) }
    }

    if (sessionMeta && sessionMeta.userId === userId) {
      return { status: "record", mustChange: Boolean(sessionMeta.mustChangePassword) }
    }

    if (error) return { status: "error" }
    return { status: "none" }
  } catch {
    if (sessionMeta && sessionMeta.userId === userId) {
      return { status: "record", mustChange: Boolean(sessionMeta.mustChangePassword) }
    }
    return { status: "error" }
  }
}
