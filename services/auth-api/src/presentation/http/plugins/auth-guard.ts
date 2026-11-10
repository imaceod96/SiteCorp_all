import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import {
  DomainError,
  ForbiddenError,
  SessionInvalidError,
  TokenInvalidError,
  UnauthorizedError,
  UserId,
  createUserId,
} from "../../../domain";
import {
  AccessTokenPayload,
  FailClosedOperatorPrincipalResolver,
  IAuthorizationPolicyService,
  IOperatorPrincipalResolver,
  ISessionRepository,
  ITokenService,
  IUserRepository,
} from "../../../interfaces";
import { verifyAccessTokenSessionState } from "../../../infrastructure/crypto/session-state-verifier";
import { isValidSessionId } from "../../../infrastructure/crypto/jose-token.service";
import { HttpAuthContext } from "../types";

/**
 * Error lanzado cuando un usuario con cambio obligatorio de contraseña pendiente
 * (`role: "pending_password_change"`, `scope: "auth:change_password"`) intenta
 * acceder a una ruta que exige el scope completo `api:full`.
 */
export class PasswordChangeRequiredError extends DomainError {
  public readonly code = "PASSWORD_CHANGE_REQUIRED";
  constructor(
    message: string = "Debe completar el cambio obligatorio de contraseña antes de acceder a este recurso."
  ) {
    super(message);
  }
}

export type AdminPermissionRequirement =
  | { readonly action: "manage_users" }
  | {
      readonly action: "suspend_user" | "delete_user";
      readonly resolveTargetUserId: (req: FastifyRequest) => UserId;
    }
  | {
      readonly action: "update_user_status";
      readonly resolveTargetAndStatus: (req: FastifyRequest) => {
        readonly targetUserId: UserId;
        readonly status: "active" | "suspended" | "deleted";
      };
    };

export interface AuthGuardOptions {
  /**
   * Si es `true`, permite tanto `scope: "api:full"` como `scope: "auth:change_password"`
   * (exclusivamente para las futuras rutas `/change-password` y `/logout`).
   * Por defecto es `false` (exige estrictamente `scope === "api:full"` y `role === "authenticated"`).
   */
  readonly allowPendingPasswordChange?: boolean;
  /**
   * Si se especifica, exige resolución en vivo del operador mediante `IOperatorPrincipalResolver`
   * y autorización mediante `IAuthorizationPolicyService`.
   */
  readonly adminRequirement?: AdminPermissionRequirement;
}

export interface AuthGuardDependencies {
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly authPolicy?: IAuthorizationPolicyService;
  readonly operatorPrincipalResolver?: IOperatorPrincipalResolver;
  readonly nowProvider?: () => Date;
}

const BEARER_HEADER_REGEX = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Extrae de forma estricta el JWT desde la cabecera `Authorization: Bearer <jwt>`.
 * Rechaza esquemas distintos de `Bearer`, múltiples espacios o tokens malformados.
 */
export function extractBearerToken(
  authorizationHeader: string | string[] | undefined
): string {
  if (typeof authorizationHeader !== "string" || authorizationHeader.length === 0) {
    throw new UnauthorizedError(
      "Se requiere una cabecera 'Authorization: Bearer <token>' válida."
    );
  }

  if (authorizationHeader.length > 4096) {
    throw new TokenInvalidError("La cabecera Authorization excede la longitud máxima permitida.");
  }

  const match = BEARER_HEADER_REGEX.exec(authorizationHeader);
  if (!match || !match[1]) {
    throw new UnauthorizedError(
      "Formato de cabecera Authorization inválido. Se esperaba 'Bearer <jwt>'."
    );
  }

  return match[1];
}

function validateStructuralClaims(claims: AccessTokenPayload): void {
  if (!claims || typeof claims !== "object") {
    throw new TokenInvalidError("Los claims del token de acceso son inválidos.");
  }

  // Validar sub como UUID v4 válido (UserId)
  try {
    createUserId(claims.sub);
  } catch {
    throw new TokenInvalidError(
      "El claim 'sub' del token no contiene un identificador de usuario válido."
    );
  }

  if (typeof claims.email !== "string" || claims.email.trim().length < 3) {
    throw new TokenInvalidError("El claim 'email' del token es inválido.");
  }

  if (
    claims.role !== "authenticated" &&
    claims.role !== "pending_password_change"
  ) {
    throw new TokenInvalidError("El claim 'role' del token no es reconocido.");
  }

  if (
    claims.scope !== "api:full" &&
    claims.scope !== "auth:change_password"
  ) {
    throw new TokenInvalidError("El claim 'scope' del token no es reconocido.");
  }

  if (!isValidSessionId(claims.sid)) {
    throw new SessionInvalidError(
      "El token de acceso carece de un identificador de sesión ('sid') válido."
    );
  }
}

/**
 * Construye el hook `preHandler` reutilizable que ejecuta el pipeline obligatorio
 * de 7 pasos de autenticación y autorización para endpoints protegidos:
 *
 * 1. Extracción estricta de `Authorization: Bearer <token>`.
 * 2. Verificación criptográfica Ed25519 con `tokenService.verifyAccessToken()`.
 * 3. Validación estructural de claims (`sub`, `email`, `role`, `scope`, `sid`).
 * 4. Consulta de estado de sesión persistida con `verifyAccessTokenSessionState()`.
 * 5. Comprobación en vivo del estado del usuario y coherencia bidireccional de `mustChangePassword`.
 * 6. Validación de `scope` (`api:full` vs `auth:change_password`) y resolución en vivo
 *    de privilegios administrativos (`IOperatorPrincipalResolver` + `IAuthorizationPolicyService`).
 * 7. Entrega de `req.authContext` congelado e inmutable al controlador.
 */
export function createAuthGuardHook(
  deps: AuthGuardDependencies,
  options: AuthGuardOptions = {}
): preHandlerAsyncHookHandler {
  const principalResolver =
    deps.operatorPrincipalResolver ?? new FailClosedOperatorPrincipalResolver();
  const nowProvider = deps.nowProvider ?? (() => new Date());

  return async function authGuardPreHandler(
    req: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    const now = nowProvider();

    // PASO 1: Extraer Authorization: Bearer
    const rawJwt = extractBearerToken(req.headers.authorization);

    // PASO 2: Verificar criptográficamente el JWT con JoseTokenService
    const claims = await deps.tokenService.verifyAccessToken(rawJwt);

    // PASO 3: Validar claims estructurales
    validateStructuralClaims(claims);

    // PASO 4 y PASO 5: Consultar sesión y comprobar estado del usuario en vivo
    const verifiedState = await verifyAccessTokenSessionState(
      claims,
      deps.sessionRepo,
      deps.userRepo,
      now
    );

    const { user, session } = verifiedState;
    const isUserPendingPasswordChange =
      user.mustChangePassword || user.status === "pending_password_change";

    // Coherencia bidireccional adicional (Paso 5):
    // Si el usuario ya cambió su contraseña (`!isUserPendingPasswordChange`), un token antiguo
    // con `scope: "auth:change_password"` o `role: "pending_password_change"` ya no es válido.
    if (
      !isUserPendingPasswordChange &&
      (claims.role === "pending_password_change" ||
        claims.scope === "auth:change_password")
    ) {
      throw new SessionInvalidError(
        "El token temporal de cambio de contraseña ya no es válido."
      );
    }

    // PASO 6.A: Validar confinamiento de scope
    const allowPending = options.allowPendingPasswordChange === true;
    if (!allowPending) {
      if (
        isUserPendingPasswordChange ||
        claims.scope !== "api:full" ||
        claims.role !== "authenticated"
      ) {
        throw new PasswordChangeRequiredError();
      }
    }

    // PASO 6.B: Autorización administrativa en tiempo real (nunca confía sólo en claims JWT)
    if (options.adminRequirement) {
      if (
        isUserPendingPasswordChange ||
        claims.scope !== "api:full" ||
        claims.role !== "authenticated"
      ) {
        throw new PasswordChangeRequiredError();
      }

      if (!deps.authPolicy || !deps.operatorPrincipalResolver) {
        throw new ForbiddenError(
          "Las operaciones administrativas están deshabilitadas hasta configurar una fuente autoritativa de permisos."
        );
      }

      const operator = await principalResolver.resolvePrincipal(user);
      if (!operator) {
        throw new ForbiddenError(
          "El operador autenticado carece de un perfil de permisos administrativos válido."
        );
      }

      const reqAction = options.adminRequirement;
      if (reqAction.action === "manage_users") {
        if (!deps.authPolicy.canManageUsers(operator)) {
          throw new ForbiddenError(
            "El operador no cuenta con permisos para administrar usuarios."
          );
        }
      } else if (reqAction.action === "suspend_user") {
        const targetId = reqAction.resolveTargetUserId(req);
        if (!deps.authPolicy.canSuspendUser(operator, targetId)) {
          throw new ForbiddenError(
            "El operador no cuenta con permisos para modificar el estado de esta cuenta."
          );
        }
      } else if (reqAction.action === "delete_user") {
        const targetId = reqAction.resolveTargetUserId(req);
        if (!deps.authPolicy.canDeleteUser(operator, targetId)) {
          throw new ForbiddenError(
            "El operador no cuenta con permisos para dar de baja esta cuenta."
          );
        }
      } else if (reqAction.action === "update_user_status") {
        const { targetUserId, status } = reqAction.resolveTargetAndStatus(req);
        if (status === "deleted") {
          if (!deps.authPolicy.canDeleteUser(operator, targetUserId)) {
            throw new ForbiddenError(
              "El operador no cuenta con permisos para dar de baja esta cuenta."
            );
          }
        } else {
          if (!deps.authPolicy.canSuspendUser(operator, targetUserId)) {
            throw new ForbiddenError(
              "El operador no cuenta con permisos para modificar el estado de esta cuenta."
            );
          }
        }
      }

      // PASO 7 (con operador resuelto)
      const context: HttpAuthContext = Object.freeze({
        user,
        session,
        claims,
        operator: Object.freeze(operator),
      });
      req.authContext = context;
      return;
    }

    // PASO 7: Entregar AuthContext tipado e inmutable
    const context: HttpAuthContext = Object.freeze({
      user,
      session,
      claims,
    });
    req.authContext = context;
  };
}
