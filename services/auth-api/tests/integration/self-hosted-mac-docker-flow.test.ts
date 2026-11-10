import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  createStandaloneAuthApp,
  PgPoolAdapter,
} from "../../src/presentation/http/entrypoint";
import { runBootstrapAdminCli } from "../../src/cli/bootstrap-admin";
import {
  configureSelfHostedRuntimeBridge,
  supabase,
} from "../../../../src/lib/supabase";
import {
  getSharedSelfHostedAuthAdapter,
  resetSharedSelfHostedAuthAdapter,
  type StorageLike,
} from "../../../../src/modules/access-control/infrastructure/self-hosted-auth.adapter";
import {
  signIn,
  signOut,
} from "../../../../src/modules/access-control/application/authentication.commands";
import {
  loadAuthenticatedIdentity,
  loadSessionUser,
} from "../../../../src/modules/access-control/application/authentication.queries";

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe("Flujo E2E Real de Autenticación y Dominio en Modo self_hosted (PostgreSQL 16 + Fastify)", () => {
  const basePgUrl =
    process.env.SITECORP_PG16_TEST_URL ??
    "postgresql://postgres@127.0.0.1:54332/postgres";
  const testDbName = `sitecorp_mac_flow_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let testDbUrl = "";
  let adminPool: pg.Pool;
  let appPool: PgPoolAdapter;
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;
  const interceptedUrls: string[] = [];
  const cookieJar = new Map<string, string>();

  const adminEmail = "admin.mac.docker@sitecorp.local";
  let generatedAdminPassword = "";

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: basePgUrl });
    await adminPool.query(`CREATE DATABASE "${testDbName}";`);

    const parsedUrl = new URL(basePgUrl);
    parsedUrl.pathname = `/${testDbName}`;
    testDbUrl = parsedUrl.toString();

    const rawPool = new pg.Pool({ connectionString: testDbUrl });
    appPool = new PgPoolAdapter(rawPool);

    const standalone = await createStandaloneAuthApp({
      customPool: appPool,
      env: {
        NODE_ENV: "development",
        SITECORP_AUTH_ENV: "development",
        SITECORP_HTTP_HOST: "127.0.0.1",
        SITECORP_HTTP_PORT: "4010",
        SITECORP_HTTP_ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
        SITECORP_HTTP_COOKIE_SECURE: "false",
        SITECORP_HTTP_COOKIE_SAMESITE: "Lax",
        SITECORP_AUTO_MIGRATE: "true",
        SITECORP_AUTO_GENERATE_DEV_KEYS: "true",
        STORAGE_LOCAL_ROOT_DIR: `/tmp/sitecorp-test-storage-${testDbName}`,
      },
    });

    const address = await standalone.server.app.listen({
      host: "127.0.0.1",
      port: 0,
    });
    serverUrl = address;
    closeServer = async () => {
      await standalone.server.app.close();
      await appPool.end();
    };

    // Bootstrap del administrador local sin credenciales predeterminadas inseguras
    const bootstrapRes = await runBootstrapAdminCli({
      customPool: appPool,
      allowBootstrapEnv: "true",
      confirm: true,
      email: adminEmail,
      generatePassword: true,
      fullName: "Admin Mac Docker",
    });

    expect(bootstrapRes.success).toBe(true);
    expect(bootstrapRes.generatedPassword).toBeDefined();
    generatedAdminPassword = bootstrapRes.generatedPassword!;
  });

  afterAll(async () => {
    configureSelfHostedRuntimeBridge({ provider: "supabase" });
    resetSharedSelfHostedAuthAdapter();
    if (closeServer) {
      await closeServer();
    }
    if (adminPool) {
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
        [testDbName]
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}";`);
      await adminPool.end();
    }
  });

  it("ejecuta signIn -> loadAuthenticatedIdentity -> creación de empresa/entidad -> refreshToken -> changePassword -> signOut con 0 llamadas a Supabase Cloud", async () => {
    const originalFetch = globalThis.fetch;
    const customFetch: typeof fetch = async (input, init) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      interceptedUrls.push(rawUrl);

      // Simular el proxy same-origin de Vite (http://localhost:3000/api -> serverUrl/api)
      const rewrittenUrl = rawUrl.replace(/^http:\/\/localhost:3000/, serverUrl);
      const parsedPath = new URL(rewrittenUrl).pathname;
      const headers = new Headers(init?.headers);
      if (!headers.has("origin")) {
        headers.set("origin", "http://localhost:3000");
      }
      if (cookieJar.size > 0) {
        const cookieHeader = Array.from(cookieJar.entries())
          .filter(([k]) => k !== "sitecorp_rt" || parsedPath.startsWith("/api/v1/auth"))
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
        if (cookieHeader) {
          headers.set("cookie", cookieHeader);
        }
      }

      const res = await originalFetch(rewrittenUrl, {
        ...init,
        headers,
      });

      const setCookies =
        typeof (res.headers as any).getSetCookie === "function"
          ? ((res.headers as any).getSetCookie() as string[])
          : res.headers.get("set-cookie")
            ? [res.headers.get("set-cookie")!]
            : [];

      for (const sc of setCookies) {
        const firstPart = sc.split(";")[0];
        if (!firstPart) continue;
        const eqIdx = firstPart.indexOf("=");
        if (eqIdx > 0) {
          const name = firstPart.slice(0, eqIdx).trim();
          const val = firstPart.slice(eqIdx + 1).trim();
          if (val === "") {
            cookieJar.delete(name);
          } else {
            cookieJar.set(name, val);
          }
        }
      }

      return res;
    };

    globalThis.fetch = customFetch;

    try {
      const storage = new MemoryStorage();
      configureSelfHostedRuntimeBridge({
        provider: "self_hosted",
        apiBaseUrl: "http://localhost:3000",
        customFetch,
      });

      getSharedSelfHostedAuthAdapter({
        baseUrl: "http://localhost:3000",
        storage,
        fetchImpl: customFetch,
      });

      // 1. Iniciar sesión mediante el comando real que invoca Login.tsx -> AuthProvider.tsx
      const loginError = await signIn(adminEmail, generatedAdminPassword);
      expect(loginError).toBeNull();

      // 2. Obtener usuario de la sesión activa
      const sessionUser = await loadSessionUser();
      expect(sessionUser).not.toBeNull();
      expect(sessionUser?.email).toBe(adminEmail);

      // 3. Cargar la identidad completa (perfil, ciclo de vida de contraseña, superadmin, membresías)
      const identity = await loadAuthenticatedIdentity(sessionUser!.id);
      expect(identity.signedOut).toBe(false);
      expect(identity.isProfileActive).toBe(true);
      expect(identity.passwordChangeRequired).toBe("not_required");
      expect(identity.isPlatformSuperAdmin).toBe(true);
      expect(identity.isPlatformUser).toBe(true);

      // 4. Crear una empresa cliente y una entidad organizativa mediante el puente autónomo
      const { data: createdWorkspace, error: wsErr } = await supabase.rpc(
        "create_workspace",
        {
          p_name: "Empresa Mac Apple Silicon S.A.",
          p_tax_id: "MAC-2026-001",
        }
      );
      expect(wsErr).toBeNull();
      expect(createdWorkspace).toBeDefined();
      const companyId = (createdWorkspace as { id: string }).id;
      expect(companyId).toBeTruthy();

      configureSelfHostedRuntimeBridge({
        provider: "self_hosted",
        apiBaseUrl: "http://localhost:3000",
        activeCompanyId: companyId,
        customFetch,
      });

      const { data: insertedEntity, error: entErr } = await supabase
        .from("organization_entities")
        .insert({
          tenant_id: companyId,
          name: "Dirección General Mac",
          code: "DIR_MAC_01",
          entity_type: "EMPRESA",
          regime_id: "EMPRESARIAL",
          status: "ACTIVE",
        })
        .select("*")
        .single();

      expect(entErr).toBeNull();
      expect(insertedEntity).toBeDefined();
      expect((insertedEntity as any).tenant_id).toBe(companyId);

      // 5. Renovar la sesión (refreshToken con cookie HttpOnly + x-csrf-token)
      const refreshed = await getSharedSelfHostedAuthAdapter().refreshToken();
      expect(refreshed).not.toBeNull();
      expect(refreshed?.accessToken).toBeTruthy();

      // 6. Cambiar contraseña en sesión activa
      const newPassword = "NuevaClaveMac#2026! Segura";
      const pwdUpdate = await getSharedSelfHostedAuthAdapter().updatePassword({
        currentPassword: generatedAdminPassword,
        newPassword,
      });
      expect(pwdUpdate.success).toBe(true);

      // 7. Cerrar sesión
      await signOut();
      const afterLogoutUser = await loadSessionUser();
      expect(afterLogoutUser).toBeNull();

      // 8. Re-iniciar sesión con la nueva contraseña
      const reloginErr = await signIn(adminEmail, newPassword);
      expect(reloginErr).toBeNull();
      await signOut();

      // 9. Verificar que NINGUNA petición fue a *.supabase.co
      const supabaseCalls = interceptedUrls.filter((u) =>
        u.includes("supabase.co")
      );
      expect(supabaseCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
