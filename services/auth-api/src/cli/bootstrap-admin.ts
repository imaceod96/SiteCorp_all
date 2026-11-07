import pg from "pg";
import {
  createEmail,
} from "../domain";
import {
  PgPoolLike,
  PostgresOperatorPermissionRepository,
  PostgresSecurityAuditService,
  PostgresTransactionManager,
  PostgresUserRepository,
} from "../infrastructure";
import {
  InitialAdminBootstrapService,
  OperatorPermissionRecord,
} from "../interfaces";
import { PgPoolAdapter } from "../presentation/http/entrypoint";

export interface BootstrapAdminCliOptions {
  readonly databaseUrl?: string;
  readonly customPool?: PgPoolLike;
  readonly email?: string;
  readonly confirm?: boolean;
  readonly allowBootstrapEnv?: string;
}

export async function runBootstrapAdminCli(
  options: BootstrapAdminCliOptions = {}
): Promise<{ success: boolean; grantedRecords: readonly OperatorPermissionRecord[] }> {
  const allowBootstrap =
    (options.allowBootstrapEnv ??
      process.env.SITECORP_ALLOW_INITIAL_ADMIN_BOOTSTRAP)?.trim().toLowerCase() === "true";

  if (!allowBootstrap) {
    throw new Error(
      "El bootstrap inicial de administrador está deshabilitado. Se requiere 'SITECORP_ALLOW_INITIAL_ADMIN_BOOTSTRAP=true'."
    );
  }

  const confirm =
    options.confirm ??
    process.argv.includes("--confirm") ??
    process.env.SITECORP_BOOTSTRAP_CONFIRM === "true";

  if (!confirm) {
    throw new Error(
      "Se requiere confirmación explícita mediante el flag '--confirm' para ejecutar el bootstrap inicial."
    );
  }

  const emailRaw =
    options.email ??
    (() => {
      const idx = process.argv.indexOf("--email");
      if (idx !== -1 && process.argv[idx + 1]) {
        return process.argv[idx + 1];
      }
      return process.env.SITECORP_BOOTSTRAP_ADMIN_EMAIL;
    })();

  if (!emailRaw || emailRaw.trim() === "") {
    throw new Error(
      "Se requiere especificar el correo del usuario administrador objetivo mediante '--email <correo>' o 'SITECORP_BOOTSTRAP_ADMIN_EMAIL'."
    );
  }

  const targetEmail = createEmail(emailRaw.trim());
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim();
  let pool: PgPoolLike;

  if (options.customPool) {
    pool = options.customPool;
  } else {
    if (!databaseUrl) {
      throw new Error(
        "Se requiere la variable de entorno 'DATABASE_URL' para ejecutar el bootstrap inicial."
      );
    }
    const rawPgPool = new pg.Pool({ connectionString: databaseUrl });
    pool = new PgPoolAdapter(rawPgPool);
  }

  const txManager = new PostgresTransactionManager(pool);
  const userRepo = new PostgresUserRepository(txManager);
  const permissionRepo = new PostgresOperatorPermissionRepository(txManager);
  const auditService = new PostgresSecurityAuditService(txManager);

  const bootstrapService = new InitialAdminBootstrapService(
    userRepo,
    permissionRepo,
    auditService,
    { enabled: true, txManager }
  );

  try {
    const user = await userRepo.findByEmail(targetEmail);
    if (!user) {
      throw new Error(
        `El usuario con correo '${targetEmail}' no existe en sitecorp_auth.users. Debe crearlo previamente.`
      );
    }

    if (!user.isActive()) {
      throw new Error(
        `El usuario con correo '${targetEmail}' no está activo (estado: '${user.status}').`
      );
    }

    if (user.mustChangePassword) {
      throw new Error(
        `El usuario con correo '${targetEmail}' tiene un cambio de contraseña pendiente. Debe completar el cambio de clave antes del bootstrap.`
      );
    }

    const granted = await bootstrapService.bootstrapFirstAdmin({
      targetUserId: user.id,
      confirmSingleExecution: true,
      reason: "CLI_INITIAL_ADMIN_BOOTSTRAP",
    });

    console.log(`\n[SITECORP AUTH BOOTSTRAP] Permisos administrativos otorgados exitosamente:`);
    console.log(` - Usuario ID: ${user.id}`);
    console.log(` - Correo: ${user.email}`);
    console.log(` - Permisos asignados: ${granted.map((g) => g.permission).join(", ")}`);

    return { success: true, grantedRecords: granted };
  } finally {
    if (!options.customPool && "end" in pool && typeof pool.end === "function") {
      await pool.end();
    }
  }
}

// Auto-ejecución si se invoca como CLI directo
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("bootstrap-admin.ts") ||
    process.argv[1].endsWith("bootstrap-admin.js"));

if (isDirectExecution) {
  runBootstrapAdminCli()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n[ERROR] Fallo en bootstrap de administrador inicial:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
