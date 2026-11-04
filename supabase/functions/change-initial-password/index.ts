import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sitecorp-session",
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

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  try {
    // A. Verificar la identidad REAL del llamante mediante sesión nativa de PostgreSQL (`validate_user_session`).
    let userId: string | null = null
    let email: string | null = null
    const customSessionToken =
      req.headers.get("x-sitecorp-session")?.trim() ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ||
      ""

    if (customSessionToken) {
      const { data: sessionValidation } = await adminClient.rpc("validate_user_session", {
        p_session_token: customSessionToken,
      })
      const parsed = (
        Array.isArray(sessionValidation) ? sessionValidation[0] : sessionValidation
      ) as {
        valid?: boolean
        user_id?: string
        email?: string
      } | null
      if (parsed?.valid && parsed.user_id) {
        userId = parsed.user_id
        email = parsed.email ?? null
      }
    }

    if (!userId) {
      return json({ error: "Unauthorized" }, 401)
    }

    // B. Validar cuerpo y fortaleza de la nueva contraseña en servidor.
    const body = (await req.json()) as ChangeInitialPasswordRequest
    const newPassword = body.new_password ?? ""
    const strengthError = passwordStrengthError(newPassword)
    if (strengthError) {
      return json({ error: strengthError }, 400)
    }

    // C. Delegar preferentemente en `complete_initial_password_change` (nativa en PostgreSQL).
    const { data: completeData, error: completeError } = await adminClient.rpc(
      "complete_initial_password_change",
      {
        p_new_password: newPassword,
        p_session_token: customSessionToken,
      }
    )

    if (!completeError && completeData) {
      const parsedResult = (
        Array.isArray(completeData) ? completeData[0] : completeData
      ) as { success?: boolean; error?: string } | null
      if (parsedResult?.success === true) {
        return json({ success: true }, 200)
      }
      if (parsedResult?.error) {
        return json({ error: parsedResult.error }, 400)
      }
    }

    // D. Respaldo directo con `update_user_password_credentials` en `public.user_credentials`.
    const { data: credRow } = await adminClient
      .from("user_credentials")
      .select("email, must_change_password")
      .eq("user_id", userId)
      .maybeSingle()

    if (!email && credRow?.email) {
      email = credRow.email
    }

    const { error: customCredError } = await adminClient.rpc("update_user_password_credentials", {
      p_user_id: userId,
      p_new_password: newPassword,
    })

    if (customCredError) {
      console.error("[change-initial-password] update_user_password_credentials failed", customCredError)
      return json({ error: customCredError.message || "No se pudo actualizar la contraseña." }, 400)
    }

    // E. Verificación en servidor con `authenticate_user_credentials` (`pgcrypto`).
    if (email) {
      const { data: pgVerifyData, error: pgVerifyError } = await adminClient.rpc(
        "authenticate_user_credentials",
        {
          p_identifier: email,
          p_password: newPassword,
          p_user_agent: "change-initial-password-server-check",
          p_ip_address: null,
        }
      )

      if (!pgVerifyError && pgVerifyData) {
        const pgResult = (
          Array.isArray(pgVerifyData) ? pgVerifyData[0] : pgVerifyData
        ) as {
          authenticated?: boolean
          session_token?: string
        }
        if (pgResult?.session_token) {
          await adminClient.rpc("revoke_user_session", {
            p_session_token: pgResult.session_token,
          })
        }
        if (!pgResult?.authenticated) {
          return json(
            {
              error: "No pudimos verificar el cambio de contraseña en la base de datos. Vuelve a intentarlo.",
              needs_retry: true,
            },
            500
          )
        }
      }
    }

    return json({ success: true }, 200)
  } catch (error) {
    console.error("[change-initial-password] unexpected error", error)
    return json({ error: "Error inesperado al cambiar la contraseña." }, 500)
  }
})
