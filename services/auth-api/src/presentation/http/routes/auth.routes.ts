import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AuthUser,
  ForbiddenError,
  SessionInvalidError,
  TokenExpiredError,
  TokenInvalidError,
  TokenReuseDetectedError,
  UnauthorizedError,
  UserDeletedError,
  UserSuspendedError,
} from "../../../domain";
import {
  IAuthorizationPolicyService,
  IOperatorPrincipalResolver,
  ISessionRepository,
  ITokenService,
  IUserRepository,
} from "../../../interfaces";
import {
  IChangePasswordUseCase,
  ILoginUseCase,
  ILogoutUseCase,
  IRefreshSessionUseCase,
} from "../../../application";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { verifyAccessTokenSessionState } from "../../../infrastructure/crypto/session-state-verifier";
import { AuthCookieService } from "../plugins/cookies.service";
import {
  CsrfTokenService,
  CsrfValidationError,
  verifyRequestOrigin,
} from "../plugins/csrf-token.service";
import { createAuthGuardHook, extractBearerToken } from "../plugins/auth-guard";
import { IRateLimiter } from "../concurrency/rate-limiter";
import {
  ChangePasswordRequestBody,
  changePasswordBodySchema,
  emptyQuerySchema,
  LoginRequestBody,
  loginBodySchema,
  LogoutRequestBody,
  logoutBodySchema,
  RefreshRequestBody,
  refreshBodySchema,
} from "../schemas/auth.schemas";

export interface AuthRoutesDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly cookieService: AuthCookieService;
  readonly csrfTokenService: CsrfTokenService;
  readonly rateLimiter: IRateLimiter;
  readonly loginUseCase?: ILoginUseCase;
  readonly refreshSessionUseCase?: IRefreshSessionUseCase;
  readonly logoutUseCase?: ILogoutUseCase;
  readonly changePasswordUseCase?: IChangePasswordUseCase;
  readonly authPolicy?: IAuthorizationPolicyService;
  readonly operatorPrincipalResolver?: IOperatorPrincipalResolver;
  readonly nowProvider?: () => Date;
}

function sanitizeUserAgent(
  rawHeader: string | string[] | undefined
): string | null {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof value !== "string") {
    return null;
  }
  let cleaned = "";
  for (let i = 0; i < value.length && cleaned.length < 512; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) {
      cleaned += value[i];
    }
  }
  const trimmed = cleaned.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildSuccessEnvelope<T>(
  data: T,
  req: FastifyRequest,
  now: Date
): {
  readonly data: T;
  readonly meta: {
    readonly requestId: string;
    readonly timestamp: string;
  };
} {
  return {
    data,
    meta: {
      requestId: req.id,
      timestamp: now.toISOString(),
    },
  };
}

function serializeLoginUser(user: AuthUser): {
  readonly id: string;
  readonly email: string;
  readonly status: string;
  readonly mustChangePassword: boolean;
} {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
  };
}

function normalizeOptionalJsonBody(
  req: FastifyRequest,
  _reply: FastifyReply,
  done: (err?: Error) => void
): void {
  if (req.body === undefined || req.body === null) {
    req.body = {};
  }
  done();
}

function shouldClearCookiesOnRefreshError(error: unknown): boolean {
  return (
    error instanceof TokenInvalidError ||
    error instanceof TokenExpiredError ||
    error instanceof TokenReuseDetectedError ||
    error instanceof SessionInvalidError ||
    error instanceof UnauthorizedError ||
    error instanceof UserSuspendedError ||
    error instanceof UserDeletedError
  );
}

/**
 * Registra los 5 endpoints reales de autenticación de la Fase 4G.2B.2:
 * - POST /api/v1/auth/login
 * - POST /api/v1/auth/refresh
 * - POST /api/v1/auth/logout
 * - POST /api/v1/auth/change-password
 * - GET  /api/v1/auth/me
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDependencies
): void {
  const {
    httpConfig,
    tokenService,
    userRepo,
    sessionRepo,
    cookieService,
    csrfTokenService,
    rateLimiter,
  } = deps;
  const nowProvider = deps.nowProvider ?? (() => new Date());

  const fullAccessGuard = createAuthGuardHook(
    {
      tokenService,
      userRepo,
      sessionRepo,
      authPolicy: deps.authPolicy,
      operatorPrincipalResolver: deps.operatorPrincipalResolver,
      nowProvider,
    },
    { allowPendingPasswordChange: false }
  );

  const changePasswordGuard = createAuthGuardHook(
    {
      tokenService,
      userRepo,
      sessionRepo,
      authPolicy: deps.authPolicy,
      operatorPrincipalResolver: deps.operatorPrincipalResolver,
      nowProvider,
    },
    { allowPendingPasswordChange: true }
  );

  // =========================================================================
  // 1. POST /api/v1/auth/login
  // =========================================================================
  if (deps.loginUseCase) {
    const loginUseCase = deps.loginUseCase;

    app.post<{ Body: LoginRequestBody }>(
      "/api/v1/auth/login",
      {
        bodyLimit: httpConfig.limits.authBodyLimitBytes,
        schema: {
          body: loginBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();
        const normalizedEmail = req.body.email.trim().toLowerCase();

        // 1. Rate limiting dual (IP + cuenta normalizada) ANTES de Argon2id
        await rateLimiter.consumeOrThrow({
          operation: "login",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.loginByIp,
          now,
        });
        await rateLimiter.consumeOrThrow({
          operation: "login",
          dimension: "account",
          rawIdentifier: normalizedEmail,
          rule: httpConfig.rateLimit.loginByAccount,
          now,
        });

        // 2. Ejecutar LoginUseCase (el hasher ya está envuelto en Argon2ConcurrencyGate)
        const result = await loginUseCase.execute({
          email: req.body.email,
          password: req.body.password,
          ipAddress: req.ip,
          userAgent: sanitizeUserAgent(req.headers["user-agent"]),
        });

        // 3. Si el navegador enviaba una cookie sitecorp_rt previa, revocar de forma
        //    defensiva la sesión anterior para evitar sesiones huérfanas.
        const previousCookieToken = req.cookies[cookieService.refreshCookieName];
        const previousCsrfCookie = req.cookies[cookieService.csrfCookieName];
        if (
          typeof previousCookieToken === "string" &&
          previousCookieToken.trim().length > 0
        ) {
          try {
            const prevHash = tokenService.hashOpaqueToken(
              previousCookieToken.trim()
            );
            const prevToken = await sessionRepo.findRefreshTokenByHash(prevHash);
            if (prevToken && prevToken.sessionId !== result.sessionId) {
              await sessionRepo.revokeSession(prevToken.sessionId);
            }
          } catch {
            // Ignorar errores de limpieza de cookies previas malformadas
          }
        }

        // 4. Caso A: Usuario con cambio obligatorio de contraseña pendiente
        if (result.mustChangePassword || result.refreshToken === null) {
          // No emitir cookie sitecorp_rt; si el navegador traía cookies previas, limpiarlas.
          if (
            previousCookieToken !== undefined ||
            previousCsrfCookie !== undefined
          ) {
            cookieService.clearAuthCookies(reply);
          }

          return reply.code(200).send(
            buildSuccessEnvelope(
              {
                accessToken: result.accessToken,
                tokenType: result.tokenType,
                expiresInSeconds: result.expiresInSeconds,
                mustChangePassword: true,
                csrfToken: null,
                user: serializeLoginUser(result.user),
              },
              req,
              now
            )
          );
        }

        // 5. Caso B: Usuario activo con acceso completo
        const csrfToken = csrfTokenService.generateToken(result.sessionId, now);
        const cookieExpInput = {
          refreshTokenExpiresAt: result.refreshTokenExpiresAt!,
          sessionExpiresAt: result.sessionExpiresAt,
          now,
        };

        cookieService.setRefreshTokenCookie(
          reply,
          result.refreshToken,
          cookieExpInput
        );
        cookieService.setCsrfCookie(reply, csrfToken, cookieExpInput);

        return reply.code(200).send(
          buildSuccessEnvelope(
            {
              accessToken: result.accessToken,
              tokenType: result.tokenType,
              expiresInSeconds: result.expiresInSeconds,
              mustChangePassword: false,
              csrfToken,
              user: serializeLoginUser(result.user),
            },
            req,
            now
          )
        );
      }
    );
  }

  // =========================================================================
  // 2. POST /api/v1/auth/refresh
  // =========================================================================
  if (deps.refreshSessionUseCase) {
    const refreshSessionUseCase = deps.refreshSessionUseCase;

    app.post<{ Body: RefreshRequestBody }>(
      "/api/v1/auth/refresh",
      {
        bodyLimit: 1024,
        preValidation: normalizeOptionalJsonBody,
        schema: {
          body: refreshBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();

        // 1. Validación estricta de Origin / Referer para operaciones basadas en cookie
        verifyRequestOrigin({
          originHeader: req.headers.origin,
          refererHeader: req.headers.referer,
          allowedOrigins: httpConfig.allowedOrigins,
          requireOriginHeader: true,
        });

        // 2. Rate limiting por IP
        await rateLimiter.consumeOrThrow({
          operation: "refresh",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.refreshByIp,
          now,
        });

        // 3. Leer cookie HttpOnly sitecorp_rt
        const rawRefreshToken = req.cookies[cookieService.refreshCookieName];
        if (
          typeof rawRefreshToken !== "string" ||
          rawRefreshToken.trim() === ""
        ) {
          throw new UnauthorizedError(
            "No se encontró la cookie de sesión de refresco."
          );
        }

        // 4. Rate limiting por hash del refresh token presentado
        await rateLimiter.consumeOrThrow({
          operation: "refresh",
          dimension: "token",
          rawIdentifier: rawRefreshToken,
          rule: httpConfig.rateLimit.refreshByToken,
          now,
        });

        // 5. Extraer cabecera X-CSRF-Token y cookie CSRF antes de tocar BD
        const rawHeaderCsrf = req.headers["x-csrf-token"];
        const headerCsrf = Array.isArray(rawHeaderCsrf)
          ? rawHeaderCsrf[0]
          : rawHeaderCsrf;
        const cookieCsrf = req.cookies[cookieService.csrfCookieName];

        if (
          typeof headerCsrf !== "string" ||
          typeof cookieCsrf !== "string" ||
          headerCsrf.length === 0 ||
          cookieCsrf.length === 0
        ) {
          throw new CsrfValidationError(
            "Falta el token CSRF en la cabecera o en la cookie."
          );
        }

        // 6. Consulta de solo lectura por hash para obtener el `sid` de la sesión
        //    ANTES de ejecutar la rotación transaccional (impidiendo que una petición
        //    cross-site sin CSRF válido dispare rotación o detección de reuso).
        const tokenHash = tokenService.hashOpaqueToken(rawRefreshToken);
        const storedToken = await sessionRepo.findRefreshTokenByHash(tokenHash);
        if (!storedToken) {
          cookieService.clearAuthCookies(reply);
          throw new TokenInvalidError(
            "El refresh token proporcionado no es válido."
          );
        }

        // 7. Verificar criptográficamente el token CSRF vinculado a `storedToken.sessionId`
        csrfTokenService.verifyToken({
          headerToken: headerCsrf,
          cookieToken: cookieCsrf,
          expectedSessionId: storedToken.sessionId,
          now,
        });

        // 8. Ejecutar RefreshSessionUseCase con limpieza determinista de cookies ante fallos 401/403
        let rotated;
        try {
          rotated = await refreshSessionUseCase.execute({
            rawRefreshToken,
            ipAddress: req.ip,
            userAgent: sanitizeUserAgent(req.headers["user-agent"]),
          });
        } catch (err) {
          if (shouldClearCookiesOnRefreshError(err)) {
            cookieService.clearAuthCookies(reply);
          }
          throw err;
        }

        // 9. Emitir nueva cookie sitecorp_rt rotada y nuevo token CSRF vinculado a `rotated.sessionId`
        const newCsrfToken = csrfTokenService.generateToken(
          rotated.sessionId,
          now
        );
        const cookieExpInput = {
          refreshTokenExpiresAt: rotated.refreshTokenExpiresAt,
          sessionExpiresAt: rotated.sessionExpiresAt,
          now,
        };

        cookieService.setRefreshTokenCookie(
          reply,
          rotated.newRefreshToken,
          cookieExpInput
        );
        cookieService.setCsrfCookie(reply, newCsrfToken, cookieExpInput);

        return reply.code(200).send(
          buildSuccessEnvelope(
            {
              accessToken: rotated.accessToken,
              tokenType: rotated.tokenType,
              expiresInSeconds: rotated.expiresInSeconds,
              csrfToken: newCsrfToken,
            },
            req,
            now
          )
        );
      }
    );
  }

  // =========================================================================
  // 3. POST /api/v1/auth/logout
  // =========================================================================
  if (deps.logoutUseCase) {
    const logoutUseCase = deps.logoutUseCase;

    app.post<{ Body: LogoutRequestBody }>(
      "/api/v1/auth/logout",
      {
        bodyLimit: 2048,
        preValidation: normalizeOptionalJsonBody,
        schema: {
          body: logoutBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();

        // 1. Rate limiting por IP
        await rateLimiter.consumeOrThrow({
          operation: "logout",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.logoutByIp,
          now,
        });

        const allDevices = req.body?.allDevices === true;
        const rawAuthHeader = req.headers.authorization;
        const hasAuthHeader =
          typeof rawAuthHeader === "string" && rawAuthHeader.trim().length > 0;
        const rawRefreshToken = req.cookies[cookieService.refreshCookieName];
        const hasRefreshCookie =
          typeof rawRefreshToken === "string" &&
          rawRefreshToken.trim().length > 0;

        // 2. Si se envía cabecera Authorization, verificar JWT + estado de sesión
        let verifiedBearer: {
          readonly user: AuthUser;
          readonly sessionId: string;
        } | null = null;

        if (hasAuthHeader) {
          try {
            const rawJwt = extractBearerToken(rawAuthHeader);
            const claims = await tokenService.verifyAccessToken(rawJwt);
            const state = await verifyAccessTokenSessionState(
              claims,
              sessionRepo,
              userRepo,
              now
            );
            verifiedBearer = {
              user: state.user,
              sessionId: state.session.id,
            };
          } catch (err) {
            // Para allDevices: true, un Bearer válido y activo es estrictamente obligatorio.
            if (allDevices) {
              cookieService.clearAuthCookies(reply);
              throw err;
            }
            // Si no es allDevices y tampoco hay cookie, un token malformado/alterado es rechazado;
            // si el token simplemente expiró o su sesión ya estaba revocada, el logout es idempotente.
            if (
              !hasRefreshCookie &&
              !(err instanceof TokenExpiredError) &&
              !(err instanceof SessionInvalidError)
            ) {
              cookieService.clearAuthCookies(reply);
              throw err;
            }
          }
        } else if (allDevices) {
          cookieService.clearAuthCookies(reply);
          throw new UnauthorizedError(
            "Se requiere una cabecera 'Authorization: Bearer <token>' válida para cerrar todas las sesiones."
          );
        }

        if (verifiedBearer) {
          await rateLimiter.consumeOrThrow({
            operation: "logout",
            dimension: "user",
            rawIdentifier: verifiedBearer.user.id,
            rule: httpConfig.rateLimit.logoutByActor,
            now,
          });
        }

        // 3. Si la petición transporta la cookie sitecorp_rt, validar Origin/Referer y CSRF
        let storedTokenSessionId: string | null = null;
        if (hasRefreshCookie) {
          verifyRequestOrigin({
            originHeader: req.headers.origin,
            refererHeader: req.headers.referer,
            allowedOrigins: httpConfig.allowedOrigins,
            requireOriginHeader: true,
          });

          const rawHeaderCsrf = req.headers["x-csrf-token"];
          const headerCsrf = Array.isArray(rawHeaderCsrf)
            ? rawHeaderCsrf[0]
            : rawHeaderCsrf;
          const cookieCsrf = req.cookies[cookieService.csrfCookieName];

          // Validar primero formato criptográfico estricto de 3 segmentos, vigencia temporal
          // e igualdad en tiempo constante entre cabecera y cookie CSRF antes de tocar BD.
          csrfTokenService.verifyTokenFormatAndEquality({
            headerToken: headerCsrf,
            cookieToken: cookieCsrf,
            now,
          });

          let storedToken = null;
          try {
            const tokenHash = tokenService.hashOpaqueToken(rawRefreshToken);
            storedToken = await sessionRepo.findRefreshTokenByHash(tokenHash);
          } catch {
            storedToken = null;
          }

          if (storedToken) {
            storedTokenSessionId = storedToken.sessionId;
            const cookieSession = await sessionRepo.findSessionById(
              storedToken.sessionId
            );

            // Impedir que un usuario autenticado con Bearer revoque la cookie/sesión de otro usuario
            if (
              verifiedBearer &&
              cookieSession &&
              cookieSession.userId !== verifiedBearer.user.id
            ) {
              throw new ForbiddenError(
                "No está autorizado para cerrar una sesión perteneciente a otro usuario."
              );
            }

            // Si el refresh token de la cookie sigue activo, exigir estrictamente CSRF vinculado a la sesión de la cookie
            // (nunca omitir la validación CSRF de una cookie activa por la mera presencia de un Bearer header).
            if (storedToken.isValid(now)) {
              csrfTokenService.verifyToken({
                headerToken: headerCsrf,
                cookieToken: cookieCsrf,
                expectedSessionId: storedToken.sessionId,
                now,
              });
            } else {
              // El token de la cookie ya expiró o estaba revocado en BD:
              // verificar CSRF contra el `sid` de la cookie o contra el `sid` del Bearer autenticado del mismo usuario
              try {
                csrfTokenService.verifyToken({
                  headerToken: headerCsrf,
                  cookieToken: cookieCsrf,
                  expectedSessionId: storedToken.sessionId,
                  now,
                });
              } catch (csrfErr) {
                if (verifiedBearer) {
                  csrfTokenService.verifyToken({
                    headerToken: headerCsrf,
                    cookieToken: cookieCsrf,
                    expectedSessionId: verifiedBearer.sessionId,
                    now,
                  });
                } else {
                  throw csrfErr;
                }
              }
            }
          } else if (verifiedBearer) {
            // La cookie ya no existe en BD pero hay un Bearer válido: si envió cookie, validar CSRF contra el Bearer sid
            csrfTokenService.verifyToken({
              headerToken: headerCsrf,
              cookieToken: cookieCsrf,
              expectedSessionId: verifiedBearer.sessionId,
              now,
            });
          }
        }

        const sanitizedUserAgent = sanitizeUserAgent(req.headers["user-agent"]);

        // 4. Ejecutar revocación mediante LogoutUseCase
        if (allDevices && verifiedBearer) {
          await logoutUseCase.execute({
            userId: verifiedBearer.user.id,
            allDevices: true,
            ipAddress: req.ip,
            userAgent: sanitizedUserAgent,
          });
        } else if (hasRefreshCookie || verifiedBearer) {
          await logoutUseCase.execute({
            rawRefreshToken:
              hasRefreshCookie && storedTokenSessionId !== null
                ? rawRefreshToken
                : undefined,
            sessionId: verifiedBearer?.sessionId,
            userId: verifiedBearer?.user.id,
            allDevices: false,
            ipAddress: req.ip,
            userAgent: sanitizedUserAgent,
          });
        }

        // 5. Limpiar siempre ambas cookies y responder 200 OK idempotente
        cookieService.clearAuthCookies(reply);

        return reply
          .code(200)
          .send(buildSuccessEnvelope({ loggedOut: true }, req, now));
      }
    );
  }

  // =========================================================================
  // 4. POST /api/v1/auth/change-password
  // =========================================================================
  if (deps.changePasswordUseCase) {
    const changePasswordUseCase = deps.changePasswordUseCase;

    app.post<{ Body: ChangePasswordRequestBody }>(
      "/api/v1/auth/change-password",
      {
        bodyLimit: httpConfig.limits.authBodyLimitBytes,
        preHandler: [changePasswordGuard],
        schema: {
          body: changePasswordBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();
        const authContext = req.authContext!;

        // 1. Rate limiting dual (IP + userId autenticado) ANTES de Argon2id
        await rateLimiter.consumeOrThrow({
          operation: "change_password",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.changePasswordByIp,
          now,
        });
        await rateLimiter.consumeOrThrow({
          operation: "change_password",
          dimension: "user",
          rawIdentifier: authContext.user.id,
          rule: httpConfig.rateLimit.changePasswordByUser,
          now,
        });

        // 2. Ejecutar ChangePasswordUseCase obteniendo userId exclusivamente de req.authContext
        await changePasswordUseCase.execute({
          userId: authContext.user.id,
          currentPassword: req.body.currentPassword,
          newPassword: req.body.newPassword,
          ipAddress: req.ip,
          userAgent: sanitizeUserAgent(req.headers["user-agent"]),
        });

        // 3. Limpiar cookies y exigir reautenticación explícita con la nueva contraseña
        cookieService.clearAuthCookies(reply);

        return reply.code(200).send(
          buildSuccessEnvelope(
            {
              passwordChanged: true,
              sessionsRevoked: true,
              reauthenticationRequired: true,
            },
            req,
            now
          )
        );
      }
    );
  }

  // =========================================================================
  // 5. GET /api/v1/auth/me
  // =========================================================================
  app.get(
    "/api/v1/auth/me",
    {
      preHandler: [fullAccessGuard],
      schema: {
        querystring: emptyQuerySchema,
      },
    },
    async (req, reply) => {
      const now = nowProvider();
      const authContext = req.authContext!;

      // 1. Rate limiting dual (IP + userId autenticado)
      await rateLimiter.consumeOrThrow({
        operation: "me",
        dimension: "ip",
        rawIdentifier: req.ip,
        rule: httpConfig.rateLimit.meByIp,
        now,
      });
      await rateLimiter.consumeOrThrow({
        operation: "me",
        dimension: "user",
        rawIdentifier: authContext.user.id,
        rule: httpConfig.rateLimit.meByUser,
        now,
      });

      // 2. Reutilizar el contexto ya verificado en el guard sin repetir consultas a BD
      const { user, session } = authContext;

      return reply.code(200).send(
        buildSuccessEnvelope(
          {
            user: {
              id: user.id,
              email: user.email,
              status: user.status,
              mustChangePassword: user.mustChangePassword,
              createdAt: user.createdAt.toISOString(),
              updatedAt: user.updatedAt.toISOString(),
            },
            session: {
              id: session.id,
              createdAt: session.createdAt.toISOString(),
              lastActivityAt: session.lastActivityAt.toISOString(),
              expiresAt: session.expiresAt.toISOString(),
            },
          },
          req,
          now
        )
      );
    }
  );
}
