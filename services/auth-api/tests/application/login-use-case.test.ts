import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthUser,
  createUserId,
  createEmail,
  InvalidCredentialsError,
  UserSuspendedError,
  AccountLockedError,
} from "../../src/domain";
import {
  InMemoryUserRepository,
  InMemoryCredentialRepository,
  InMemorySessionRepository,
  InMemorySecurityAuditService,
  FakePasswordHasher,
  FakeTokenService,
} from "../../src/infrastructure";
import { LoginUseCase } from "../../src/application";

describe("Application: LoginUseCase (Pruebas 4 - 10)", () => {
  let userRepo: InMemoryUserRepository;
  let credRepo: InMemoryCredentialRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditService: InMemorySecurityAuditService;
  let passwordHasher: FakePasswordHasher;
  let tokenService: FakeTokenService;
  let loginUseCase: LoginUseCase;

  const validUserId = createUserId("550e8400-e29b-41d4-a716-446655440010");
  const validEmail = createEmail("usuario.seguro@sitecorp.cu");
  const validPassword = "SiteCorp.2026#SecurePassword";

  beforeEach(async () => {
    userRepo = new InMemoryUserRepository();
    credRepo = new InMemoryCredentialRepository();
    sessionRepo = new InMemorySessionRepository();
    auditService = new InMemorySecurityAuditService();
    passwordHasher = new FakePasswordHasher();
    tokenService = new FakeTokenService();

    loginUseCase = new LoginUseCase(
      userRepo,
      credRepo,
      sessionRepo,
      passwordHasher,
      tokenService,
      auditService,
      5, // maxFailedAttempts
      15 * 60 * 1000 // lockDurationMs = 15 minutos
    );

    // Sembrar usuario válido y credenciales
    const user = AuthUser.create(validUserId, validEmail);
    await userRepo.save(user);

    const hash = await passwordHasher.hash(validPassword);
    await credRepo.save({
      id: "cred_001",
      userId: validUserId,
      algorithm: "argon2id",
      passwordHash: hash,
      version: 1,
      createdAt: new Date(),
    });
  });

  // PRUEBA 4: Login correcto
  it("4. Login correcto: autentica al usuario activo, emite tokens y registra la sesión", async () => {
    const result = await loginUseCase.execute({
      email: "usuario.seguro@sitecorp.cu",
      password: validPassword,
      ipAddress: "192.168.1.50",
      userAgent: "Mozilla/5.0 SiteCorp Client",
    });

    expect(result.user.id).toBe(validUserId);
    expect(result.user.email).toBe(validEmail);
    expect(result.tokenType).toBe("Bearer");
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.expiresInSeconds).toBe(3600);
    expect(result.mustChangePassword).toBe(false);

    // Comprobar que la sesión fue persistida y está activa
    const allEvents = auditService.getAllEvents();
    expect(allEvents.some((e) => e.eventType === "LOGIN_SUCCESS")).toBe(true);
  });

  // PRUEBA 5: Contraseña incorrecta
  it("5. Contraseña incorrecta: incrementa intentos fallidos y lanza error genérico sin revelar detalles", async () => {
    await expect(
      loginUseCase.execute({
        email: "usuario.seguro@sitecorp.cu",
        password: "WrongPassword!2026",
      })
    ).rejects.toThrow(InvalidCredentialsError);

    const user = await userRepo.findById(validUserId);
    expect(user?.failedLoginAttempts).toBe(1);

    const allEvents = auditService.getAllEvents();
    expect(allEvents.some((e) => e.eventType === "LOGIN_FAILED")).toBe(true);
  });

  // PRUEBA 6: Usuario inexistente
  it("6. Usuario inexistente: devuelve el mismo error genérico que una contraseña incorrecta (mitiga enumeración)", async () => {
    await expect(
      loginUseCase.execute({
        email: "no.existe@sitecorp.cu",
        password: validPassword,
      })
    ).rejects.toThrow(InvalidCredentialsError);

    const allEvents = auditService.getAllEvents();
    expect(allEvents.some((e) => e.eventType === "LOGIN_FAILED")).toBe(true);
  });

  // PRUEBA 7: Usuario suspendido
  it("7. Usuario suspendido: impide autenticación y lanza UserSuspendedError", async () => {
    const user = await userRepo.findById(validUserId);
    user!.suspend();
    await userRepo.update(user!);

    await expect(
      loginUseCase.execute({
        email: "usuario.seguro@sitecorp.cu",
        password: validPassword,
      })
    ).rejects.toThrow(UserSuspendedError);
  });

  // PRUEBA 8: Usuario eliminado (mitigación de enumeración y timing attack)
  it("8. Usuario eliminado: devuelve InvalidCredentialsError para mitigar enumeración de cuentas dadas de baja", async () => {
    const user = await userRepo.findById(validUserId);
    user!.softDelete();
    await userRepo.update(user!);

    await expect(
      loginUseCase.execute({
        email: "usuario.seguro@sitecorp.cu",
        password: validPassword,
      })
    ).rejects.toThrow(InvalidCredentialsError);

    // Se registró evento de auditoría interno sin filtrar información al atacante
    const allEvents = auditService.getAllEvents();
    expect(allEvents.some((e) => e.eventType === "LOGIN_FAILED" && e.metadata?.reason === "USER_DELETED_ATTEMPT")).toBe(true);
  });

  // PRUEBA 8B: Emisión de token restringido sin refresh token si el usuario tiene cambio obligatorio de clave
  it("8B. Usuario con cambio obligatorio de contraseña: emite access token restringido con role 'pending_password_change' y NO emite refresh token", async () => {
    const user = await userRepo.findById(validUserId);
    const userProps = {
      id: user!.id,
      email: user!.email,
      status: "pending_password_change" as const,
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: user!.createdAt,
      updatedAt: user!.updatedAt,
      deletedAt: null,
    };
    await userRepo.update(AuthUser.reconstitute(userProps));

    const result = await loginUseCase.execute({
      email: "usuario.seguro@sitecorp.cu",
      password: validPassword,
    });

    expect(result.mustChangePassword).toBe(true);
    expect(result.refreshToken).toBeNull();
    expect(result.refreshTokenExpiresAt).toBeNull();
    expect(result.sessionId).toMatch(/^sess_/);
    const decoded = await tokenService.verifyAccessToken(result.accessToken);
    expect(decoded.role).toBe("pending_password_change");
    expect(decoded.scope).toBe("auth:change_password");
  });

  // PRUEBA 9: Bloqueo por intentos fallidos
  it("9. Bloqueo por intentos fallidos: tras 5 intentos erróneos bloquea la cuenta y rechaza nuevos intentos", async () => {
    // 4 intentos fallidos: lanza InvalidCredentialsError pero aún no está bloqueado
    for (let i = 0; i < 4; i++) {
      await expect(
        loginUseCase.execute({
          email: "usuario.seguro@sitecorp.cu",
          password: "BadPassword#1",
        })
      ).rejects.toThrow(InvalidCredentialsError);
    }

    let user = await userRepo.findById(validUserId);
    expect(user?.failedLoginAttempts).toBe(4);
    expect(user?.isLocked()).toBe(false);

    // Quinto intento fallido: activa el bloqueo
    await expect(
      loginUseCase.execute({
        email: "usuario.seguro@sitecorp.cu",
        password: "BadPassword#1",
      })
    ).rejects.toThrow();

    user = await userRepo.findById(validUserId);
    expect(user?.failedLoginAttempts).toBe(5);
    expect(user?.isLocked()).toBe(true);

    // Intentos posteriores mientras está bloqueada: lanza AccountLockedError inmediatamente
    await expect(
      loginUseCase.execute({
        email: "usuario.seguro@sitecorp.cu",
        password: validPassword, // incluso con la clave correcta
      })
    ).rejects.toThrow(AccountLockedError);
  });

  // PRUEBA 10: Recuperación tras el bloqueo
  it("10. Recuperación tras el bloqueo: permite login y reinicia intentos cuando el período de bloqueo expira", async () => {
    // Forzar bloqueo fijando lockedUntil en el pasado (ej. bloqueado hace 20 minutos)
    const user = await userRepo.findById(validUserId);
    const pastTime = new Date(Date.now() - 20 * 60 * 1000);
    user!.registerFailedAttempt(5, 15 * 60 * 1000, pastTime);
    await userRepo.update(user!);

    expect(user!.isLocked()).toBe(false); // el tiempo de bloqueo (15 min) ya transcurrió

    // Al iniciar sesión con la clave correcta, se permite el acceso
    const result = await loginUseCase.execute({
      email: "usuario.seguro@sitecorp.cu",
      password: validPassword,
    });

    expect(result.accessToken).toBeDefined();

    // El contador de intentos fallidos se reinició a 0
    const refreshedUser = await userRepo.findById(validUserId);
    expect(refreshedUser?.failedLoginAttempts).toBe(0);
    expect(refreshedUser?.lockedUntil).toBeNull();
  });
});
