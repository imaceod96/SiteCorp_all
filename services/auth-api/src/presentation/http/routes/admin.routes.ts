import type { FastifyInstance, FastifyRequest } from "fastify";
import { createUserId } from "../../../domain";
import {
  IAuthorizationPolicyService,
  IOperatorPrincipalResolver,
  ISessionRepository,
  ITokenService,
  IUserRepository,
} from "../../../interfaces";
import {
  IAdminCreateUserUseCase,
  IAdminUpdateStatusUseCase,
  IGenerateActivationTokenUseCase,
} from "../../../application";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { createAuthGuardHook } from "../plugins/auth-guard";
import { IRateLimiter } from "../concurrency/rate-limiter";
import { emptyQuerySchema } from "../schemas/auth.schemas";
import {
  adminCreateUserBodySchema,
  AdminCreateUserRequestBody,
  adminGenerateActivationTokenBodySchema,
  AdminGenerateActivationTokenRequestBody,
  adminGenerateActivationTokenParamsSchema,
  AdminGenerateActivationTokenRequestParams,
  adminUpdateStatusBodySchema,
  AdminUpdateStatusRequestBody,
  adminUpdateStatusParamsSchema,
  AdminUpdateStatusRequestParams,
} from "../schemas/admin.schemas";

export interface AdminRoutesDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly rateLimiter: IRateLimiter;
  readonly adminCreateUserUseCase?: IAdminCreateUserUseCase;
  readonly adminUpdateStatusUseCase?: IAdminUpdateStatusUseCase;
  readonly generateActivationTokenUseCase?: IGenerateActivationTokenUseCase;
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

/**
 * Registra los 2 endpoints administrativos protegidos de la Fase 4G.2 FINAL:
 * - POST  /api/v1/auth/admin/users
 * - PATCH /api/v1/auth/admin/users/:id/status
 *
 * Ambos endpoints exigen:
 * 1. Guard de 7 pasos (`createAuthGuardHook`) con `scope: "api:full"` y `role: "authenticated"`.
 * 2. Resolución en vivo de permisos del operador desde `IOperatorPrincipalResolver` (`sitecorp_auth.operator_permissions`).
 * 3. Evaluación de mínimo privilegio mediante `IAuthorizationPolicyService` (`AuthorizationPolicyService`).
 * 4. Rate limiting dual (`admin:ip` y `admin:user`) antes de invocar Argon2id o transacciones SQL.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: AdminRoutesDependencies
): void {
  const {
    httpConfig,
    tokenService,
    userRepo,
    sessionRepo,
    rateLimiter,
    generateActivationTokenUseCase,
  } = deps;
  const nowProvider = deps.nowProvider ?? (() => new Date());

  // =========================================================================
  // 1. POST /api/v1/auth/admin/users
  // =========================================================================
  if (deps.adminCreateUserUseCase) {
    const adminCreateUserUseCase = deps.adminCreateUserUseCase;

    const createUserAdminGuard = createAuthGuardHook(
      {
        tokenService,
        userRepo,
        sessionRepo,
        authPolicy: deps.authPolicy,
        operatorPrincipalResolver: deps.operatorPrincipalResolver,
        nowProvider,
      },
      {
        allowPendingPasswordChange: false,
        adminRequirement: { action: "manage_users" },
      }
    );

    app.post<{ Body: AdminCreateUserRequestBody }>(
      "/api/v1/auth/admin/users",
      {
        bodyLimit: httpConfig.limits.authBodyLimitBytes,
        preHandler: [createUserAdminGuard],
        schema: {
          body: adminCreateUserBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();
        const authContext = req.authContext!;

        // 1. Rate limiting dual (IP + operador autenticado) ANTES de Argon2id
        await rateLimiter.consumeOrThrow({
          operation: "admin",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.adminByIp,
          now,
        });
        await rateLimiter.consumeOrThrow({
          operation: "admin",
          dimension: "user",
          rawIdentifier: authContext.user.id,
          rule: httpConfig.rateLimit.adminByUser,
          now,
        });

        // 2. Ejecutar caso de uso pasando el operador resuelto en vivo por el guard
        const createdUser = await adminCreateUserUseCase.execute(
          {
            email: req.body.email,
            initialPassword: req.body.initialPassword,
            mustChangePassword: req.body.mustChangePassword ?? true,
            ipAddress: req.ip,
            userAgent: sanitizeUserAgent(req.headers["user-agent"]),
          },
          authContext.operator
        );

        // 3. Responder 201 Created sin devolver NUNCA initialPassword ni passwordHash
        return reply.code(201).send(
          buildSuccessEnvelope(
            {
              user: {
                id: createdUser.id,
                email: createdUser.email,
                status: createdUser.status,
                mustChangePassword: createdUser.mustChangePassword,
                createdAt: createdUser.createdAt.toISOString(),
                updatedAt: createdUser.updatedAt.toISOString(),
              },
            },
            req,
            now
          )
        );
      }
    );
  }

  // =========================================================================
  // 2. PATCH /api/v1/auth/admin/users/:id/status
  // =========================================================================
  if (deps.adminUpdateStatusUseCase) {
    const adminUpdateStatusUseCase = deps.adminUpdateStatusUseCase;

    const updateStatusAdminGuard = createAuthGuardHook(
      {
        tokenService,
        userRepo,
        sessionRepo,
        authPolicy: deps.authPolicy,
        operatorPrincipalResolver: deps.operatorPrincipalResolver,
        nowProvider,
      },
      {
        allowPendingPasswordChange: false,
        adminRequirement: {
          action: "update_user_status",
          resolveTargetAndStatus: (req) => {
            const params = req.params as AdminUpdateStatusRequestParams;
            const body = req.body as AdminUpdateStatusRequestBody;
            return {
              targetUserId: createUserId(params.id),
              status: body.status,
            };
          },
        },
      }
    );

    app.patch<{
      Params: AdminUpdateStatusRequestParams;
      Body: AdminUpdateStatusRequestBody;
    }>(
      "/api/v1/auth/admin/users/:id/status",
      {
        bodyLimit: 2048,
        preHandler: [updateStatusAdminGuard],
        schema: {
          params: adminUpdateStatusParamsSchema,
          body: adminUpdateStatusBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();
        const authContext = req.authContext!;
        const targetUserId = createUserId(req.params.id);

        // 1. Rate limiting dual (IP + operador autenticado)
        await rateLimiter.consumeOrThrow({
          operation: "admin",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.adminByIp,
          now,
        });
        await rateLimiter.consumeOrThrow({
          operation: "admin",
          dimension: "user",
          rawIdentifier: authContext.user.id,
          rule: httpConfig.rateLimit.adminByUser,
          now,
        });

        // 2. Ejecutar transición de estado y revocación inmediata de sesiones/permisos
        const updatedUser = await adminUpdateStatusUseCase.execute(
          {
            userId: targetUserId,
            status: req.body.status,
            ipAddress: req.ip,
            userAgent: sanitizeUserAgent(req.headers["user-agent"]),
          },
          authContext.operator
        );

        return reply.code(200).send(
          buildSuccessEnvelope(
            {
              user: {
                id: updatedUser.id,
                email: updatedUser.email,
                status: updatedUser.status,
                mustChangePassword: updatedUser.mustChangePassword,
                updatedAt: updatedUser.updatedAt.toISOString(),
                deletedAt: updatedUser.deletedAt
                  ? updatedUser.deletedAt.toISOString()
                  : null,
              },
            },
            req,
            now
          )
        );
      }
    );
  }

  // =========================================================================
  // 3. POST /api/v1/auth/admin/users/:id/activation-token
  // =========================================================================
  if (generateActivationTokenUseCase) {
    app.post<{
      Params: AdminGenerateActivationTokenRequestParams;
      Body: AdminGenerateActivationTokenRequestBody;
    }>(
      "/api/v1/auth/admin/users/:id/activation-token",
      {
        preHandler: [
          createAuthGuardHook(
            {
              tokenService,
              userRepo,
              sessionRepo,
              authPolicy: deps.authPolicy,
              operatorPrincipalResolver: deps.operatorPrincipalResolver,
              nowProvider,
            },
            {
              allowPendingPasswordChange: false,
              adminRequirement: { action: "manage_users" },
            }
          ),
        ],
        schema: {
          params: adminGenerateActivationTokenParamsSchema,
          body: adminGenerateActivationTokenBodySchema,
          querystring: emptyQuerySchema,
        },
      },
      async (req, reply) => {
        const now = nowProvider();
        const authContext = req.authContext!;

        let targetUserId;
        try {
          targetUserId = createUserId(req.params.id);
        } catch {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            code: "INVALID_USER_ID",
            message: "El parámetro de ruta 'id' debe ser un UUID v4 válido.",
          });
        }

        await rateLimiter.consumeOrThrow({
          operation: "admin",
          dimension: "ip",
          rawIdentifier: req.ip,
          rule: httpConfig.rateLimit.adminByIp,
          now,
        });
        await rateLimiter.consumeOrThrow({
          operation: "admin",
          dimension: "user",
          rawIdentifier: authContext.user.id,
          rule: httpConfig.rateLimit.adminByUser,
          now,
        });

        const tokenResult = await generateActivationTokenUseCase.execute(
          {
            userId: targetUserId,
            tokenType: req.body.tokenType ?? "activation",
            expiresInHours: req.body.expiresInHours ?? 24,
            ipAddress: req.ip,
            userAgent: sanitizeUserAgent(req.headers["user-agent"]),
          },
          authContext.operator
        );

        return reply.code(201).send(
          buildSuccessEnvelope(
            {
              token: {
                tokenId: tokenResult.tokenId,
                userId: tokenResult.userId,
                rawToken: tokenResult.rawToken,
                tokenType: tokenResult.tokenType,
                expiresAt: tokenResult.expiresAt.toISOString(),
              },
            },
            req,
            now
          )
        );
      }
    );
  }
}

