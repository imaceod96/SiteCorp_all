import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || "";
const project = process.env.SUPABASE_PROJECT_REF || "xvswjkpoeccgpiewptur";

function runQuery<T = any>(sql: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: "api.supabase.com",
      path: `/v1/projects/${project}/database/query`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body as any);
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function audit() {
  console.log("=== INICIANDO AUDITORÍA REAL DE SUPABASE CLOUD ===");

  // 1. Storage Buckets
  console.log("-> 1. Consultando storage.buckets...");
  const buckets = await runQuery(`
    SELECT id, name, public, avif_autodetection, file_size_limit, allowed_mime_types, created_at
    FROM storage.buckets
    ORDER BY name;
  `);

  // 2. Storage Objects count by bucket
  console.log("-> 2. Consultando conteo de objetos por bucket...");
  const storageObjectsCount = await runQuery(`
    SELECT bucket_id, count(*) as total_objects
    FROM storage.objects
    GROUP BY bucket_id
    ORDER BY bucket_id;
  `);

  // 3. RPC Functions in public schema
  console.log("-> 3. Consultando funciones RPC en schema public...");
  const functions = await runQuery(`
    SELECT 
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as result_type,
      p.prosecdef as is_security_definer,
      l.lanname as language
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);

  // 4. Triggers in public schema
  console.log("-> 4. Consultando triggers en schema public...");
  const triggers = await runQuery(`
    SELECT 
      c.relname as table_name,
      t.tgname as trigger_name,
      p.proname as function_called,
      pg_get_triggerdef(t.oid) as trigger_def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname;
  `);

  // 5. RLS Status and Policies in public schema
  console.log("-> 5. Consultando políticas RLS en schema public...");
  const rlsStatus = await runQuery(`
    SELECT 
      c.relname as table_name,
      c.rowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname;
  `);

  const rlsPolicies = await runQuery(`
    SELECT 
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);

  // 6. Schema Migrations history in Supabase
  console.log("-> 6. Consultando historial de migraciones...");
  const migrations = await runQuery(`
    SELECT version, statements, inserted_at
    FROM supabase_migrations.schema_migrations
    ORDER BY version;
  `).catch(() => []);

  // 7. Table record counts
  console.log("-> 7. Consultando conteos de registros en tablas public...");
  const tablesList: Array<{ table_name: string }> = await runQuery(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const counts: Record<string, number> = {};
  for (const t of tablesList) {
    try {
      const res = await runQuery(`SELECT count(*) as count FROM public."${t.table_name}";`);
      counts[t.table_name] = parseInt(res[0]?.count || "0", 10);
    } catch (e: any) {
      counts[t.table_name] = -1;
    }
  }

  // 8. Auth Users overview (agregado, sin datos personales)
  console.log("-> 8. Consultando métricas agregadas de auth.users...");
  const authMetrics = await runQuery(`
    SELECT 
      count(*) as total_users,
      count(*) FILTER (WHERE confirmed_at IS NOT NULL) as confirmed_users,
      count(*) FILTER (WHERE banned_until IS NOT NULL) as banned_users,
      count(*) FILTER (WHERE email_confirmed_at IS NOT NULL) as email_confirmed_users
    FROM auth.users;
  `);

  const auditReport = {
    timestamp: new Date().toISOString(),
    projectRef: project,
    postgresVersion: "17.6",
    buckets,
    storageObjectsCount,
    functions,
    triggers,
    rlsStatus,
    rlsPolicies,
    migrations,
    counts,
    authMetrics: authMetrics[0] || null,
  };

  const outputPath = path.resolve("/app/applet/services/auth-api/docs/supabase-live-audit-dump.json");
  fs.writeFileSync(outputPath, JSON.stringify(auditReport, null, 2), "utf8");
  console.log("Audit complete! Saved to:", outputPath);
}

audit().catch(console.error);
