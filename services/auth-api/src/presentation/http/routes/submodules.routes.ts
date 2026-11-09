import type { FastifyInstance, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../../../domain";
import {
  DomainResourceNotFoundError,
  PostgresDomainRepository,
} from "../../../infrastructure/postgres/postgres-domain.repository";
import { PostgresSubmodulesRepository } from "../../../infrastructure/postgres/postgres-submodules.repository";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { createAuthGuardHook } from "../plugins/auth-guard";
import {
  IAuthorizationPolicyService,
  IOperatorPrincipalResolver,
  ISessionRepository,
  ITokenService,
  ITransactionalEmailService,
  IUserRepository,
} from "../../../interfaces";
import { IRateLimiter } from "../concurrency/rate-limiter";

export interface SubmodulesRoutesDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly domainRepo: PostgresDomainRepository;
  readonly submodulesRepo: PostgresSubmodulesRepository;
  readonly rateLimiter: IRateLimiter;
  readonly emailService?: ITransactionalEmailService;
  readonly authPolicy?: IAuthorizationPolicyService;
  readonly operatorPrincipalResolver?: IOperatorPrincipalResolver;
  readonly nowProvider?: () => Date;
}

const UUID_V4_LIKE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_V4_LIKE_REGEX.test(value.trim())) {
    const err = new Error(
      `El parámetro '${fieldName}' debe ser un UUID válido.`
    ) as Error & {
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
    throw new UnauthorizedError(
      "Contexto de identidad autenticada no disponible."
    );
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

export function registerSubmodulesRoutes(
  app: FastifyInstance,
  deps: SubmodulesRoutesDependencies
): void {
  const {
    tokenService,
    userRepo,
    sessionRepo,
    domainRepo,
    submodulesRepo,
    emailService,
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
  // 1. CUADROS Y RESERVAS
  // =========================================================================

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      targetPositionId: string;
      reserveCategory?: "TITULAR" | "RESERVA_INMEDIATA" | "RESERVA_PERSPECTIVA" | "CANTERA";
      readinessLevel?: "LISTO" | "EN_PREPARACION" | "INICIAL";
      designatedDate?: string;
      expirationDate?: string | null;
      notes?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/cadre-reserves",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const targetPositionId = assertValidUuid(
        req.body?.targetPositionId,
        "targetPositionId"
      );

      const reserve = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.manage",
        },
        async () => {
          const created = await submodulesRepo.createCadreReserve({
            companyClientId: companyId,
            workerId,
            targetPositionId,
            reserveCategory: req.body.reserveCategory,
            readinessLevel: req.body.readinessLevel,
            designatedDate: req.body.designatedDate,
            expirationDate: req.body.expirationDate,
            notes: req.body.notes,
            createdBy: userId,
          });
          await domainRepo.logAuditEvent({
            companyClientId: companyId,
            userId,
            action: "CREATE_CADRE_RESERVE",
            entityType: "cadre_reserve",
            entityId: created.id,
            module: "cadres",
            newState: created as unknown as Record<string, unknown>,
            ipAddress: req.ip,
          });
          return created;
        }
      );

      return reply.code(201).send(buildEnvelope({ reserve }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/cadre-reserves",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const reserves = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.view",
        },
        async () => submodulesRepo.listCadreReserves(companyId)
      );

      return reply.code(200).send(buildEnvelope({ reserves }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      positionId?: string | null;
      evaluationPeriod: string;
      evaluationDate?: string;
      overallRating: "SUPERIOR" | "SATISFACTORIO" | "REGULAR" | "DEFICIENTE";
      score?: number | null;
      strengths?: string | null;
      recommendations?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/cadre-evaluations",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const positionId = req.body?.positionId
        ? assertValidUuid(req.body.positionId, "positionId")
        : null;

      const evaluation = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.manage",
        },
        async () =>
          submodulesRepo.createCadreEvaluation({
            companyClientId: companyId,
            workerId,
            positionId,
            evaluationPeriod: String(req.body?.evaluationPeriod ?? "2026"),
            evaluationDate: req.body?.evaluationDate,
            overallRating: req.body?.overallRating ?? "SATISFACTORIO",
            score: req.body?.score,
            strengths: req.body?.strengths,
            recommendations: req.body?.recommendations,
            evaluatorId: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ evaluation }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/cadre-evaluations",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const evaluations = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.view",
        },
        async () => submodulesRepo.listCadreEvaluations(companyId)
      );

      return reply.code(200).send(buildEnvelope({ evaluations }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      fromPositionId?: string | null;
      toPositionId?: string | null;
      movementKind: "PROMOCION" | "ROTACION" | "DEMOCION" | "LIBERACION" | "DESIGNACION_DIRECTA";
      effectiveDate?: string;
      resolutionNumber?: string | null;
      notes?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/cadre-movements",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const fromPositionId = req.body?.fromPositionId
        ? assertValidUuid(req.body.fromPositionId, "fromPositionId")
        : null;
      const toPositionId = req.body?.toPositionId
        ? assertValidUuid(req.body.toPositionId, "toPositionId")
        : null;

      const movement = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.manage",
        },
        async () =>
          submodulesRepo.createCadreMovement({
            companyClientId: companyId,
            workerId,
            fromPositionId,
            toPositionId,
            movementKind: req.body?.movementKind ?? "PROMOCION",
            effectiveDate: req.body?.effectiveDate,
            resolutionNumber: req.body?.resolutionNumber,
            notes: req.body?.notes,
            createdBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ movement }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/cadre-movements",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const movements = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "positions.view",
        },
        async () => submodulesRepo.listCadreMovements(companyId)
      );

      return reply.code(200).send(buildEnvelope({ movements }, req, now));
    }
  );

  // =========================================================================
  // 2. PLANTILLAS DOCUMENTALES AVANZADAS Y GENERACIÓN
  // =========================================================================

  app.post<{
    Params: { companyId: string };
    Body: {
      code: string;
      name: string;
      category?: string;
      contentHtml?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/document-templates",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const created = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "documents.manage",
        },
        async () =>
          submodulesRepo.createDocumentTemplate({
            companyClientId: companyId,
            code: String(req.body?.code ?? ""),
            name: String(req.body?.name ?? ""),
            category: req.body?.category,
            contentHtml: req.body?.contentHtml,
            createdBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope(created, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/document-templates",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const templates = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "documents.view",
        },
        async () => submodulesRepo.listDocumentTemplates(companyId)
      );

      return reply.code(200).send(buildEnvelope({ templates }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string; templateId: string };
    Body: {
      variableKey: string;
      label: string;
      dataType?: "TEXT" | "NUMBER" | "DATE" | "CURRENCY" | "BOOLEAN";
      isRequired?: boolean;
      defaultValue?: string | null;
      sourcePath?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/document-templates/:templateId/variables",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const templateId = assertValidUuid(req.params.templateId, "templateId");

      const variable = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "documents.manage",
        },
        async () =>
          submodulesRepo.createTemplateVariable({
            companyClientId: companyId,
            templateId,
            variableKey: String(req.body?.variableKey ?? ""),
            label: String(req.body?.label ?? ""),
            dataType: req.body?.dataType,
            isRequired: req.body?.isRequired,
            defaultValue: req.body?.defaultValue,
            sourcePath: req.body?.sourcePath,
          })
      );

      return reply.code(201).send(buildEnvelope({ variable }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string; templateId: string };
    Body: {
      sectionCode: string;
      title: string;
      contentTemplate: string;
      sortOrder?: number;
      isOptional?: boolean;
    };
  }>(
    "/api/v1/domain/companies/:companyId/document-templates/:templateId/sections",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const templateId = assertValidUuid(req.params.templateId, "templateId");

      const section = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "documents.manage",
        },
        async () =>
          submodulesRepo.createTemplateSection({
            companyClientId: companyId,
            templateId,
            sectionCode: String(req.body?.sectionCode ?? ""),
            title: String(req.body?.title ?? ""),
            contentTemplate: String(req.body?.contentTemplate ?? ""),
            sortOrder: req.body?.sortOrder,
            isOptional: req.body?.isOptional,
          })
      );

      return reply.code(201).send(buildEnvelope({ section }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      templateId: string;
      workerId?: string | null;
      contractId?: string | null;
      documentTitle: string;
      variables: Record<string, string | number | boolean | null>;
    };
  }>(
    "/api/v1/domain/companies/:companyId/generated-documents",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const templateId = assertValidUuid(req.body?.templateId, "templateId");
      const workerId = req.body?.workerId
        ? assertValidUuid(req.body.workerId, "workerId")
        : null;

      const generatedDocument = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "documents.manage",
        },
        async () =>
          submodulesRepo.generateDocumentFromTemplate({
            companyClientId: companyId,
            templateId,
            workerId,
            contractId: req.body?.contractId ?? null,
            documentTitle: String(req.body?.documentTitle ?? "Documento Generado"),
            variables: req.body?.variables ?? {},
            createdBy: userId,
          })
      );

      return reply
        .code(201)
        .send(buildEnvelope({ generatedDocument }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/generated-documents",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const generatedDocuments = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "documents.view",
        },
        async () => submodulesRepo.listGeneratedDocuments(companyId)
      );

      return reply
        .code(200)
        .send(buildEnvelope({ generatedDocuments }, req, now));
    }
  );

  // =========================================================================
  // 3. INVITACIONES Y NOTIFICACIONES (con correo transaccional SMTP)
  // =========================================================================

  app.post<{
    Params: { companyId: string };
    Body: {
      invitedEmail: string;
      roleCode?: string;
      expiresInHours?: number;
    };
  }>(
    "/api/v1/domain/companies/:companyId/invitations",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const result = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "companies.manage",
        },
        async () => {
          const company = await domainRepo.getCompanyClientById(companyId);
          if (!company) {
            throw new DomainResourceNotFoundError("Empresa no encontrada.");
          }

          const created = await submodulesRepo.createClientInvitation({
            companyClientId: companyId,
            invitedEmail: String(req.body?.invitedEmail ?? ""),
            roleCode: req.body?.roleCode,
            expiresInHours: req.body?.expiresInHours,
            invitedBy: userId,
          });

          let emailDelivery = null;
          if (emailService) {
            const receipt = await emailService.sendCompanyInvitationEmail({
              toEmail: created.invitation.invitedEmail,
              companyName: company.name,
              roleCode: created.invitation.roleCode,
              rawInvitationToken: created.rawInvitationToken,
              expiresAt: new Date(created.invitation.expiresAt),
            });
            emailDelivery = {
              messageId: receipt.messageId,
              accepted: receipt.accepted,
              transportMode: receipt.transportMode,
            };
          }

          return {
            invitation: created.invitation,
            emailDelivery,
          };
        }
      );

      return reply.code(201).send(buildEnvelope(result, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/invitations",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const invitations = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "companies.view",
        },
        async () => submodulesRepo.listClientInvitations(companyId)
      );

      return reply.code(200).send(buildEnvelope({ invitations }, req, now));
    }
  );

  app.get(
    "/api/v1/domain/notifications",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const notifications = await submodulesRepo.listUserNotifications(userId);
      return reply.code(200).send(buildEnvelope({ notifications }, req, now));
    }
  );

  // =========================================================================
  // 4. NÓMINA Y PRENÓMINA AVANZADA
  // =========================================================================

  app.post<{
    Params: { companyId: string };
    Body: {
      organizationEntityId?: string | null;
      periodYear: number;
      periodMonth: number;
    };
  }>(
    "/api/v1/domain/companies/:companyId/prenomina-periods",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const organizationEntityId = req.body?.organizationEntityId
        ? assertValidUuid(req.body.organizationEntityId, "organizationEntityId")
        : null;

      const period = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.manage",
        },
        async () =>
          submodulesRepo.createPrenominaPeriod({
            companyClientId: companyId,
            organizationEntityId,
            periodYear: Number(req.body?.periodYear),
            periodMonth: Number(req.body?.periodMonth),
          })
      );

      return reply.code(201).send(buildEnvelope({ period }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/prenomina-periods",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const periods = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.view",
        },
        async () => submodulesRepo.listPrenominaPeriods(companyId)
      );

      return reply.code(200).send(buildEnvelope({ periods }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string; periodId: string };
    Body: {
      workerId: string;
      workedDays: number;
      workedHours?: number;
      overtimeHours?: number;
      baseAmount: number;
      bonusAmount?: number;
      deductionAmount?: number;
      notes?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/prenomina-periods/:periodId/entries",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const periodId = assertValidUuid(req.params.periodId, "periodId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");

      const entry = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.manage",
        },
        async () =>
          submodulesRepo.upsertPrenominaWorkerEntry({
            companyClientId: companyId,
            prenominaPeriodId: periodId,
            workerId,
            workedDays: Number(req.body?.workedDays ?? 24),
            workedHours: req.body?.workedHours,
            overtimeHours: req.body?.overtimeHours,
            baseAmount: Number(req.body?.baseAmount ?? 0),
            bonusAmount: req.body?.bonusAmount,
            deductionAmount: req.body?.deductionAmount,
            notes: req.body?.notes,
          })
      );

      return reply.code(201).send(buildEnvelope({ entry }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      prenominaPeriodId?: string | null;
      bonusType?: "ANTIGUEDAD" | "MAESTRIA_DOCTORADO" | "RESULTADOS" | "CONDICIONES_LABORALES" | "ESTIMULO" | "OTRO";
      concept: string;
      amount: number;
      effectiveDate?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/salary-bonuses",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const prenominaPeriodId = req.body?.prenominaPeriodId
        ? assertValidUuid(req.body.prenominaPeriodId, "prenominaPeriodId")
        : null;

      const bonus = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.manage",
        },
        async () =>
          submodulesRepo.createSalaryBonus({
            companyClientId: companyId,
            workerId,
            prenominaPeriodId,
            bonusType: req.body?.bonusType,
            concept: String(req.body?.concept ?? ""),
            amount: Number(req.body?.amount ?? 0),
            effectiveDate: req.body?.effectiveDate,
            approvedBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ bonus }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      prenominaPeriodId?: string | null;
      deductionType?: "SEGURIDAD_SOCIAL" | "IMPUESTO_INGRESOS" | "AUSENCIA" | "RETENCION_JUDICIAL" | "ANTICIPO" | "OTRO";
      concept: string;
      amount: number;
      effectiveDate?: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/salary-deductions",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const prenominaPeriodId = req.body?.prenominaPeriodId
        ? assertValidUuid(req.body.prenominaPeriodId, "prenominaPeriodId")
        : null;

      const deduction = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.manage",
        },
        async () =>
          submodulesRepo.createSalaryDeduction({
            companyClientId: companyId,
            workerId,
            prenominaPeriodId,
            deductionType: req.body?.deductionType,
            concept: String(req.body?.concept ?? ""),
            amount: Number(req.body?.amount ?? 0),
            effectiveDate: req.body?.effectiveDate,
            createdBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ deduction }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string; periodId: string };
    Body: { notes?: string | null };
  }>(
    "/api/v1/domain/companies/:companyId/prenomina-periods/:periodId/close",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const periodId = assertValidUuid(req.params.periodId, "periodId");

      const closure = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "contracts.manage",
        },
        async () =>
          submodulesRepo.closePrenominaPeriod({
            companyClientId: companyId,
            prenominaPeriodId: periodId,
            closedBy: userId,
            notes: req.body?.notes,
          })
      );

      return reply.code(200).send(buildEnvelope({ closure }, req, now));
    }
  );

  // =========================================================================
  // 5. CAPACITACIÓN Y SST
  // =========================================================================

  app.post<{
    Params: { companyId: string };
    Body: {
      code: string;
      title: string;
      provider?: string | null;
      modality?: "PRESENCIAL" | "VIRTUAL" | "MIXTA";
      durationHours: number;
    };
  }>(
    "/api/v1/domain/companies/:companyId/training-courses",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const course = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () =>
          submodulesRepo.createTrainingCourse({
            companyClientId: companyId,
            code: String(req.body?.code ?? ""),
            title: String(req.body?.title ?? ""),
            provider: req.body?.provider,
            modality: req.body?.modality,
            durationHours: Number(req.body?.durationHours ?? 16),
          })
      );

      return reply.code(201).send(buildEnvelope({ course }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      courseId: string;
      startDate: string;
      endDate?: string | null;
      status?: "MATRICULADO" | "EN_CURSO" | "APROBADO" | "DESAPROBADO" | "BAJA";
      grade?: number | null;
      certificateNumber?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/worker-trainings",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const courseId = assertValidUuid(req.body?.courseId, "courseId");

      const training = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () =>
          submodulesRepo.recordWorkerTraining({
            companyClientId: companyId,
            workerId,
            courseId,
            startDate: String(req.body?.startDate ?? "2026-01-15"),
            endDate: req.body?.endDate,
            status: req.body?.status,
            grade: req.body?.grade,
            certificateNumber: req.body?.certificateNumber,
          })
      );

      return reply.code(201).send(buildEnvelope({ training }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/worker-trainings",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const trainings = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.view",
        },
        async () => submodulesRepo.listWorkerTrainings(companyId)
      );

      return reply.code(200).send(buildEnvelope({ trainings }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      organizationEntityId?: string | null;
      accidentDate?: string;
      severity?: "LEVE" | "MENOS_GRAVE" | "GRAVE" | "MORTAL";
      daysLost?: number;
      description: string;
      correctiveActions?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/work-accidents",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const organizationEntityId = req.body?.organizationEntityId
        ? assertValidUuid(req.body.organizationEntityId, "organizationEntityId")
        : null;

      const accident = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () =>
          submodulesRepo.recordWorkAccident({
            companyClientId: companyId,
            workerId,
            organizationEntityId,
            accidentDate: req.body?.accidentDate,
            severity: req.body?.severity,
            daysLost: req.body?.daysLost,
            description: String(req.body?.description ?? ""),
            correctiveActions: req.body?.correctiveActions,
            reportedBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ accident }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      equipmentName: string;
      quantity?: number;
      deliveryDate?: string;
      renewalDate?: string | null;
      conditionStatus?: "NUEVO" | "REUSO_CERTIFICADO" | "REPOSICION";
      notes?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/ppe-deliveries",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");

      const ppeDelivery = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () =>
          submodulesRepo.recordPpeDelivery({
            companyClientId: companyId,
            workerId,
            equipmentName: String(req.body?.equipmentName ?? ""),
            quantity: req.body?.quantity,
            deliveryDate: req.body?.deliveryDate,
            renewalDate: req.body?.renewalDate,
            conditionStatus: req.body?.conditionStatus,
            notes: req.body?.notes,
            deliveredBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ ppeDelivery }, req, now));
    }
  );

  // =========================================================================
  // 6. COMISIONES DE EVALUACIÓN, DISCIPLINA Y PLANES DE ENTIDAD
  // =========================================================================

  app.post<{
    Params: { companyId: string };
    Body: {
      organizationEntityId?: string | null;
      name: string;
      resolutionNumber: string;
      constitutedDate?: string;
      expirationDate?: string | null;
      members?: ReadonlyArray<{ workerId: string; role: string }>;
    };
  }>(
    "/api/v1/domain/companies/:companyId/evaluation-committees",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const organizationEntityId = req.body?.organizationEntityId
        ? assertValidUuid(req.body.organizationEntityId, "organizationEntityId")
        : null;

      const committee = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.manage",
        },
        async () =>
          submodulesRepo.createEvaluationCommittee({
            companyClientId: companyId,
            organizationEntityId,
            name: String(req.body?.name ?? ""),
            resolutionNumber: String(req.body?.resolutionNumber ?? ""),
            constitutedDate: req.body?.constitutedDate,
            expirationDate: req.body?.expirationDate,
            members: req.body?.members,
          })
      );

      return reply.code(201).send(buildEnvelope({ committee }, req, now));
    }
  );

  app.get<{ Params: { companyId: string } }>(
    "/api/v1/domain/companies/:companyId/evaluation-committees",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");

      const committees = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.view",
        },
        async () => submodulesRepo.listEvaluationCommittees(companyId)
      );

      return reply.code(200).send(buildEnvelope({ committees }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      workerId: string;
      organizationEntityId?: string | null;
      measureType:
        | "AMONESTACION_PUBLICA"
        | "MULTA"
        | "SUSPENSION_VINCULO"
        | "TRASLADO_PROVISIONAL"
        | "TRASLADO_DEFINITIVO"
        | "SEPARACION_DEFINITIVA";
      resolutionNumber: string;
      imposedDate?: string;
      effectiveStartDate?: string;
      effectiveEndDate?: string | null;
      reason: string;
    };
  }>(
    "/api/v1/domain/companies/:companyId/disciplinary-measures",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const workerId = assertValidUuid(req.body?.workerId, "workerId");
      const organizationEntityId = req.body?.organizationEntityId
        ? assertValidUuid(req.body.organizationEntityId, "organizationEntityId")
        : null;

      const measure = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "workers.manage",
        },
        async () =>
          submodulesRepo.recordDisciplinaryMeasure({
            companyClientId: companyId,
            workerId,
            organizationEntityId,
            measureType: req.body?.measureType ?? "AMONESTACION_PUBLICA",
            resolutionNumber: String(req.body?.resolutionNumber ?? ""),
            imposedDate: req.body?.imposedDate,
            effectiveStartDate: req.body?.effectiveStartDate,
            effectiveEndDate: req.body?.effectiveEndDate,
            reason: String(req.body?.reason ?? ""),
            createdBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ measure }, req, now));
    }
  );

  app.post<{
    Params: { companyId: string };
    Body: {
      organizationEntityId?: string | null;
      planType: string;
      year: number;
      title?: string | null;
      notes?: string | null;
    };
  }>(
    "/api/v1/domain/companies/:companyId/entity-plans",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyId = assertValidUuid(req.params.companyId, "companyId");
      const organizationEntityId = req.body?.organizationEntityId
        ? assertValidUuid(req.body.organizationEntityId, "organizationEntityId")
        : null;

      const plan = await domainRepo.runAuthorizedCompanyOperation(
        {
          userId,
          companyClientId: companyId,
          requiredPermission: "entities.manage",
        },
        async () =>
          submodulesRepo.saveEntityPlan({
            companyClientId: companyId,
            organizationEntityId,
            planType: String(req.body?.planType ?? "ANUAL"),
            year: Number(req.body?.year ?? 2026),
            title: req.body?.title,
            notes: req.body?.notes,
            createdBy: userId,
          })
      );

      return reply.code(201).send(buildEnvelope({ plan }, req, now));
    }
  );

  // =========================================================================
  // 7. PASARELA AUTÓNOMA DE RPCs, EDGE FUNCTIONS Y TABLAS PARA SELF-HOSTED
  // =========================================================================

  app.post<{
    Params: { rpcName: string };
    Body: Record<string, unknown>;
  }>(
    "/api/v1/domain/rpc/:rpcName",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const result = await submodulesRepo.executeAutonomousRpc({
        userId,
        rpcName: req.params.rpcName,
        args: (req.body as Record<string, unknown>) ?? {},
      });
      return reply.code(200).send(buildEnvelope({ result }, req, now));
    }
  );

  app.post<{
    Params: { functionName: string };
    Body: Record<string, unknown>;
  }>(
    "/api/v1/domain/functions/:functionName",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const result = await submodulesRepo.executeAutonomousEdgeFunction({
        userId,
        functionName: req.params.functionName,
        body: (req.body as Record<string, unknown>) ?? {},
      });
      return reply.code(200).send(buildEnvelope({ result }, req, now));
    }
  );

  app.post<{
    Params: { tableName: string };
    Body: {
      operation?: "select" | "insert" | "update" | "delete";
      companyClientId: string;
      filters?: Record<string, string | number | boolean>;
      payload?: Record<string, unknown>;
    };
  }>(
    "/api/v1/domain/rest/:tableName",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const companyClientId = assertValidUuid(
        req.body?.companyClientId,
        "companyClientId"
      );
      const rows = await submodulesRepo.executeAutonomousTableOperation({
        userId,
        tableName: req.params.tableName,
        operation: req.body?.operation ?? "select",
        companyClientId,
        filters: req.body?.filters,
        payload: req.body?.payload,
      });
      return reply.code(200).send(buildEnvelope({ rows }, req, now));
    }
  );
}
