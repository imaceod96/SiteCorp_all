import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  LocalFileStorageService,
  SupportedBucketId,
  PathTraversalError,
  InvalidBucketError,
  FileTooLargeError,
  InvalidMimeTypeError,
  StorageObjectNotFoundError,
  StorageAccessForbiddenError,
} from "../../../infrastructure/storage/local-file-storage.service";
import { PostgresDomainRepository } from "../../../infrastructure/postgres/postgres-domain.repository";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { createAuthGuardHook } from "../plugins/auth-guard";
import { ForbiddenError, UnauthorizedError } from "../../../domain";
import {
  IAuthorizationPolicyService,
  IOperatorPrincipalResolver,
  ISessionRepository,
  ITokenService,
  IUserRepository,
} from "../../../interfaces";

export interface StorageRoutesDependencies {
  readonly httpConfig: AuthHttpConfig;
  readonly tokenService: ITokenService;
  readonly userRepo: IUserRepository;
  readonly sessionRepo: ISessionRepository;
  readonly storageService: LocalFileStorageService;
  readonly domainRepo?: PostgresDomainRepository;
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

function getAuthenticatedUserId(req: FastifyRequest): string {
  const userId = req.authContext?.user.id;
  if (!userId) {
    throw new UnauthorizedError("Autenticación requerida para acceder a Storage.");
  }
  return userId;
}

function ensureDomainRepository(
  domainRepo: PostgresDomainRepository | undefined
): PostgresDomainRepository {
  if (!domainRepo) {
    throw new ForbiddenError(
      "Repositorio de autorización multiempresa no disponible para validar permisos de Storage."
    );
  }
  return domainRepo;
}

export function registerStorageRoutes(
  app: FastifyInstance,
  deps: StorageRoutesDependencies
): void {
  const {
    tokenService,
    userRepo,
    sessionRepo,
    storageService,
    domainRepo,
    nowProvider: userNowProvider,
  } = deps;
  const nowProvider = userNowProvider ?? (() => new Date());

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
  // 1. POST /api/v1/storage/upload
  //    Validación estricta de membresía de empresa y permiso documents.manage
  // =========================================================================
  app.post<{
    Body: {
      bucketId: SupportedBucketId;
      objectName: string;
      contentBase64: string;
      mimeType: string;
      companyClientId?: string;
    };
  }>(
    "/api/v1/storage/upload",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const repo = ensureDomainRepository(domainRepo);
      const { bucketId, objectName, contentBase64, mimeType, companyClientId } = req.body;

      try {
        // Autorización por bucket, empresa y recurso
        if (bucketId === "platform_documents") {
          await repo.requirePlatformAdmin(userId);
        } else if (companyClientId) {
          await repo.requireCompanyPermission(userId, companyClientId, "documents.manage");
        } else if (bucketId === "avatars") {
          // Avatar personal sin companyClientId: solo puede subirse bajo su propio userId
          // La protección contra colisión/sobreescritura de otro usuario se valida en uploadFile
        } else {
          // documents, worker_documents, document-templates sin companyClientId requieren admin de plataforma
          await repo.requirePlatformAdmin(userId);
        }

        const contentBuffer = Buffer.from(contentBase64, "base64");
        const record = await storageService.uploadFile({
          bucketId,
          objectName,
          contentBuffer,
          mimeType,
          companyClientId: companyClientId ?? null,
          userId,
        });

        await repo.logAuditEvent({
          companyClientId: companyClientId ?? undefined,
          userId,
          action: "STORAGE_OBJECT_UPLOADED",
          entityType: "storage_objects",
          entityId: record.id,
          module: "storage",
          newState: {
            bucketId: record.bucketId,
            objectName: record.objectName,
            sizeBytes: record.sizeBytes,
            sha256Checksum: record.sha256Checksum,
          },
          ipAddress: req.ip,
        });

        return reply.code(201).send(buildEnvelope({ object: record }, req, now));
      } catch (err: any) {
        if (err instanceof StorageAccessForbiddenError) {
          return reply.code(403).send({
            statusCode: 403,
            error: "Forbidden",
            code: err.code,
            message: err.message,
          });
        }
        if (
          err instanceof PathTraversalError ||
          err instanceof InvalidBucketError ||
          err instanceof FileTooLargeError ||
          err instanceof InvalidMimeTypeError
        ) {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            code: err.code ?? "STORAGE_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }
  );

  // =========================================================================
  // 2. GET /api/v1/storage/companies/:companyId/objects
  //    Listado aislado por empresa con permiso documents.view
  // =========================================================================
  app.get<{
    Params: { companyId: string };
    Querystring: { bucketId?: SupportedBucketId };
  }>(
    "/api/v1/storage/companies/:companyId/objects",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const repo = ensureDomainRepository(domainRepo);
      const { companyId } = req.params;

      await repo.requireCompanyPermission(userId, companyId, "documents.view");
      const objects = await storageService.listCompanyObjects(
        companyId,
        req.query.bucketId
      );

      return reply.code(200).send(buildEnvelope({ objects }, req, now));
    }
  );

  // =========================================================================
  // 3. GET /api/v1/storage/objects/:bucketId/*
  //    Descarga protegida por pertenencia a la empresa propietaria del archivo
  // =========================================================================
  app.get<{
    Params: { bucketId: SupportedBucketId; "*": string };
  }>(
    "/api/v1/storage/objects/:bucketId/*",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const userId = getAuthenticatedUserId(req);
      const repo = ensureDomainRepository(domainRepo);
      const bucketId = req.params.bucketId;
      const objectName = req.params["*"];

      try {
        const metadata = await storageService.getObjectMetadata(bucketId, objectName);
        if (!metadata) {
          return reply.code(404).send({
            statusCode: 404,
            error: "Not Found",
            code: "STORAGE_OBJECT_NOT_FOUND",
            message: `Objeto '${objectName}' no encontrado en el bucket '${bucketId}'.`,
          });
        }

        // Validación estricta de autorización sobre el recurso persistido
        if (bucketId === "platform_documents") {
          await repo.requirePlatformAdmin(userId);
        } else if (metadata.companyClientId) {
          await repo.requireCompanyPermission(
            userId,
            metadata.companyClientId,
            "documents.view"
          );
        } else if (bucketId === "avatars") {
          const isAdmin = await repo.isUserPlatformAdmin(userId);
          if (!isAdmin && metadata.userId !== userId) {
            throw new ForbiddenError(
              "No tiene permisos para acceder al avatar de otro usuario."
            );
          }
        } else {
          await repo.requirePlatformAdmin(userId);
        }

        const { record, contentBuffer } = await storageService.downloadFile(
          bucketId,
          objectName
        );
        reply.header("Content-Type", record.mimeType);
        reply.header("Content-Length", record.sizeBytes.toString());
        reply.header("X-Checksum-SHA256", record.sha256Checksum);
        return reply.code(200).send(contentBuffer);
      } catch (err: any) {
        if (err instanceof StorageObjectNotFoundError) {
          return reply.code(404).send({
            statusCode: 404,
            error: "Not Found",
            code: err.code,
            message: err.message,
          });
        }
        if (err instanceof PathTraversalError || err instanceof InvalidBucketError) {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    }
  );

  // =========================================================================
  // 4. DELETE /api/v1/storage/objects/:bucketId/*
  //    Eliminación protegida por pertenencia a la empresa y documents.manage
  // =========================================================================
  app.delete<{
    Params: { bucketId: SupportedBucketId; "*": string };
  }>(
    "/api/v1/storage/objects/:bucketId/*",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const userId = getAuthenticatedUserId(req);
      const repo = ensureDomainRepository(domainRepo);
      const bucketId = req.params.bucketId;
      const objectName = req.params["*"];

      try {
        const metadata = await storageService.getObjectMetadata(bucketId, objectName);
        if (!metadata) {
          return reply.code(404).send({
            statusCode: 404,
            error: "Not Found",
            code: "STORAGE_OBJECT_NOT_FOUND",
            message: `Objeto '${objectName}' no encontrado en '${bucketId}'.`,
          });
        }

        if (bucketId === "platform_documents") {
          await repo.requirePlatformAdmin(userId);
        } else if (metadata.companyClientId) {
          await repo.requireCompanyPermission(
            userId,
            metadata.companyClientId,
            "documents.manage"
          );
        } else if (bucketId === "avatars") {
          const isAdmin = await repo.isUserPlatformAdmin(userId);
          if (!isAdmin && metadata.userId !== userId) {
            throw new ForbiddenError(
              "No tiene permisos para eliminar el avatar de otro usuario."
            );
          }
        } else {
          await repo.requirePlatformAdmin(userId);
        }

        const deleted = await storageService.deleteFile(bucketId, objectName);
        if (!deleted) {
          return reply.code(404).send({
            statusCode: 404,
            error: "Not Found",
            code: "STORAGE_OBJECT_NOT_FOUND",
            message: `Objeto '${objectName}' no encontrado en '${bucketId}'.`,
          });
        }

        await repo.logAuditEvent({
          companyClientId: metadata.companyClientId ?? undefined,
          userId,
          action: "STORAGE_OBJECT_DELETED",
          entityType: "storage_objects",
          entityId: metadata.id,
          module: "storage",
          previousState: {
            bucketId: metadata.bucketId,
            objectName: metadata.objectName,
          },
          ipAddress: req.ip,
        });

        return reply.code(200).send(buildEnvelope({ deleted: true }, req, now));
      } catch (err: any) {
        if (err instanceof PathTraversalError || err instanceof InvalidBucketError) {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    }
  );
}
