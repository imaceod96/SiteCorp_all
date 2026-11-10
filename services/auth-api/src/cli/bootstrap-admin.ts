import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AuthUser,
  createEmail,
  createUserId,
  PasswordPolicy,
} from "../domain";
import {
  Argon2idPasswordHasher,
  DEFAULT_ARGON2ID_CONFIG,
  PgPoolLike,
  PostgresCredentialRepository,
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
  readonly password?: string;
  readonly generatePassword?: boolean;
  readonly fullName?: string;
  readonly confirm?: boolean;
  readonly allowBootstrapEnv?: string;
}

function generateStrongAdminPassword(): string {
  const randomPart = randomBytes(12).toString("base64url");
  return `Sc#${randomPart}9!A`;
}

export async function runBootstrapAdminCli(
  options: BootstrapAdminCliOptions = {}
): Promise<{
  success: boolean;
  userId?: string;
  generatedPassword?: string;
  grantedRecords: readonly OperatorPermissionRecord[];
}> {
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

  const passwordFromArg = (() => {
    if (options.password !== undefined) return options.password;
    const idx = process.argv.indexOf("--password");
    if (idx !== -1 && process.argv[idx + 1]) {
      return process.argv[idx + 1];
    }
    return process.env.SITECORP_BOOTSTRAP_ADMIN_PASSWORD;
  })();

  const shouldGeneratePassword =
    options.generatePassword ??
    (process.argv.includes("--generate-password") ||
      process.argv.includes("--create-user") ||
      process.env.SITECORP_BOOTSTRAP_GENERATE_PASSWORD === "true");

  const fullNameRaw =
    options.fullName ??
    (() => {
      const idx = process.argv.indexOf("--name");
      if (idx !== -1 && process.argv[idx + 1]) {
        return process.argv[idx + 1];
      }
      return process.env.SITECORP_BOOTSTRAP_ADMIN_NAME || "Administrador SiteCorp";
    })();

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
  const credentialRepo = new PostgresCredentialRepository(txManager);
  const permissionRepo = new PostgresOperatorPermissionRepository(txManager);
  const auditService = new PostgresSecurityAuditService(txManager);

  const bootstrapService = new InitialAdminBootstrapService(
    userRepo,
    permissionRepo,
    auditService,
    { enabled: true, txManager }
  );

  try {
    let user = await userRepo.findByEmail(targetEmail);
    let generatedPassword: string | undefined;

    if (!user && (passwordFromArg || shouldGeneratePassword)) {
      const rawPassword = passwordFromArg?.trim() || generateStrongAdminPassword();
      if (!passwordFromArg?.trim()) {
        generatedPassword = rawPassword;
      }

      PasswordPolicy.assertValid(rawPassword);

      const hasher = new Argon2idPasswordHasher(DEFAULT_ARGON2ID_CONFIG);
      const passwordHash = await hasher.hash(rawPassword);
      const now = new Date();
      const newUserId = createUserId(randomUUID());

      user = AuthUser.create(newUserId, targetEmail, {
        status: "active",
        mustChangePassword: false,
        now,
      });

      await userRepo.save(user);
      await credentialRepo.save({
        id: randomUUID(),
        userId: user.id,
        algorithm: hasher.algorithm,
        passwordHash,
        version: 1,
        createdAt: now,
      });
    }

    if (!user) {
      throw new Error(
        `El usuario con correo '${targetEmail}' no existe en sitecorp_auth.users. Debe crearlo previamente (o pasar '--generate-password' / '--password <clave>').`
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

    // Sincronizar fila en public.profiles y public.user_password_lifecycle si existen las tablas
    try {
      const username = targetEmail.split("@")[0] || "admin";
      await pool.query(
        `INSERT INTO public.profiles (id, username, full_name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP;`,
        [user.id, username, fullNameRaw]
      );
      await pool.query(
        `INSERT INTO public.user_password_lifecycle (user_id, must_change_password, updated_at)
         VALUES ($1, FALSE, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP;`,
        [user.id]
      );
    } catch {
      // Ignorar si las tablas de dominio public.profiles aún no existen en un test aislado de solo auth
    }

    console.log(`\n[SITECORP AUTH BOOTSTRAP] Permisos administrativos otorgados exitosamente:`);
    console.log(` - Usuario ID: ${user.id}`);
    console.log(` - Correo: ${user.email}`);
    console.log(` - Permisos asignados: ${granted.map((g) => g.permission).join(", ")}`);
    if (generatedPassword) {
      console.log(` - Contraseña generada (mostrar UNA sola vez): ${generatedPassword}`);
    }

    return {
      success: true,
      userId: user.id,
      generatedPassword,
      grantedRecords: granted,
    };
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

