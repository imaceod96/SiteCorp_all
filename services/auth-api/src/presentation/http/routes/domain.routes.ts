import type { FastifyInstance, FastifyRequest } from "fastify";
import { PostgresDomainRepository } from "../../../infrastructure/postgres/postgres-domain.repository";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { createAuthGuardHook } from "../plugins/auth-guard";
import {
  IAuthorizationPolicyService,
  IOperatorPrincipalResolver,
  ISessionRepository,
  ITokenService,
  IUserRepository,
} from "../../../interfaces";
import { IRateLimiter } from "../concurrency/rate-limiter";

export interface DomainRoutesDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly domainRepo: PostgresDomainRepository;
  readonly rateLimiter: IRateLimiter;
  readonly authPolicy?: IAuthorizationPolicyService;
  readonly operatorPrincipalResolver?: IOperatorPrincipalResolver;
  readonly nowProvider?: () => Date;
}

function buildEnvelope<T>(data: T, req: FastifyRequest, now: Date) {
  return {
    data,
    meta: {
      requestId: req.id,
      timestamp: now.toISOString(),
    },
  };
}

export function registerDomainRoutes(
  app: FastifyInstance,
  deps: DomainRoutesDependencies
): void {
  const {
    tokenService,
    userRepo,
    sessionRepo,
    domainRepo,
    rateLimiter,
    httpConfig,
  } = deps;
  const nowProvider = deps.nowProvider ?? (() => new Date());

  const authGuard = createAuthGuardHook(
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

  // =========================================================================
  // 1. POST /api/v1/domain/companies & GET /api/v1/domain/companies
  // =========================================================================
  app.post<{ Body: { code: string; name: string; description?: string; logoUrl?: string } }>(
    "/api/v1/domain/companies",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      await rateLimiter.consumeOrThrow({
        operation: "admin",
        dimension: "ip",
        rawIdentifier: req.ip,
        rule: httpConfig.rateLimit.adminByIp,
        now,
      });

      const company = await domainRepo.createCompanyClient(req.body);
      return reply.code(201).send(buildEnvelope({ company }, req, now));
    }
  );

  app.get(
    "/api/v1/domain/companies",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const companies = await domainRepo.listCompanyClients();
      return reply.code(200).send(buildEnvelope({ companies }, req, now));
    }
  );

  // =========================================================================
  // 2. WORKERS: GET /api/v1/domain/companies/:companyId/workers & POST ...
  // =========================================================================
  app.post<{
    Params: { companyId: string };
    Body: {
      identificationNumber: string;
      firstName: string;
      lastName: string;
      secondLastName?: string;
      email?: string;
      address?: string;
      photoUrl?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/workers",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const worker = await domainRepo.createWorker({
        companyClientId: req.params.companyId,
        ...req.body,
      });

      await domainRepo.logAuditEvent({
        companyClientId: req.params.companyId,
        userId: req.authContext?.user.id,
        action: "CREATE_WORKER",
        entityType: "worker",
        entityId: worker.id,
        module: "workers",
        newState: worker as unknown as Record<string, unknown>,
        ipAddress: req.ip,
      });

      return reply.code(201).send(buildEnvelope({ worker }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/workers",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const workers = await domainRepo.listWorkersByCompany(req.params.companyId);
      return reply.code(200).send(buildEnvelope({ workers }, req, now));
    }
  );

  // =========================================================================
  // 3. CONTRACTS: POST & GET
  // =========================================================================
  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      organizationEntityId?: string;
      positionId?: string;
      startDate: string;
      endDate?: string;
      baseSalary: number;
    };
  }>(
    "/api/v1/domain/companies/:companyId/contracts",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const contract = await domainRepo.createContract({
        companyClientId: req.params.companyId,
        workerId: req.body.workerId,
        organizationEntityId: req.body.organizationEntityId,
        positionId: req.body.positionId,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
        baseSalary: req.body.baseSalary,
      });

      return reply.code(201).send(buildEnvelope({ contract }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/contracts",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const contracts = await domainRepo.listContractsByCompany(req.params.companyId);
      return reply.code(200).send(buildEnvelope({ contracts }, req, now));
    }
  );

  // =========================================================================
  // 4. VACATIONS: POST movement
  // =========================================================================
  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      year: number;
      movementType: "ACCRUAL" | "TAKEN" | "ADJUSTMENT";
      days: number;
      notes?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/vacations/movement",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const vacation = await domainRepo.recordVacationMovement({
        companyClientId: req.params.companyId,
        workerId: req.body.workerId,
        year: req.body.year,
        movementType: req.body.movementType,
        days: req.body.days,
        notes: req.body.notes,
      });

      return reply.code(200).send(buildEnvelope({ vacation }, req, now));
    }
  );
}
