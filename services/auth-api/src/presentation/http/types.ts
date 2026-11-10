import type { Writable } from "node:stream";
import { AuthSession, AuthUser } from "../../domain";
import {
  AccessTokenPayload,
  AuthenticatedPrincipal,
  IAuthorizationPolicyService,
  ICredentialRepository,
  IActivationTokenRepository,
  IOperatorPermissionRepository,
  IOperatorPrincipalResolver,
  IPasswordHasher,
  ISecurityAuditService,
  ISessionRepository,
  ITokenService,
  ITransactionManager,
  IUserRepository,
} from "../../interfaces";
import {
  IAdminCreateUserUseCase,
  IAdminUpdateStatusUseCase,
  IChangePasswordUseCase,
  IConsumeActivationTokenUseCase,
  IGenerateActivationTokenUseCase,
  ILoginUseCase,
  ILogoutUseCase,
  IRefreshSessionUseCase,
} from "../../application";
import { AuthHttpConfig } from "../../infrastructure/config/http-config";
import { AuthCookieService } from "./plugins/cookies.service";
import { CsrfTokenService } from "./plugins/csrf-token.service";
import { Argon2ConcurrencyGate } from "./concurrency/argon2-concurrency-gate";
import { IRateLimiter } from "./concurrency/rate-limiter";

/**
 * Contexto tipado e inmutable de identidad y sesión verificado por el guard de 7 pasos.
 */
export interface HttpAuthContext {
  readonly user: AuthUser;
  readonly session: AuthSession;
  readonly claims: AccessTokenPayload;
  readonly operator?: AuthenticatedPrincipal;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext?: HttpAuthContext;
  }
}

export type ReadinessProbe = () => Promise<boolean>;

/**
 * Contenedor explícito de dependencias para la factoría `buildAuthHttpServer()`.
 *
 * Proporciona los contratos transversales de seguridad, estado de sesión,
 * concurrencia, rate limiting, sondas de readiness y casos de uso de autenticación
 * y administración para los endpoints de la Fase 4G.2 FINAL.
 */
export interface AuthHttpServerDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly credentialRepo?: ICredentialRepository;
  readonly operatorPermissionRepo?: IOperatorPermissionRepository;
  readonly activationTokenRepo?: IActivationTokenRepository;
  readonly passwordHasher?: IPasswordHasher;
  readonly auditService?: ISecurityAuditService;
  readonly txManager?: ITransactionManager;
  readonly loginUseCase?: ILoginUseCase;
  readonly refreshSessionUseCase?: IRefreshSessionUseCase;
  readonly logoutUseCase?: ILogoutUseCase;
  readonly changePasswordUseCase?: IChangePasswordUseCase;
  readonly adminCreateUserUseCase?: IAdminCreateUserUseCase;
  readonly adminUpdateStatusUseCase?: IAdminUpdateStatusUseCase;
  readonly generateActivationTokenUseCase?: IGenerateActivationTokenUseCase;
  readonly consumeActivationTokenUseCase?: IConsumeActivationTokenUseCase;
  readonly maxFailedLoginAttempts?: number;
  readonly lockDurationMs?: number;
  readonly authPolicy?: IAuthorizationPolicyService;
  readonly operatorPrincipalResolver?: IOperatorPrincipalResolver;
  readonly cookieService?: AuthCookieService;
  readonly csrfTokenService?: CsrfTokenService;
  readonly argon2Gate?: Argon2ConcurrencyGate;
  readonly rateLimiter?: IRateLimiter;
  readonly domainRepo?: import("../../infrastructure/postgres/postgres-domain.repository").PostgresDomainRepository;
  readonly submodulesRepo?: import("../../infrastructure/postgres/postgres-submodules.repository").PostgresSubmodulesRepository;
  readonly storageService?: import("../../infrastructure/storage/local-file-storage.service").LocalFileStorageService;
  readonly emailService?: import("../../interfaces").ITransactionalEmailService;
  /** Sonda inyectable para verificar conectividad a PostgreSQL en `/health/ready` */
  readonly databaseReadinessCheck?: ReadinessProbe;
  /** Sonda inyectable para verificar disponibilidad del subsistema criptográfico en `/health/ready` */
  readonly cryptoReadinessCheck?: ReadinessProbe;
  /** Stream opcional de salida para el logger Pino (útil para auditar ausencia de secretos en tests) */
  readonly logStream?: Writable;
  /** Proveedor de tiempo inyectable para pruebas deterministas */
  readonly nowProvider?: () => Date;
}
