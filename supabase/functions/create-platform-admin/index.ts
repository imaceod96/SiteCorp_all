import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface CreatePlatformAdminRequest {
  full_name?: string
  username?: string
  email?: string
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
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401)
  }

  const token = authHeader.replace("Bearer ", "")

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  try {
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
    if (callerError || !callerData.user) {
      console.error("[create-platform-admin] invalid caller token", callerError)
      return json({ error: "Unauthorized" }, 401)
    }

    const callerId = callerData.user.id

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
      // Sólo se evalúa cuando la relación llega como objeto (no como arreglo ni null).
      // Si llega como arreglo se conserva el resultado previo (false).
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

    const { data: existingUsername, error: usernameError } = await adminClient
      .from("profiles")
      .select("id,username")
      .eq("username", username)
      .maybeSingle()

    if (usernameError) {
      console.error("[create-platform-admin] username validation failed", usernameError)
      return json({ error: "No se pudo validar el usuario." }, 500)
    }
    if (existingUsername) {
      return json({ error: "Ya existe un usuario con ese nombre." }, 409)
    }

    const { data: invitedUser, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
          username,
        },
      }
    )

    if (inviteError || !invitedUser?.user) {
      console.error("[create-platform-admin] invitation failed", inviteError)
      const message = inviteError?.message ?? "No se pudo crear la cuenta."
      const normalized = message.toLowerCase()
      if (normalized.includes("already") || normalized.includes("registered")) {
        return json({ error: "Ya existe una cuenta con ese email." }, 409)
      }
      return json({ error: message }, 500)
    }

    const userId = invitedUser.user.id

    try {
      const { error: profileError } = await adminClient.from("profiles").upsert(
        {
          id: userId,
          full_name: fullName,
          username,
          is_active: true,
        },
        { onConflict: "id" }
      )

      if (profileError) {
        throw profileError
      }

      const { error: assignmentError } = await adminClient.from("platform_user_roles").insert({
        user_id: userId,
        platform_role_id: role.id,
        assigned_by: callerId,
      })

      if (assignmentError) {
        throw assignmentError
      }

      console.log("[create-platform-admin] administrator created", {
        userId,
        roleId: role.id,
        username,
      })

      return json(
        {
          user_id: userId,
          email,
          username,
          role: role.name,
          invitation_sent: true,
        },
        201
      )
    } catch (assignmentPipelineError) {
      console.error(
        "[create-platform-admin] rolling back created auth user",
        assignmentPipelineError
      )

      await adminClient.auth.admin.deleteUser(userId)

      return json({ error: "No se pudo completar la asignación del rol." }, 500)
    }
  } catch (error) {
    console.error("[create-platform-admin] unexpected error", error)
    return json({ error: "Error inesperado al crear el administrador." }, 500)
  }
})
