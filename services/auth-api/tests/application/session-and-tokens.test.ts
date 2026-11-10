import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthUser,
  AuthSession,
  createUserId,
  createEmail,
  TokenReuseDetectedError,
  SessionInvalidError,
} from "../../src/domain";
import {
  InMemoryUserRepository,
  InMemoryCredentialRepository,
  InMemorySessionRepository,
  InMemorySecurityAuditService,
  FakePasswordHasher,
  FakeTokenService,
} from "../../src/infrastructure";
import {
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
} from "../../src/application";

describe("Application: Sessions, Refresh Tokens & Concurrency (Pruebas 11 - 15)", () => {
  let userRepo: InMemoryUserRepository;
  let credRepo: InMemoryCredentialRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditService: InMemorySecurityAuditService;
  let passwordHasher: FakePasswordHasher;
  let tokenService: FakeTokenService;

  let loginUseCase: LoginUseCase;
  let logoutUseCase: LogoutUseCase;
  let refreshUseCase: RefreshSessionUseCase;

  const validUserId = createUserId("550e8400-e29b-41d4-a716-446655440020");
  const validEmail = createEmail("sesion.test@sitecorp.cu");
  const validPassword = "SiteCorp.2026#SessionPassword";

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
      auditService
    );
    logoutUseCase = new LogoutUseCase(sessionRepo, tokenService, auditService);
    refreshUseCase = new RefreshSessionUseCase(
      userRepo,
      sessionRepo,
      tokenService,
      auditService
    );

    const user = AuthUser.create(validUserId, validEmail);
    await userRepo.save(user);

    const hash = await passwordHasher.hash(validPassword);
    await credRepo.save({
      id: "cred_020",
      userId: validUserId,
      algorithm: "argon2id",
      passwordHash: hash,
      version: 1,
      createdAt: new Date(),
    });
  });

  // PRUEBA 11: Creación y expiración de sesiones
  it("11. Creación y expiración de sesiones: una sesión expirada rechaza operaciones", async () => {
    const login = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });

    expect(login.refreshToken).not.toBeNull();
    const tokenHash = tokenService.hashOpaqueToken(login.refreshToken!);
    const storedToken = await sessionRepo.findRefreshTokenByHash(tokenHash);
    expect(storedToken).not.toBeNull();

    const storedSession = await sessionRepo.findSessionById(storedToken!.sessionId);
    expect(storedSession?.isValid()).toBe(true);

    // Simular sesión expirada modificando expiresAt en el pasado
    const expiredSessionProps = {
      id: storedSession!.id,
      userId: storedSession!.userId,
      ipAddress: storedSession!.ipAddress,
      userAgent: storedSession!.ipAddress,
      isRevoked: false,
      createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
      lastActivityAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
      expiresAt: new Date(Date.now() - 1000), // ya expiró
    };
    await sessionRepo.updateSession(AuthSession.reconstitute(expiredSessionProps));

    // Intentar refrescar con la sesión expirada debe ser rechazado
    await expect(
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! })
    ).rejects.toThrow(SessionInvalidError);
  });

  // PRUEBA 12: Logout y revocación
  it("12. Logout y revocación: invalida la sesión y rechaza nuevos intentos de refresco", async () => {
    const login = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });

    // Logout con el refresh token del cliente
    await logoutUseCase.execute({ rawRefreshToken: login.refreshToken! });

    // El token y la sesión quedan revocados
    await expect(
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! })
    ).rejects.toThrow();

    const allEvents = auditService.getAllEvents();
    expect(allEvents.some((e) => e.eventType === "LOGOUT")).toBe(true);
  });

  // PRUEBA 13: Rotación correcta de refresh tokens
  it("13. Rotación correcta de refresh tokens: emite nuevo token, invalida el anterior y conserva la familia", async () => {
    const login = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });

    const refreshResult1 = await refreshUseCase.execute({
      rawRefreshToken: login.refreshToken!,
    });

    expect(refreshResult1.accessToken).toBeDefined();
    expect(refreshResult1.newRefreshToken).toBeDefined();
    expect(refreshResult1.newRefreshToken).not.toBe(login.refreshToken);

    // El token anterior fue revocado
    const oldHash = tokenService.hashOpaqueToken(login.refreshToken!);
    const oldToken = await sessionRepo.findRefreshTokenByHash(oldHash);
    expect(oldToken?.isRevoked).toBe(true);

    // El nuevo token está activo y puede utilizarse para una siguiente rotación
    const refreshResult2 = await refreshUseCase.execute({
      rawRefreshToken: refreshResult1.newRefreshToken,
    });
    expect(refreshResult2.accessToken).toBeDefined();
    expect(refreshResult2.newRefreshToken).not.toBe(refreshResult1.newRefreshToken);
  });

  // PRUEBA 13B: Usuario con cambio pendiente de contraseña no recibe refresh token ni puede rotar sesiones
  it("13B. Usuario con cambio pendiente de contraseña: no recibe refresh token en login y rechaza rotación si pasa a estado pendiente", async () => {
    // 1. Si inicia sesión ya estando en pending_password_change, no recibe refreshToken
    const user = await userRepo.findById(validUserId);
    await userRepo.update(
      AuthUser.reconstitute({
        id: user!.id,
        email: user!.email,
        status: "pending_password_change",
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: user!.createdAt,
        updatedAt: user!.updatedAt,
        deletedAt: null,
      })
    );

    const pendingLogin = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });
    expect(pendingLogin.mustChangePassword).toBe(true);
    expect(pendingLogin.refreshToken).toBeNull();
    const verified = await tokenService.verifyAccessToken(pendingLogin.accessToken);
    expect(verified.role).toBe("pending_password_change");
    expect(verified.scope).toBe("auth:change_password");

    // 2. Si un usuario activo tenía un refreshToken y posteriormente pasa a mustChangePassword=true, el refresh es denegado
    await userRepo.update(
      AuthUser.reconstitute({
        id: user!.id,
        email: user!.email,
        status: "active",
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: user!.createdAt,
        updatedAt: user!.updatedAt,
        deletedAt: null,
      })
    );
    const activeLogin = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });
    expect(activeLogin.refreshToken).not.toBeNull();

    await userRepo.update(
      AuthUser.reconstitute({
        id: user!.id,
        email: user!.email,
        status: "pending_password_change",
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: user!.createdAt,
        updatedAt: user!.updatedAt,
        deletedAt: null,
      })
    );

    await expect(
      refreshUseCase.execute({ rawRefreshToken: activeLogin.refreshToken! })
    ).rejects.toThrow(SessionInvalidError);
  });

  // PRUEBA 14: Reutilización de tokens revocados
  it("14. Reutilización de tokens revocados: detecta reuso, invalida toda la familia de tokens y la sesión", async () => {
    const login = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });

    // Rotación 1 legítima: emite Token B
    const rotation1 = await refreshUseCase.execute({
      rawRefreshToken: login.refreshToken!,
    });

    // Intento de reuso malicioso: un atacante vuelve a presentar el Token A (login.refreshToken)
    await expect(
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! })
    ).rejects.toThrow(TokenReuseDetectedError);

    // Como consecuencia de la detección de reuso, toda la familia y la sesión quedan revocadas
    // Incluso el cliente legítimo con Token B no podrá continuar refrescando
    await expect(
      refreshUseCase.execute({ rawRefreshToken: rotation1.newRefreshToken })
    ).rejects.toThrow();

    const allEvents = auditService.getAllEvents();
    expect(allEvents.some((e) => e.eventType === "TOKEN_REUSE_DETECTED")).toBe(true);
  });

  // PRUEBA 15: Solicitudes concurrentes de refresh
  it("15. Solicitudes concurrentes de refresh: exactamente una petición triunfa y las concurrentes son rechazadas de forma atómica", async () => {
    const login = await loginUseCase.execute({
      email: "sesion.test@sitecorp.cu",
      password: validPassword,
    });

    // Simular 5 peticiones simultáneas con el mismo token (ej. 5 pestañas abriéndose a la vez)
    const promises = [
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! }),
      refreshUseCase.execute({ rawRefreshToken: login.refreshToken! }),
    ];

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactamente 1 solicitud debe tener éxito
    expect(fulfilled).toHaveLength(1);
    // Las 4 restantes deben fallar (por ya revocado / reuso detectado)
    expect(rejected).toHaveLength(4);
  });
});
