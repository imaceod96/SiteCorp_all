import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

/**
 * Eliminación DEFINITIVA de un usuario de plataforma.
 *
 * Esta función es la ÚNICA vía de borrado: el cliente nunca recibe la service role key ni
 * puede llamar a `auth.admin.deleteUser`. La operación es administrativa y destructiva, así
 * que el servidor revalida todo por su cuenta (no confía en nada de la interfaz).
 *
 * Garantías:
 *   · el llamante debe ser SuperAdmin ACTIVO, sin cambio de contraseña pendiente;
 *   · no puede eliminar su propia cuenta;
 *   · no puede eliminar la ÚLTIMA cuenta activa de SuperAdmin;
 *   · no puede eliminar la cuenta FUNDADORA (protegida también en la base);
 *   · debe confirmar el `username` exacto del usuario objetivo;
 *   · NO se escribe nada antes del borrado: si el borrado falla, la base queda intacta;
 *   · si el usuario participa en registros históricos (documentos que creó, asignaciones de
 *     otros usuarios, etc.) el borrado se RECHAZA y se explica: se conserva el historial y se
 *     ofrece la desactivación como alternativa.
 *
 * Las filas de identidad y acceso del propio usuario (`profiles`, `platform_user_roles`,
 * `user_password_lifecycle`, `company_client_memberships` y sus `entity_user_access`) se
 * retiran por las CASCADAS YA DEFINIDAS en la base: no se borra ni se altera ningún registro
 * de negocio (trabajadores, contratos, documentos de empresa, nóminas).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface DeletePlatformUserRequest {
  user_id: string
  confirm_username: string
}

interface PlatformRoleRef {
  name: string
  is_system_role: boolean
  is_active: boolean
}

interface PlatformUserRoleRow {
  user_id: string
  // PostgREST puede devolver la relación embebida como objeto, arreglo o null.
  platform_roles: PlatformRoleRef | PlatformRoleRef[] | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

/** Sólo cuenta como SuperAdmin el rol de sistema ACTIVO llamado `SuperAdmin`. */
function isSuperAdminRole(role: PlatformRoleRef | PlatformRoleRef[] | null): boolean {
  if (role === null || Array.isArray(role)) return false
  return role.name === "SuperAdmin" && role.is_system_role === true && role.is_active === true
}

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
    // 1. Identidad del llamante
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(token)
    if (callerError || !callerData?.user) {
      console.error("[delete-platform-user] invalid caller token", callerError)
      return json({ error: "Unauthorized" }, 401)
    }

    const callerId = callerData.user.id

    // 2. Perfil activo
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from("profiles")
      .select("id, is_active")
      .eq("id", callerId)
      .single()

    if (callerProfileError || !callerProfile || callerProfile.is_active === false) {
      console.error("[delete-platform-user] inactive or missing caller profile", callerProfileError)
      return json({ error: "Forbidden: inactive platform administrator" }, 403)
    }

    // 3. Sin cambio de contraseña pendiente (misma barrera de servidor que el alta)
    const { data: callerLifecycle } = await adminClient
      .from("user_password_lifecycle")
      .select("must_change_password")
      .eq("user_id", callerId)
      .maybeSingle()

    if (callerLifecycle?.must_change_password === true) {
      console.error("[delete-platform-user] caller has a pending password change", { callerId })
      return json({ error: "Forbidden: pending password change" }, 403)
    }

    // 4. Autorización: la eliminación es exclusiva del SuperAdmin (no basta users.manage_all)
    const { data: roleRows, error: rolesError } = await adminClient
      .from("platform_user_roles")
      .select("user_id, platform_roles(name, is_system_role, is_active)")

    if (rolesError) {
      console.error("[delete-platform-user] role lookup failed", rolesError)
      return json({ error: "Forbidden: unable to verify platform role" }, 403)
    }

    const rows = (roleRows ?? []) as PlatformUserRoleRow[]

    const isCallerSuperAdmin = rows.some(
      (row) => row.user_id === callerId && isSuperAdminRole(row.platform_roles)
    )
    if (!isCallerSuperAdmin) {
      console.error("[delete-platform-user] caller is not superadmin", { callerId })
      return json({ error: "Forbidden: superadmin role required" }, 403)
    }

    // 5. Cuerpo de la petición
    const body = (await req.json()) as DeletePlatformUserRequest
    const targetUserId = (body.user_id ?? "").trim()
    const confirmUsername = (body.confirm_username ?? "").trim()

    if (!targetUserId) {
      return json({ error: "El usuario a eliminar es obligatorio." }, 400)
    }
    if (!confirmUsername) {
      return json({ error: "Debes confirmar el nombre de usuario para eliminar la cuenta." }, 400)
    }

    // 6. La cuenta propia nunca se elimina desde aquí
    if (targetUserId === callerId) {
      console.error("[delete-platform-user] attempted self deletion", { callerId })
      return json({ error: "No puedes eliminar tu propia cuenta." }, 403)
    }

    // 7. El objetivo debe existir y confirmarse por su nombre de usuario
    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, username, full_name, is_active")
      .eq("id", targetUserId)
      .maybeSingle()

    if (targetError) {
      console.error("[delete-platform-user] target lookup failed", targetError)
      return json({ error: "No se pudo verificar el usuario a eliminar." }, 500)
    }
    if (!targetProfile) {
      return json({ error: "El usuario no existe o ya fue eliminado." }, 404)
    }
    if ((targetProfile.username ?? "").toLowerCase() !== confirmUsername.toLowerCase()) {
      return json({ error: "La confirmación no coincide con el nombre de usuario." }, 400)
    }

    // 7.b La cuenta FUNDADORA está protegida: no se elimina por procedimientos
    //     administrativos. Se comprueba ANTES del borrado para no devolver el mensaje
    //     genérico de «registros históricos» que produciría la restricción de la base.
    const { data: founderRow, error: founderError } = await adminClient
      .from("platform_founder")
      .select("user_id")
      .eq("user_id", targetUserId)
      .maybeSingle()

    if (founderError) {
      console.error("[delete-platform-user] founder lookup failed", founderError)
      return json({ error: "No se pudo verificar la protección de la cuenta fundadora." }, 500)
    }

    if (founderRow) {
      console.error("[delete-platform-user] refused to delete the founder", { targetUserId })
      return json(
        {
          error:
            "La cuenta fundadora de SiteCorp no se puede eliminar ni desactivar: es la única autorizada para administrar el rol SuperAdmin.",
          reason: "founder_protected",
        },
        409
      )
    }

    // 8. Nunca la última cuenta activa de SuperAdmin
    const targetIsSuperAdmin = rows.some(
      (row) => row.user_id === targetUserId && isSuperAdminRole(row.platform_roles)
    )

    if (targetIsSuperAdmin) {
      const superAdminIds = Array.from(
        new Set(rows.filter((row) => isSuperAdminRole(row.platform_roles)).map((row) => row.user_id))
      )

      const { data: superAdminProfiles, error: superAdminError } = await adminClient
        .from("profiles")
        .select("id, is_active")
        .in("id", superAdminIds)

      if (superAdminError) {
        console.error("[delete-platform-user] superadmin count failed", superAdminError)
        return json({ error: "No se pudo verificar el número de SuperAdmins." }, 500)
      }

      const activeSuperAdmins = (superAdminProfiles ?? []).filter(
        (profile: { is_active: boolean | null }) => profile.is_active !== false
      ).length

      if (activeSuperAdmins <= 1) {
        console.error("[delete-platform-user] refused to delete the last superadmin", {
          targetUserId,
        })
        return json(
          {
            error:
              "No se puede eliminar la última cuenta de SuperAdmin activa: SiteCorp quedaría sin administración global.",
          },
          409
        )
      }
    }

    // 9. Borrado definitivo. NO se escribe nada antes: si falla, la base queda intacta.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId)

    if (deleteError) {
      const message = deleteError.message ?? ""
      console.error("[delete-platform-user] auth delete failed", { targetUserId, message })

      // Registros históricos que referencian al usuario: se conserva el historial.
      if (/foreign key|violates foreign key constraint|23503/i.test(message)) {
        return json(
          {
            error:
              "No se puede eliminar el usuario porque participa en registros históricos (documentos, asignaciones o creaciones de otros usuarios). Se conserva el historial: desactiva la cuenta en su lugar.",
            reason: "has_history",
          },
          409
        )
      }

      return json({ error: "No se pudo eliminar el usuario: " + message }, 500)
    }

    console.log("[delete-platform-user] user deleted", {
      targetUserId,
      targetUsername: targetProfile.username,
      deletedBy: callerId,
      wasSuperAdmin: targetIsSuperAdmin,
    })

    return json({ deleted: true, user_id: targetUserId }, 200)
  } catch (error) {
    console.error("[delete-platform-user] unexpected error", error)
    return json({ error: "Error inesperado al eliminar el usuario." }, 500)
  }
})
