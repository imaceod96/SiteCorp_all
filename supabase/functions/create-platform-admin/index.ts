import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sitecorp-session",
}

interface CreatePlatformAdminRequest {
  full_name?: string
  username?: string
  email?: string
  password?: string
  platform_role_id?: string
}

/** Relación embebida `platform_roles(...)` dentro de `platform_user_roles`. */
interface PlatformRoleRef {
  name: string
  is_system_role: boolean
  is_active: boolean
}

interface CallerPlatformRoleRow {
  // Supabase/PostgREST puede devolver la relación embebida como objeto o arreglo.
  platform_roles: PlatformRoleRef | PlatformRoleRef[] | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  const sessionToken = req.headers.get("x-sitecorp-session")?.trim() ?? ""
  if (!authHeader?.startsWith("Bearer ") && !sessionToken) {
    return json({ error: "Unauthorized" }, 401)
  }

  const token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : ""

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  try {
    let callerId: string | null = null

    if (sessionToken) {
      const { data: sessionData, error: sessionError } = await adminClient.rpc(
        "validate_user_session",
        { p_session_token: sessionToken }
      )
      const row = Array.isArray(sessionData) ? sessionData[0] : sessionData
      if (!sessionError && row?.is_valid && row?.user_id) {
        callerId = String(row.user_id)
      }
    }

    if (!callerId && token) {
      const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
      if (!callerError && callerData?.user?.id) {
        callerId = callerData.user.id
      }
    }

    if (!callerId) {
      console.error("[create-platform-admin] invalid caller session/token")
      return json({ error: "Unauthorized" }, 401)
    }

    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from("profiles")
      .select("id,is_active")
      .eq("id", callerId)
      .single()

    if (callerProfileError || !callerProfile || callerProfile.is_active === false) {
      console.error("[create-platform-admin] inactive or missing caller profile", callerProfileError)
      return json({ error: "Forbidden: inactive platform administrator" }, 403)
    }

    // El llamante NO puede tener un cambio de contraseña pendiente (barrera de servidor).
    const { data: callerLifecycle } = await adminClient
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", callerId)
      .maybeSingle()
    if (callerLifecycle?.must_change_password === true) {
      console.error("[create-platform-admin] caller has a pending password change", { callerId })
      return json({ error: "Forbidden: pending password change" }, 403)
    }

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("platform_user_roles")
      .select("platform_roles(name,is_system_role,is_active)")
      .eq("user_id", callerId)

    if (callerRolesError) {
      console.error("[create-platform-admin] caller role lookup failed", callerRolesError)
      return json({ error: "Forbidden: unable to verify platform role" }, 403)
    }

    const isSuperAdmin = (callerRoles || []).some((assignment: CallerPlatformRoleRow) => {
      const role = assignment.platform_roles
      if (role === null || Array.isArray(role)) return false
      return (
        role.name === "SuperAdmin" &&
        role.is_system_role === true &&
        role.is_active === true
      )
    })

    if (!isSuperAdmin) {
      console.error("[create-platform-admin] caller is not SuperAdmin", { callerId })
      return json({ error: "Forbidden: only SuperAdmin can create platform administrators" }, 403)
    }

    const body = (await req.json()) as CreatePlatformAdminRequest
    const fullName = (body.full_name ?? "").trim()
    const username = (body.username ?? "").trim()
    const email = (body.email ?? "").trim().toLowerCase()
    const roleId = (body.platform_role_id ?? "").trim()
    const initialPassword = (body.password ?? "").trim() || `SiteCorp#${crypto.randomUUID().slice(0, 8)}`

    if (!fullName) {
      return json({ error: "El nombre completo es obligatorio." }, 400)
    }
    if (!username) {
      return json({ error: "El usuario es obligatorio." }, 400)
    }
    if (!isValidEmail(email)) {
      return json({ error: "Introduce un email válido." }, 400)
    }

    const { data: role, error: roleError } = await adminClient
      .from("platform_roles")
      .select("id,name,is_active,is_system_role")
      .eq("id", roleId)
      .single()

    if (roleError || !role) {
      console.error("[create-platform-admin] role not found", roleError)
      return json({ error: "El rol seleccionado no existe." }, 400)
    }
    if (!role.is_active) {
      return json({ error: "El rol seleccionado está inactivo." }, 400)
    }
    if (role.is_system_role) {
      return json({ error: "No se puede asignar un rol del sistema reservado." }, 400)
    }

    const { data: createdData, error: createError } = await adminClient.rpc(
      "create_platform_user_with_credentials",
      {
        p_full_name: fullName,
        p_username: username,
        p_email: email,
        p_password: initialPassword,
        p_platform_role_id: role.id,
        p_assigned_by: callerId,
      }
    )

    const createdRow = Array.isArray(createdData) ? createdData[0] : createdData
    if (createError || !createdRow?.success) {
      const errMsg = createError?.message ?? createdRow?.error_message ?? "No se pudo crear el administrador."
      const isConflict =
        errMsg.toLowerCase().includes("existe") ||
        errMsg.toLowerCase().includes("already") ||
        createdRow?.error_code === "username_taken" ||
        createdRow?.error_code === "email_taken"
      return json({ error: errMsg }, isConflict ? 409 : 400)
    }

    return json(
      {
        user_id: createdRow.user_id,
        email,
        username,
        role: role.name,
        invitation_sent: false,
      },
      201
    )
  } catch (error) {
    console.error("[create-platform-admin] unexpected error", error)
    return json({ error: "Error inesperado al crear el administrador." }, 500)
  }
})
