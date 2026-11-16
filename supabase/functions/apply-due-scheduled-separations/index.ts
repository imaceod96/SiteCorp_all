/**
 * Edge Function programada (cron diario 00:05 America/Havana = 05:05 UTC):
 * Aplica las bajas programadas cuya fecha efectiva ya llegó (`scheduled_separation_date <= cuba_current_date()`).
 * Respaldo de `pg_cron` (`apply-due-scheduled-separations-daily`).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc("apply_due_scheduled_separations", {
    p_entity_id: null,
    p_worker_id: null,
  })

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }

  return new Response(
    JSON.stringify({ ok: true, applied: Number(data ?? 0) }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
})
