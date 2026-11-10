import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ForbiddenError } from "../../domain";
import { IDatabaseClient, ITransactionManager } from "../../interfaces";

export type SupportedBucketId =
  | "avatars"
  | "document-templates"
  | "documents"
  | "platform_documents"
  | "worker_documents";

export const ALLOWED_BUCKETS: readonly SupportedBucketId[] = Object.freeze([
  "avatars",
  "document-templates",
  "documents",
  "platform_documents",
  "worker_documents",
]);

export interface StoragePolicyConfig {
  readonly maxSizeBytes: number;
  readonly allowedMimeTypes: readonly string[] | null; // null = any
}

export const BUCKET_POLICIES: Record<SupportedBucketId, StoragePolicyConfig> = {
  avatars: {
    maxSizeBytes: 2 * 1024 * 1024, // 2MB
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
  "document-templates": {
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: null,
  },
  documents: {
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    allowedMimeTypes: null,
  },
  platform_documents: {
    maxSizeBytes: 50 * 1024 * 1024,
    allowedMimeTypes: null,
  },
  worker_documents: {
    maxSizeBytes: 20 * 1024 * 1024,
    allowedMimeTypes: null,
  },
};

export class PathTraversalError extends Error {
  readonly code = "PATH_TRAVERSAL_DETECTED";
  constructor(objectName: string) {
    super(`Intento de Path Traversal detectado en el nombre de objeto '${objectName}'.`);
    this.name = "PathTraversalError";
  }
}

export class InvalidBucketError extends Error {
  readonly code = "INVALID_BUCKET";
  constructor(bucketId: string) {
    super(`El bucket '${bucketId}' no es válido o no está registrado.`);
    this.name = "InvalidBucketError";
  }
}

export class FileTooLargeError extends Error {
  readonly code = "FILE_TOO_LARGE";
  constructor(size: number, max: number) {
    super(`El tamaño del archivo (${size} bytes) excede el máximo permitido (${max} bytes).`);
    this.name = "FileTooLargeError";
  }
}

export class InvalidMimeTypeError extends Error {
  readonly code = "INVALID_MIME_TYPE";
  constructor(mime: string) {
    super(`El tipo MIME '${mime}' no está permitido en este bucket.`);
    this.name = "InvalidMimeTypeError";
  }
}

export class StorageObjectNotFoundError extends Error {
  readonly code = "STORAGE_OBJECT_NOT_FOUND";
  constructor(bucketId: string, objectName: string) {
    super(`Objeto '${objectName}' no encontrado en el bucket '${bucketId}'.`);
    this.name = "StorageObjectNotFoundError";
  }
}

export class StorageAccessForbiddenError extends ForbiddenError {
  constructor(
    message: string = "Acceso denegado al objeto de almacenamiento: no pertenece a la empresa o usuario autorizado."
  ) {
    super(message);
  }
}

export interface StorageObjectRecord {
  readonly id: string;
  readonly bucketId: SupportedBucketId;
  readonly objectName: string;
  readonly companyClientId: string | null;
  readonly userId: string | null;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly storagePath: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UploadFileInput {
  readonly bucketId: SupportedBucketId;
  readonly objectName: string;
  readonly contentBuffer: Buffer;
  readonly mimeType: string;
  readonly companyClientId?: string | null;
  readonly userId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

function isTransactionManager(
  client: IDatabaseClient
): client is IDatabaseClient & ITransactionManager {
  return typeof (client as unknown as ITransactionManager).runInTransaction === "function";
}

export class LocalFileStorageService {
  private readonly baseStorageDir: string;

  constructor(
    private readonly db: IDatabaseClient,
    baseStorageDir?: string
  ) {
    this.baseStorageDir = resolve(
      baseStorageDir ?? process.env.STORAGE_BASE_DIR ?? "/var/lib/sitecorp/storage"
    );
    this.ensureDirectoryStructure();
  }

  private async runInTxIfNeeded<T>(work: () => Promise<T>): Promise<T> {
    if (this.db.isInTransaction()) {
      return work();
    }
    if (isTransactionManager(this.db)) {
      return this.db.runInTransaction(async () => work());
    }
    return work();
  }

  private ensureDirectoryStructure(): void {
    if (!existsSync(this.baseStorageDir)) {
      mkdirSync(this.baseStorageDir, { recursive: true });
    }
    for (const bucket of ALLOWED_BUCKETS) {
      const bucketDir = join(this.baseStorageDir, bucket);
      if (!existsSync(bucketDir)) {
        mkdirSync(bucketDir, { recursive: true });
      }
    }
  }

  public sanitizeObjectName(rawName: string): string {
    const trimmed = rawName.trim();
    if (!trimmed || trimmed.includes("..") || trimmed.includes("\\") || trimmed.startsWith("/")) {
      throw new PathTraversalError(rawName);
    }
    const clean = trimmed.replace(/\.\./g, "").replace(/^\/+/, "");
    if (!clean) {
      throw new PathTraversalError(rawName);
    }
    return clean;
  }

  public validatePolicy(bucketId: SupportedBucketId, sizeBytes: number, mimeType: string): void {
    if (!ALLOWED_BUCKETS.includes(bucketId)) {
      throw new InvalidBucketError(bucketId);
    }
    const policy = BUCKET_POLICIES[bucketId];
    if (sizeBytes > policy.maxSizeBytes) {
      throw new FileTooLargeError(sizeBytes, policy.maxSizeBytes);
    }
    if (policy.allowedMimeTypes && !policy.allowedMimeTypes.includes(mimeType.toLowerCase())) {
      throw new InvalidMimeTypeError(mimeType);
    }
  }

  private mapRowToRecord(row: any): StorageObjectRecord {
    return {
      id: row.id,
      bucketId: row.bucket_id,
      objectName: row.object_name,
      companyClientId: row.company_client_id ?? null,
      userId: row.user_id ?? null,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      sha256Checksum: row.sha256_checksum,
      storagePath: row.storage_path,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? null),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async getObjectMetadata(
    bucketId: SupportedBucketId,
    objectName: string
  ): Promise<StorageObjectRecord | null> {
    if (!ALLOWED_BUCKETS.includes(bucketId)) {
      throw new InvalidBucketError(bucketId);
    }
    const cleanObjectName = this.sanitizeObjectName(objectName);
    const executor = this.db.getActiveExecutor();
    const res = await executor.query<any>(
      `SELECT id, bucket_id, object_name, company_client_id, user_id,
              mime_type, size_bytes, sha256_checksum, storage_path, metadata,
              created_at, updated_at
       FROM public.storage_objects
       WHERE bucket_id = $1 AND object_name = $2
       LIMIT 1;`,
      [bucketId, cleanObjectName]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return this.mapRowToRecord(res.rows[0]);
  }

  async listCompanyObjects(
    companyClientId: string,
    bucketId?: SupportedBucketId
  ): Promise<StorageObjectRecord[]> {
    const executor = this.db.getActiveExecutor();
    if (bucketId) {
      if (!ALLOWED_BUCKETS.includes(bucketId)) {
        throw new InvalidBucketError(bucketId);
      }
      const res = await executor.query<any>(
        `SELECT id, bucket_id, object_name, company_client_id, user_id,
                mime_type, size_bytes, sha256_checksum, storage_path, metadata,
                created_at, updated_at
         FROM public.storage_objects
         WHERE company_client_id = $1 AND bucket_id = $2
         ORDER BY created_at DESC;`,
        [companyClientId, bucketId]
      );
      return res.rows.map((r) => this.mapRowToRecord(r));
    }

    const res = await executor.query<any>(
      `SELECT id, bucket_id, object_name, company_client_id, user_id,
              mime_type, size_bytes, sha256_checksum, storage_path, metadata,
              created_at, updated_at
       FROM public.storage_objects
       WHERE company_client_id = $1
       ORDER BY created_at DESC;`,
      [companyClientId]
    );
    return res.rows.map((r) => this.mapRowToRecord(r));
  }

  async uploadFile(input: UploadFileInput): Promise<StorageObjectRecord> {
    if (!ALLOWED_BUCKETS.includes(input.bucketId)) {
      throw new InvalidBucketError(input.bucketId);
    }

    const cleanObjectName = this.sanitizeObjectName(input.objectName);
    this.validatePolicy(input.bucketId, input.contentBuffer.length, input.mimeType);

    const targetCompanyId = input.companyClientId ?? null;
    const targetUserId = input.userId ?? null;

    return this.runInTxIfNeeded(async () => {
      const executor = this.db.getActiveExecutor();

      // 1. Verificar si ya existe un objeto con el mismo (bucket_id, object_name) y bloquear fila
      const existingRes = await executor.query<{
        id: string;
        company_client_id: string | null;
        user_id: string | null;
        storage_path: string;
      }>(
        `SELECT id, company_client_id, user_id, storage_path
         FROM public.storage_objects
         WHERE bucket_id = $1 AND object_name = $2
         FOR UPDATE;`,
        [input.bucketId, cleanObjectName]
      );

      const existing = existingRes.rows[0];
      if (existing) {
        // Prohibir estrictamente sobrescribir objetos pertenecientes a otra empresa
        if ((existing.company_client_id ?? null) !== targetCompanyId) {
          throw new StorageAccessForbiddenError(
            "Operación denegada: ya existe un objeto con este nombre perteneciente a otra empresa."
          );
        }
        // En el bucket 'avatars', prohibir sobrescribir el avatar de otro usuario distinto
        if (
          input.bucketId === "avatars" &&
          existing.user_id !== null &&
          targetUserId !== null &&
          existing.user_id !== targetUserId
        ) {
          throw new StorageAccessForbiddenError(
            "Operación denegada: no puede sobrescribir el avatar perteneciente a otro usuario."
          );
        }
      }

      const sha256Checksum = createHash("sha256").update(input.contentBuffer).digest("hex");
      const uniqueFileId = randomUUID();
      const diskFileName = `${uniqueFileId}_${cleanObjectName.replace(/[\/\s]/g, "_")}`;
      const relativePath = join(input.bucketId, diskFileName);
      const absolutePath = join(this.baseStorageDir, relativePath);

      // Escribir nuevo archivo al disco
      writeFileSync(absolutePath, input.contentBuffer);

      // Si había un archivo previo del mismo propietario, eliminar el fichero antiguo tras persistir el nuevo
      const previousDiskPath = existing?.storage_path
        ? join(this.baseStorageDir, existing.storage_path)
        : null;

      const now = new Date();
      const recordId = existing?.id ?? randomUUID();

      const sql = `
        INSERT INTO public.storage_objects (
          id, bucket_id, object_name, company_client_id, user_id,
          mime_type, size_bytes, sha256_checksum, storage_path, metadata,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (bucket_id, object_name) DO UPDATE SET
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          sha256_checksum = EXCLUDED.sha256_checksum,
          storage_path = EXCLUDED.storage_path,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at;
      `;

      await executor.query(sql, [
        recordId,
        input.bucketId,
        cleanObjectName,
        targetCompanyId,
        targetUserId,
        input.mimeType,
        input.contentBuffer.length,
        sha256Checksum,
        relativePath,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now,
      ]);

      if (previousDiskPath && previousDiskPath !== absolutePath && existsSync(previousDiskPath)) {
        unlinkSync(previousDiskPath);
      }

      return {
        id: recordId,
        bucketId: input.bucketId,
        objectName: cleanObjectName,
        companyClientId: targetCompanyId,
        userId: targetUserId,
        mimeType: input.mimeType,
        sizeBytes: input.contentBuffer.length,
        sha256Checksum,
        storagePath: relativePath,
        metadata: input.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  async downloadFile(
    bucketId: SupportedBucketId,
    objectName: string
  ): Promise<{ record: StorageObjectRecord; contentBuffer: Buffer }> {
    if (!ALLOWED_BUCKETS.includes(bucketId)) {
      throw new InvalidBucketError(bucketId);
    }
    const cleanObjectName = this.sanitizeObjectName(objectName);

    const executor = this.db.getActiveExecutor();
    const sql = `
      SELECT id, bucket_id, object_name, company_client_id, user_id,
             mime_type, size_bytes, sha256_checksum, storage_path, metadata,
             created_at, updated_at
      FROM public.storage_objects
      WHERE bucket_id = $1 AND object_name = $2
      LIMIT 1;
    `;

    const res = await executor.query<any>(sql, [bucketId, cleanObjectName]);
    if (res.rows.length === 0) {
      throw new StorageObjectNotFoundError(bucketId, cleanObjectName);
    }

    const row = res.rows[0];
    const absolutePath = join(this.baseStorageDir, row.storage_path);

    if (!existsSync(absolutePath)) {
      throw new StorageObjectNotFoundError(bucketId, cleanObjectName);
    }

    const contentBuffer = readFileSync(absolutePath);
    // Verificar integridad SHA-256 en lectura
    const calculatedHash = createHash("sha256").update(contentBuffer).digest("hex");
    if (calculatedHash !== row.sha256_checksum) {
      throw new Error(`Fallo de integridad SHA-256 al leer el objeto '${cleanObjectName}'.`);
    }

    const record = this.mapRowToRecord(row);
    return { record, contentBuffer };
  }

  async deleteFile(bucketId: SupportedBucketId, objectName: string): Promise<boolean> {
    if (!ALLOWED_BUCKETS.includes(bucketId)) {
      throw new InvalidBucketError(bucketId);
    }
    const cleanObjectName = this.sanitizeObjectName(objectName);

    const executor = this.db.getActiveExecutor();
    const sql = `
      DELETE FROM public.storage_objects
      WHERE bucket_id = $1 AND object_name = $2
      RETURNING storage_path;
    `;

    const res = await executor.query<any>(sql, [bucketId, cleanObjectName]);
    if (res.rows.length === 0) {
      return false;
    }

    const relativePath = res.rows[0].storage_path;
    const absolutePath = join(this.baseStorageDir, relativePath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
    return true;
  }
}
