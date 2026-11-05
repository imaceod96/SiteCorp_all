import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ChangeInitialPasswordRequest {
  new_password: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

/** Longitud mínima de la contraseña nueva (misma política que la interfaz). */
const PASSWORD_MIN_LENGTH = 12

/** Validación de fortaleza en SERVIDOR. Devuelve el mensaje o `null`. */
function passwordStrengthError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
  }
  if (!/[a-z]/.test(password)) return "La contraseña debe incluir al menos una minúscula."
  if (!/[A-Z]/.test(password)) return "La contraseña debe incluir al menos una mayúscula."
  if (!/[0-9]/.test(password)) return "La contraseña debe incluir al menos un número."
  if (!/[^A-Za-z0-9]/.test(password)) return "La contraseña debe incluir al menos un símbolo."
  return null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  // A. La sesión se valida con el token del llamante.
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401)
  }
  const token = authHeader.replace("Bearer ", "")

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  // Cliente anónimo EFÍMERO, solo para verificar en servidor que la contraseña
  // nueva realmente quedó aplicada (ver paso E2). No persiste sesión.
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  try {
    // A. Verificar la identidad REAL del llamante (nunca se confía en el cuerpo).
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
    if (callerError || !callerData?.user) {
      console.error("[change-initial-password] invalid caller token", callerError)
      return json({ error: "Unauthorized" }, 401)
    }

    // B. El user_id procede EXCLUSIVAMENTE de la identidad verificada.
    const userId = callerData.user.id

    // C. Debe existir una fila con must_change_password = true (no se cambia «a ciegas»).
    const { data: lifecycle, error: lifecycleError } = await adminClient
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", userId)
      .maybeSingle()

    if (lifecycleError) {
      console.error("[change-initial-password] lifecycle read failed", lifecycleError)
      return json({ error: "No se pudo verificar el estado de la contraseña." }, 500)
    }
    // Reintento tras un cambio YA confirmado: idempotente. No se vuelve a tocar la contraseña
    // (evita repetir el cambio innecesariamente) y se responde éxito.
    if (lifecycle && lifecycle.must_change_password === false) {
      return json({ success: true }, 200)
    }
    // Legacy sin fila: no hay un cambio pendiente por esta vía.
    if (!lifecycle) {
      return json({ error: "No hay un cambio de contraseña pendiente." }, 409)
    }

    // D. Validación de la nueva contraseña en SERVIDOR.
    const body = (await req.json()) as ChangeInitialPasswordRequest
    const newPassword = body.new_password ?? ""
    const strengthError = passwordStrengthError(newPassword)
    if (strengthError) {
      return json({ error: strengthError }, 400)
    }

    // E. Actualizar la contraseña en Supabase Auth (Admin API). Único paso que toca la
    //    credencial. Nunca se registra la contraseña en logs.
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    })
    if (updateError) {
      console.error("[change-initial-password] auth update failed", updateError)
      return json({ error: "No se pudo actualizar la contraseña. Inténtalo de nuevo." }, 400)
    }

    // E2. VERIFICACIÓN EN SERVIDOR de que el cambio se aplicó de verdad: se intenta
    //     iniciar sesión con la NUEVA contraseña usando un cliente anónimo efímero.
    //     Si no inicia sesión, el cambio NO se da por válido y NO se confirma el
    //     ciclo (el requisito permanece true). La prueba de cambio nunca proviene
    //     del navegador ni de una afirmación del cliente.
    const email = callerData.user.email
    if (email) {
      const { data: verifyData, error: verifyError } = await anonClient.auth.signInWithPassword({
        email,
        password: newPassword,
      })
      if (verifyError || !verifyData?.session) {
        console.error("[change-initial-password] server-side verification failed", verifyError)
        return json(
          {
            error: "No pudimos verificar el cambio de contraseña. Vuelve a intentarlo.",
            needs_retry: true,
          },
          500
        )
      }
      // Cerrar la sesión efímera de verificación: no se deja ninguna sesión abierta.
      try {
        await anonClient.auth.signOut({ scope: "local" })
      } catch (signOutError) {
        console.warn("[change-initial-password] ephemeral sign-out failed", signOutError)
      }
    } else {
      console.warn("[change-initial-password] user has no email; skipping sign-in verification")
    }

    // F. Confirmar que Auth terminó sin error (aquí ya lo sabemos) y G. confirmar el ciclo de
    //    vida con la RPC restringida a service_role vía PostgREST.
    const { error: confirmError } = await adminClient.rpc("mark_password_changed", {
      p_user_id: userId,
    })
    if (confirmError) {
      // La contraseña YA cambió en Auth, pero el ciclo de vida no se pudo confirmar: NO se
      // declara éxito. La RPC es idempotente y se puede reintentar; el requisito sigue activo.
      console.error("[change-initial-password] lifecycle confirmation failed", confirmError)
      return json(
        {
          error:
            "Tu contraseña se actualizó, pero no pudimos confirmar el cambio. Vuelve a intentarlo para completarlo.",
          needs_retry: true,
        },
        500
      )
    }

    // H. Éxito SOLO tras Auth y RPC correctos. No se devuelve ningún secreto.
    console.log("[change-initial-password] password changed and lifecycle confirmed", { userId })
    return json({ success: true }, 200)
  } catch (error) {
    console.error("[change-initial-password] unexpected error", error)
    return json({ error: "Error inesperado al cambiar la contraseña." }, 500)
  }
})
