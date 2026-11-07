import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  LocalFileStorageService,
  SupportedBucketId,
  PathTraversalError,
  InvalidBucketError,
  FileTooLargeError,
  InvalidMimeTypeError,
  StorageObjectNotFoundError,
} from "../../../infrastructure/storage/local-file-storage.service";
import { AuthHttpConfig } from "../../../infrastructure/config/http-config";
import { createAuthGuardHook } from "../plugins/auth-guard";
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

export function registerStorageRoutes(
  app: FastifyInstance,
  deps: StorageRoutesDependencies
): void {
  const {
    tokenService,
    userRepo,
    sessionRepo,
    storageService,
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
      const { bucketId, objectName, contentBase64, mimeType, companyClientId } = req.body;

      try {
        const contentBuffer = Buffer.from(contentBase64, "base64");
        const record = await storageService.uploadFile({
          bucketId,
          objectName,
          contentBuffer,
          mimeType,
          companyClientId: companyClientId ?? null,
          userId: req.authContext?.user.id ?? null,
        });

        return reply.code(201).send(buildEnvelope({ object: record }, req, now));
      } catch (err: any) {
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
  // 2. GET /api/v1/storage/objects/:bucketId/*
  // =========================================================================
  app.get<{
    Params: { bucketId: SupportedBucketId; "*": string };
  }>(
    "/api/v1/storage/objects/:bucketId/*",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const bucketId = req.params.bucketId;
      const objectName = req.params["*"];

      try {
        const { record, contentBuffer } = await storageService.downloadFile(bucketId, objectName);
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
  // 3. DELETE /api/v1/storage/objects/:bucketId/*
  // =========================================================================
  app.delete<{
    Params: { bucketId: SupportedBucketId; "*": string };
  }>(
    "/api/v1/storage/objects/:bucketId/*",
    { preHandler: [authGuard] },
    async (req, reply) => {
      const now = nowProvider();
      const bucketId = req.params.bucketId;
      const objectName = req.params["*"];

      try {
        const deleted = await storageService.deleteFile(bucketId, objectName);
        if (!deleted) {
          return reply.code(404).send({
            statusCode: 404,
            error: "Not Found",
            code: "STORAGE_OBJECT_NOT_FOUND",
            message: `Objeto '${objectName}' no encontrado en '${bucketId}'.`,
          });
        }
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
