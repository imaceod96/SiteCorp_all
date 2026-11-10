import type { FastifyInstance, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "../../../domain";
import {
  DomainResourceNotFoundError,
  PostgresDomainRepository,
  TenantPermission,
} from "../../../infrastructure/postgres/postgres-domain.repository";
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

const UUID_V4_LIKE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_V4_LIKE_REGEX.test(value.trim())) {
    const err = new Error(`El parámetro '${fieldName}' debe ser un UUID válido.`) as Error & {
      statusCode?: number;
      code?: string;
      validation?: unknown[];
    };
    err.validation = [{ instancePath: `/${fieldName}`, keyword: "format" }];
    throw err;
  }
  return value.trim();
}

function getAuthenticatedUserId(req: FastifyRequest): string {
  const userId = req.authContext?.user.id;
  if (!userId) {
    throw new UnauthorizedError("Contexto de identidad autenticada no disponible.");
  }
  return userId;
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
  // 0. GET /api/v1/domain/me/access — Perfil autoritativo de membresías y permisos
  // =========================================================================
  app.get(
    "/api/v1/domain/me/access",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const access = await domainRepo.getUserAccessOverview(userId);
      return reply.code(200).send(buildEnvelope({ access }, req, now));
    }
  );

  // =========================================================================
  // 1. COMPANIES: POST, GET (list), GET (:companyId), PATCH (:companyId), memberships
  // =========================================================================
  app.post<{
    Body: { code: string; name: string; description?: string; logoUrl?: string };
  }>(
    "/api/v1/domain/companies",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);

      await rateLimiter.consumeOrThrow({
        operation: "admin",
        dimension: "ip",
        rawIdentifier: req.ip,
        rule: httpConfig.rateLimit.adminByIp,
        now,
      });

      // Solo un administrador de plataforma verificado en base de datos puede crear empresas clientes
      await domainRepo.requirePlatformAdmin(userId);

      if (
        !req.body ||
        typeof req.body.code !== "string" ||
        !req.body.code.trim() ||
        typeof req.body.name !== "string" ||
        !req.body.name.trim()
      ) {
        const err = new Error("Los campos 'code' y 'name' son obligatorios.") as Error & {
          validation?: unknown[];
        };
        err.validation = [{ instancePath: "/code", keyword: "required" }];
        throw err;
      }

      const company = await domainRepo.createCompanyClient(req.body);
      await domainRepo.logAuditEvent({
        companyClientId: company.id,
        userId,
        action: "CREATE_COMPANY_CLIENT",
        entityType: "company_client",
        entityId: company.id,
        module: "companies",
        newState: company as unknown as Record<string, unknown>,
        ipAddress: req.ip,
      });

      return reply.code(201).send(buildEnvelope({ company }, req, now));
    }
  );

  app.get(
    "/api/v1/domain/companies",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);

      // Filtra estrictamente por las empresas autorizadas en base de datos para el usuario
      // (o todas si posee permiso 'security.admin' activo en sitecorp_auth.operator_permissions).
      // Si el usuario no tiene acceso autorizado a ninguna empresa, lanza ForbiddenError (403).
      const companies = await domainRepo.listAuthorizedCompaniesForUser(userId);
      return reply.code(200).send(buildEnvelope({ companies }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const company = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "companies.view",
        },
        async () => {
          const found = await domainRepo.getCompanyClientById(companyId);
          if (!found) {
            throw new DomainResourceNotFoundError("Empresa no encontrada.");
          }
          return found;
        }
      );

      return reply.code(200).send(buildEnvelope({ company }, req, now));
    }
  );

  app.patch<{
    Params: { companyId: string };
    Body: { name?: string; description?: string | null; isActive?: boolean; code?: unknown };
  }>(
    "/api/v1/domain/companies/:companyId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      if (req.body && "code" in req.body && req.body.code !== undefined) {
        const err = new Error("El código de la empresa ('code') es inmutable.") as Error & {
          validation?: unknown[];
        };
        err.validation = [{ instancePath: "/code", keyword: "immutable" }];
        throw err;
      }

      if (!req.body || typeof req.body.name !== "string" || !req.body.name.trim()) {
        const err = new Error("El nombre de la empresa ('name') es obligatorio.") as Error & {
          validation?: unknown[];
        };
        err.validation = [{ instancePath: "/name", keyword: "required" }];
        throw err;
      }

      const company = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "companies.manage",
        },
        async () => {
          const updated = await domainRepo.updateCompanyClient(companyId, {
            name: req.body.name!,
            description: req.body.description,
            isActive: req.body.isActive,
          });
          if (!updated) {
            throw new DomainResourceNotFoundError("Empresa no encontrada.");
          }
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "UPDATE_COMPANY_CLIENT",
            entityType: "company_client",
            entityId: companyId,
            module: "companies",
            newState: updated as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return updated;
        }
      );

      return reply.code(200).send(buildEnvelope({ company }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      targetUserId: string;
      roleCode?: string;
      permissions: TenantPermission[];
    };
  }>(
    "/api/v1/domain/companies/:companyId/memberships",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const targetUserId = assertValidUuid(req.body?.targetUserId, "targetUserId");

      if (!Array.isArray(req.body?.permissions) || req.body.permissions.length === 0) {
        const err = new Error("Se requiere al menos un permiso válido en 'permissions'.") as Error & {
          validation?: unknown[];
        };
        err.validation = [{ instancePath: "/permissions", keyword: "minItems" }];
        throw err;
      }

      const membership = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "companies.manage",
        },
        async () => {
          const granted = await domainRepo.grantCompanyMembership({
            userId: targetUserId,
            companyClientId: companyId,
            roleCode: req.body.roleCode,
            permissions: req.body.permissions,
            grantedBy: userId,
          });

          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "GRANT_COMPANY_MEMBERSHIP",
            entityType: "company_client_membership",
            entityId: granted.id,
            module: "access_control",
            newState: {
              targetUserId,
              roleCode: granted.roleCode,
              permissions: req.body.permissions,
            },
            ipAddress: req.ip,
          });

          return granted;
        }
      );

      return reply.code(201).send(buildEnvelope({ membership }, req, now));
    }
  );

  app.delete<{
    Params: { companyId: string; targetUserId: string };
  }>(
    "/api/v1/domain/companies/:companyId/memberships/:targetUserId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const targetUserId = assertValidUuid(req.params.targetUserId, "targetUserId");

      const revoked = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "companies.manage",
        },
        async () => {
          const wasRevoked = await domainRepo.revokeCompanyMembership(
            targetUserId,
            companyId
          );
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "REVOKE_COMPANY_MEMBERSHIP",
            entityType: "company_client_membership",
            entityId: targetUserId,
            module: "access_control",
            newState: { targetUserId, revoked: wasRevoked },
            ipAddress: req.ip,
          });
          return wasRevoked;
        }
      );

      return reply.code(200).send(buildEnvelope({ revoked }, req, now));
    }
  );

  // =========================================================================
  // 2. ORGANIZATION ENTITIES & POSITIONS (PLAZAS)
  // =========================================================================
  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/entities",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const entities = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.view",
        },
        async () => domainRepo.listEntitiesByCompany(companyId)
      );

      return reply.code(200).send(buildEnvelope({ entities }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      parentId?: string;
      name: string;
      entityType?: string;
      code?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/entities",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      if (req.body?.parentId) {
        assertValidUuid(req.body.parentId, "parentId");
      }

      const entity = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.manage",
        },
        async () => {
          const created = await domainRepo.createOrganizationEntity({
            companyClientId: companyId,
            parentId: req.body.parentId,
            name: req.body.name,
            entityType: req.body.entityType,
            code: req.body.code,
          });
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "CREATE_ORGANIZATION_ENTITY",
            entityType: "organization_entity",
            entityId: created.id,
            module: "entities",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ entity }, req, now));
    }
  );

  app.patch<{
    Params: { companyId: string; entityId: string };
    Body: { name?: string; entityType?: string; code?: string | null; isActive?: boolean };
  }>(
    "/api/v1/domain/companies/:companyId/entities/:entityId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const entityId = assertValidUuid(req.params.entityId, "entityId");

      const entity = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.manage",
        },
        async () => {
          const updated = await domainRepo.updateOrganizationEntity(
            companyId,
            entityId,
            req.body
          );
          if (!updated) {
            throw new DomainResourceNotFoundError(
              "La entidad organizativa no existe en la empresa autorizada."
            );
          }
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "UPDATE_ORGANIZATION_ENTITY",
            entityType: "organization_entity",
            entityId: updated.id,
            module: "entities",
            newState: updated as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return updated;
        }
      );

      return reply.code(200).send(buildEnvelope({ entity }, req, now));
    }
  );

  app.delete<{ Params: { companyId: string; entityId: string } }>(
    "/api/v1/domain/companies/:companyId/entities/:entityId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const entityId = assertValidUuid(req.params.entityId, "entityId");

      await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.manage",
        },
        async () => {
          const deleted = await domainRepo.deleteOrganizationEntity(companyId, entityId);
          if (!deleted) {
            throw new DomainResourceNotFoundError(
              "La entidad organizativa no existe en la empresa autorizada."
            );
          }
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "DELETE_ORGANIZATION_ENTITY",
            entityType: "organization_entity",
            entityId,
            module: "entities",
            ipAddress: req.ip,
          });
        }
      );

      return reply.code(200).send(buildEnvelope({ deleted: true }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/positions",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const positions = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.view",
        },
        async () => domainRepo.listPositionsByCompany(companyId)
      );

      return reply.code(200).send(buildEnvelope({ positions }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      organizationEntityId: string;
      jobTitle: string;
      positionName: string;
      authorizedQuantity?: number;
      dailyHours?: number;
    };
  }>(
    "/api/v1/domain/companies/:companyId/positions",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const organizationEntityId = assertValidUuid(
        req.body?.organizationEntityId,
        "organizationEntityId"
      );

      const position = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.manage",
        },
        async () => {
          const created = await domainRepo.createPosition({
            companyClientId: companyId,
            organizationEntityId,
            jobTitle: req.body.jobTitle,
            positionName: req.body.positionName,
            authorizedQuantity: req.body.authorizedQuantity,
            dailyHours: req.body.dailyHours,
          });
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "CREATE_POSITION",
            entityType: "organization_position",
            entityId: created.id,
            module: "positions",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ position }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string; positionId: string };
    Body: { workerId: string; startDate: string };
  }>(
    "/api/v1/domain/companies/:companyId/positions/:positionId/assign",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const positionId = assertValidUuid(req.params.positionId, "positionId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");

      const assignment = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.manage",
        },
        async () => {
          const created = await domainRepo.assignWorkerToPosition({
            companyClientId: companyId,
            workerId,
            positionId,
            startDate: new Date(req.body.startDate),
          });
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "ASSIGN_WORKER_TO_POSITION",
            entityType: "worker_position_assignment",
            entityId: created.id,
            module: "positions",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ assignment }, req, now));
    }
  );

  // =========================================================================
  // 3. WORKERS: GET (list), GET (:workerId), POST, PATCH (:workerId), DELETE (:workerId)
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
       companyClientId?: unknown;
      tenantId?: unknown;
    };
  }>(
    "/api/v1/domain/companies/:companyId/workers",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      // Si el cliente intenta enviar un companyClientId o tenantId contradictorio en el body, rechazar
      if (
        (req.body?.companyClientId !== undefined &&
          req.body.companyClientId !== companyId) ||
        (req.body?.tenantId !== undefined && req.body.tenantId !== companyId)
      ) {
        throw new ForbiddenError(
          "Inconsistencia de inquilino: el identificador de empresa del cuerpo no coincide con la ruta autorizada."
        );
      }

      const worker = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () => {
          const created = await domainRepo.createWorker({
            companyClientId: companyId,
            identificationNumber: req.body.identificationNumber,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            secondLastName: req.body.secondLastName,
            email: req.body.email,
            address: req.body.address,
            photoUrl: req.body.photoUrl,
          });

          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "CREATE_WORKER",
            entityType: "worker",
            entityId: created.id,
            module: "workers",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });

          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ worker }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/workers",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const workers = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.view",
        },
        async () => domainRepo.listWorkersByCompany(companyId)
      );

      return reply.code(200).send(buildEnvelope({ workers }, req, now));
    }
  );

  app.get<{ Params: { companyId: string; workerId: string } }>(
    "/api/v1/domain/companies/:companyId/workers/:workerId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.params.workerId, "workerId");

      const worker = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.view",
        },
        async () => {
          const found = await domainRepo.getWorkerById(companyId, workerId);
          if (!found) {
            throw new DomainResourceNotFoundError(
              "El trabajador solicitado no existe en la empresa autorizada."
            );
          }
          return found;
        }
      );

      return reply.code(200).send(buildEnvelope({ worker }, req, now));
    }
  );

  app.patch<{
    Params: { companyId: string; workerId: string };
    Body: {
      firstName?: string;
      lastName?: string;
      secondLastName?: string | null;
      email?: string | null;
      address?: string | null;
      photoUrl?: string | null;
      companyClientId?: unknown;
    };
  }>(
    "/api/v1/domain/companies/:companyId/workers/:workerId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.params.workerId, "workerId");

      if (
        req.body?.companyClientId !== undefined &&
        req.body.companyClientId !== companyId
      ) {
        throw new ForbiddenError(
          "Prohibido reasignar un trabajador a otra empresa."
        );
      }

      const worker = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () => {
          const updated = await domainRepo.updateWorker(companyId, workerId, req.body);
          if (!updated) {
            throw new DomainResourceNotFoundError(
              "El trabajador solicitado no existe en la empresa autorizada."
            );
          }
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "UPDATE_WORKER",
            entityType: "worker",
            entityId: updated.id,
            module: "workers",
            newState: updated as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return updated;
        }
      );

      return reply.code(200).send(buildEnvelope({ worker }, req, now));
    }
  );

  app.delete<{ Params: { companyId: string; workerId: string } }>(
    "/api/v1/domain/companies/:companyId/workers/:workerId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.params.workerId, "workerId");

      await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () => {
          const deleted = await domainRepo.deleteWorker(companyId, workerId);
          if (!deleted) {
            throw new DomainResourceNotFoundError(
              "El trabajador solicitado no existe en la empresa autorizada."
            );
          }
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "DELETE_WORKER",
            entityType: "worker",
            entityId: workerId,
            module: "workers",
            ipAddress: req.ip,
          });
        }
      );

      return reply.code(200).send(buildEnvelope({ deleted: true }, req, now));
    }
  );

  // =========================================================================
  // 4. CONTRACTS & LABOR MOVEMENTS
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
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      if (req.body?.organizationEntityId) {
        assertValidUuid(req.body.organizationEntityId, "organizationEntityId");
      }
      if (req.body?.positionId) {
        assertValidUuid(req.body.positionId, "positionId");
      }

      const contract = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.manage",
        },
        async () => {
          const created = await domainRepo.createContract({
            companyClientId: companyId,
            workerId,
            organizationEntityId: req.body.organizationEntityId,
            positionId: req.body.positionId,
            startDate: new Date(req.body.startDate),
            endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
            baseSalary: req.body.baseSalary,
          });

          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "CREATE_CONTRACT",
            entityType: "employment_contract",
            entityId: created.id,
            module: "contracts",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });

          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ contract }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/contracts",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const contracts = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.view",
        },
        async () => domainRepo.listContractsByCompany(companyId)
      );

      return reply.code(200).send(buildEnvelope({ contracts }, req, now));
    }
  );

  app.get<{ Params: { companyId: string; contractId: string } }>(
    "/api/v1/domain/companies/:companyId/contracts/:contractId",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const contractId = assertValidUuid(req.params.contractId, "contractId");

      const contract = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.view",
        },
        async () => {
          const found = await domainRepo.getContractById(companyId, contractId);
          if (!found) {
            throw new DomainResourceNotFoundError(
              "El contrato solicitado no existe en la empresa autorizada."
            );
          }
          return found;
        }
      );

      return reply.code(200).send(buildEnvelope({ contract }, req, now));
    }
  );

  app.get<{
    Params: { companyId: string };
    Querystring: { workerId?: string };
  }>(
    "/api/v1/domain/companies/:companyId/movements",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = req.query?.workerId
        ? assertValidUuid(req.query.workerId, "workerId")
        : undefined;

      const movements = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.view",
        },
        async () => domainRepo.listEmploymentMovementsByCompany(companyId, workerId)
      );

      return reply.code(200).send(buildEnvelope({ movements }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      organizationEntityId?: string;
      movementType:
        | "ALTA"
        | "BAJA"
        | "REINGRESO"
        | "CAMBIO_PUESTO"
        | "CAMBIO_CONTRATO"
        | "MODIFICACION_SALARIAL";
      effectiveDate: string;
      reason?: string;
      previousPositionId?: string;
      newPositionId?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/movements",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");

      const movement = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () => {
          const created = await domainRepo.createEmploymentMovement({
            companyClientId: companyId,
            workerId,
            organizationEntityId: req.body.organizationEntityId,
            movementType: req.body.movementType,
            effectiveDate: new Date(req.body.effectiveDate),
            reason: req.body.reason,
            previousPositionId: req.body.previousPositionId,
            newPositionId: req.body.newPositionId,
            createdBy: userId,
          });

          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: `EMPLOYMENT_MOVEMENT_${req.body.movementType}`,
            entityType: "worker_employment_movement",
            entityId: created.id,
            module: "workers",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });

          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ movement }, req, now));
    }
  );

  // =========================================================================
  // 5. VACATIONS: GET & POST movement
  // =========================================================================
  app.get<{
    Params: { companyId: string };
    Querystring: { workerId?: string };
  }>(
    "/api/v1/domain/companies/:companyId/vacations",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = req.query?.workerId
        ? assertValidUuid(req.query.workerId, "workerId")
        : undefined;

      const vacations = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "vacations.view",
        },
        async () => domainRepo.listVacationsByCompany(companyId, workerId)
      );

      return reply.code(200).send(buildEnvelope({ vacations }, req, now));
    }
  );

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
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");

      const vacation = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "vacations.manage",
        },
        async () => {
          const updated = await domainRepo.recordVacationMovement({
            companyClientId: companyId,
            workerId,
            year: req.body.year,
            movementType: req.body.movementType,
            days: req.body.days,
            notes: req.body.notes,
          });

          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: `VACATION_${req.body.movementType}`,
            entityType: "worker_vacation",
            entityId: updated.id,
            module: "vacations",
            newState: updated as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });

          return updated;
        }
      );

      return reply.code(200).send(buildEnvelope({ vacation }, req, now));
    }
  );

  // =========================================================================
  // 6. AUDIT LOGS: GET /api/v1/domain/companies/:companyId/audit
  // =========================================================================
  app.get<{
    Params: { companyId: string };
    Querystring: { limit?: string };
  }>(
    "/api/v1/domain/companies/:companyId/audit",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const limit = req.query?.limit ? Number(req.query.limit) : 100;

      const auditEvents = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "audit.view",
        },
        async () => domainRepo.listAuditEventsByCompany(companyId, limit)
      );

      return reply.code(200).send(buildEnvelope({ auditEvents }, req, now));
    }
  );
}
