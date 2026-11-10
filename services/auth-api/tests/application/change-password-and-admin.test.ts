import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthUser,
  createUserId,
  createEmail,
  ForbiddenError,
  WeakPasswordError,
} from "../../src/domain";
import {
  InMemoryUserRepository,
  InMemoryCredentialRepository,
  InMemorySessionRepository,
  InMemorySecurityAuditService,
  FakePasswordHasher,
  FakeTokenService,
  MockAuthorizationPolicyService,
} from "../../src/infrastructure";
import {
  ChangePasswordUseCase,
  AdminCreateUserUseCase,
  AdminUpdateStatusUseCase,
  LoginUseCase,
} from "../../src/application";
import { AuthenticatedPrincipal } from "../../src/interfaces";

describe("Application: Password Change & Administrative Authorization (Pruebas 16, 17)", () => {
  let userRepo: InMemoryUserRepository;
  let credRepo: InMemoryCredentialRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditService: InMemorySecurityAuditService;
  let passwordHasher: FakePasswordHasher;
  let tokenService: FakeTokenService;
  let authPolicy: MockAuthorizationPolicyService;

  let changePasswordUseCase: ChangePasswordUseCase;
  let adminCreateUserUseCase: AdminCreateUserUseCase;
  let adminUpdateStatusUseCase: AdminUpdateStatusUseCase;
  let loginUseCase: LoginUseCase;

  const validUserId = createUserId("550e8400-e29b-41d4-a716-446655440030");
  const validEmail = createEmail("cambio.clave@sitecorp.cu");
  const initialPassword = "SiteCorp.2026#InitialPassword";

  beforeEach(async () => {
    userRepo = new InMemoryUserRepository();
    credRepo = new InMemoryCredentialRepository();
    sessionRepo = new InMemorySessionRepository();
    auditService = new InMemorySecurityAuditService();
    passwordHasher = new FakePasswordHasher();
    tokenService = new FakeTokenService();
    authPolicy = new MockAuthorizationPolicyService();

    changePasswordUseCase = new ChangePasswordUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      auditService
    );

    adminCreateUserUseCase = new AdminCreateUserUseCase(
      userRepo,
      credRepo,
      passwordHasher,
      auditService,
      authPolicy
    );

    adminUpdateStatusUseCase = new AdminUpdateStatusUseCase(
      userRepo,
      sessionRepo,
      auditService,
      authPolicy
    );

    loginUseCase = new LoginUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      tokenService,
      auditService
    );

    const user = AuthUser.create(validUserId, validEmail, {
      status: "pending_password_change",
      mustChangePassword: true,
    });
    await userRepo.save(user);

    const hash = await passwordHasher.hash(initialPassword);
    await credRepo.save({
      id: "cred_030",
      userId: validUserId,
      algorithm: "argon2id",
      passwordHash: hash,
      version: 1,
      createdAt: new Date(),
    });
  });

  // PRUEBA 16: Cambio de contraseña y revocación de sesiones
  it("16. Cambio de contraseña y revocación de sesiones: actualiza hash, quita restricción y revoca todas las sesiones previas", async () => {
    // 1. Iniciar sesión para generar una sesión temporal activa (sin refresh token por estar pendiente de cambio)
    const login = await loginUseCase.execute({
      email: "cambio.clave@sitecorp.cu",
      password: initialPassword,
    });
    expect(login.mustChangePassword).toBe(true);
    expect(login.refreshToken).toBeNull();

    const sessionBefore = await sessionRepo.findSessionById(login.sessionId);
    expect(sessionBefore?.isRevoked).toBe(false);

    // 2. Intentar cambiar con contraseña débil debe ser rechazado
    await expect(
      changePasswordUseCase.execute({
        userId: validUserId,
        currentPassword: initialPassword,
        newPassword: "short",
      })
    ).rejects.toThrow(WeakPasswordError);

    // 3. Intentar cambiar con la misma contraseña debe ser rechazado
    await expect(
      changePasswordUseCase.execute({
        userId: validUserId,
        currentPassword: initialPassword,
        newPassword: initialPassword,
      })
    ).rejects.toThrow();

    // 4. Cambio de contraseña exitoso con clave robusta
    const newPassword = "SiteCorp.2026#BrandNewPassword!";
    await changePasswordUseCase.execute({
      userId: validUserId,
      currentPassword: initialPassword,
      newPassword,
    });

    // El usuario ya no tiene restricción de cambio
    const user = await userRepo.findById(validUserId);
    expect(user?.mustChangePassword).toBe(false);
    expect(user?.status).toBe("active");

    // Todas las sesiones previas del usuario fueron revocadas
    const sessionAfter = await sessionRepo.findSessionById(login.sessionId);
    expect(sessionAfter?.isRevoked).toBe(true);

    // Puede iniciar sesión con la nueva contraseña y ahora sí recibe refreshToken
    const newLogin = await loginUseCase.execute({
      email: "cambio.clave@sitecorp.cu",
      password: newPassword,
    });
    expect(newLogin.accessToken).toBeDefined();
    expect(newLogin.refreshToken).not.toBeNull();
    expect(newLogin.mustChangePassword).toBe(false);
  });

  // PRUEBA 17: Prohibición de operaciones administrativas sin autorización
  it("17. Prohibición de operaciones administrativas sin autorización: rechaza llamadas de usuarios no autorizados", async () => {
    // Principal no autorizado (usuario estándar sin permisos)
    const unauthorizedOperator: AuthenticatedPrincipal = {
      userId: createUserId("550e8400-e29b-41d4-a716-446655440099"),
      email: createEmail("empleado@sitecorp.cu"),
      permissions: new Set(["workers.view", "vacations.view"]),
      isPlatformAdmin: false,
    };

    // Intento no autorizado de crear usuario -> lanza ForbiddenError
    await expect(
      adminCreateUserUseCase.execute(
        { email: "nuevo@sitecorp.cu" },
        unauthorizedOperator
      )
    ).rejects.toThrow(ForbiddenError);

    // Intento sin proveer operador -> lanza ForbiddenError
    await expect(
      adminCreateUserUseCase.execute({ email: "nuevo@sitecorp.cu" }, undefined)
    ).rejects.toThrow(ForbiddenError);

    // Intento no autorizado de suspender usuario -> lanza ForbiddenError
    await expect(
      adminUpdateStatusUseCase.execute(
        { userId: validUserId, status: "suspended" },
        unauthorizedOperator
      )
    ).rejects.toThrow(ForbiddenError);

    // Operador legítimo con permiso "security.manage" -> Operaciones permitidas
    const authorizedOperator: AuthenticatedPrincipal = {
      userId: createUserId("550e8400-e29b-41d4-a716-446655440088"),
      email: createEmail("admin.seguridad@sitecorp.cu"),
      permissions: new Set(["security.manage"]),
      isPlatformAdmin: false,
    };

    const createdUser = await adminCreateUserUseCase.execute(
      { email: "creado.por.admin@sitecorp.cu" },
      authorizedOperator
    );
    expect(createdUser.id).toBeDefined();
    expect(createdUser.email).toBe("creado.por.admin@sitecorp.cu");

    // Suspender al usuario creado
    const suspendedUser = await adminUpdateStatusUseCase.execute(
      { userId: createdUser.id, status: "suspended" },
      authorizedOperator
    );
    expect(suspendedUser.status).toBe("suspended");

    // Intento de un operador de suspenderse a sí mismo es rechazado por política
    await expect(
      adminUpdateStatusUseCase.execute(
        { userId: authorizedOperator.userId, status: "suspended" },
        authorizedOperator
      )
    ).rejects.toThrow(ForbiddenError);
  });
});
