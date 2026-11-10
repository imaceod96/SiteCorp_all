import { isSelfHostedModeActive, supabase } from "../../../lib/supabase"
import type { PasswordLifecycleRead } from "../domain/password.rules"
import { getSharedSelfHostedAuthAdapter } from "./self-hosted-auth.adapter"

/**
 * Control de acceso — Repositorio del CICLO DE VIDA DE CONTRASEÑA (infraestructura).
 *
 * Único punto que LEE `public.user_password_lifecycle` desde el cliente. La ESCRITURA de ese
 * estado NUNCA ocurre aquí: la realizan exclusivamente las RPC restringidas a `service_role`
 * (`initialize_password_lifecycle` / `mark_password_changed`) desde el servidor.
 *
 * RLS permite al titular leer su propia fila; la ausencia de fila es un usuario legacy.
 * Un error de lectura se PROPAGA como `status: "error"` (NUNCA como «sin cambio»).
 */
export async function selectOwnPasswordLifecycle(userId: string): Promise<PasswordLifecycleRead> {
  if (isSelfHostedModeActive()) {
    const adapter = getSharedSelfHostedAuthAdapter()
    if (adapter.isMustChangePasswordRequired()) {
      return { status: "record", mustChange: true }
    }
    try {
      const { data, error } = await supabase
        .from("user_password_lifecycle")
        .select("must_change_password")
        .eq("user_id", userId)
        .maybeSingle()

      if (error || !data) {
        return { status: "record", mustChange: false }
      }
      return { status: "record", mustChange: Boolean(data.must_change_password) }
    } catch {
      return { status: "record", mustChange: false }
    }
  }

  try {
    const { data, error } = await supabase
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", userId)
      .maybeSingle()

    if (error) return { status: "error" }
    if (!data) return { status: "none" }
    return { status: "record", mustChange: Boolean(data.must_change_password) }
  } catch {
    return { status: "error" }
  }
}

