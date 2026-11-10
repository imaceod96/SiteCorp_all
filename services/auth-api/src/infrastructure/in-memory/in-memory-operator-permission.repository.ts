import { randomUUID } from "node:crypto";
import { ForbiddenError, UserId } from "../../domain";
import {
  GrantOperatorPermissionInput,
  IOperatorPermissionRepository,
  isValidOperatorPermission,
  OperatorPermission,
  OperatorPermissionRecord,
  RevokeOperatorPermissionInput,
} from "../../interfaces";

export class InMemoryOperatorPermissionRepository
  implements IOperatorPermissionRepository
{
  private records: Map<string, OperatorPermissionRecord> = new Map();

  public createSnapshot(): Map<string, OperatorPermissionRecord> {
    const copy = new Map<string, OperatorPermissionRecord>();
    for (const [k, v] of this.records.entries()) {
      copy.set(k, {
        ...v,
        createdAt: new Date(v.createdAt.getTime()),
        revokedAt: v.revokedAt ? new Date(v.revokedAt.getTime()) : null,
      });
    }
    return copy;
  }

  public restoreSnapshot(state: unknown): void {
    this.records = state as Map<string, OperatorPermissionRecord>;
  }

  async findActivePermissionsByUserId(
    userId: UserId
  ): Promise<readonly OperatorPermission[]> {
    const active: OperatorPermission[] = [];
    for (const record of this.records.values()) {
      if (record.userId === userId && !record.isRevoked) {
        active.push(record.permission);
      }
    }
    return Object.freeze(active);
  }

  async findActiveRecordsByUserId(
    userId: UserId
  ): Promise<readonly OperatorPermissionRecord[]> {
    const active: OperatorPermissionRecord[] = [];
    for (const record of this.records.values()) {
      if (record.userId === userId && !record.isRevoked) {
        active.push({ ...record });
      }
    }
    return Object.freeze(active);
  }

  async grantPermission(
    input: GrantOperatorPermissionInput
  ): Promise<OperatorPermissionRecord> {
    if (!isValidOperatorPermission(input.permission)) {
      throw new ForbiddenError(`Permiso administrativo inválido: '${String(input.permission)}'.`);
    }

    if (input.grantedBy === null && input.allowBootstrapNullGranter !== true) {
      throw new ForbiddenError(
        "Se requiere un operador autorizante ('grantedBy') para otorgar permisos."
      );
    }

    if (input.grantedBy !== null && input.grantedBy === input.userId) {
      throw new ForbiddenError(
        "Prohibida la auto-asignación de permisos administrativos ('grantedBy === userId')."
      );
    }

    // Si ya tiene el permiso activo, devolverlo de forma idempotente
    for (const existing of this.records.values()) {
      if (
        existing.userId === input.userId &&
        existing.permission === input.permission &&
        !existing.isRevoked
      ) {
        return { ...existing };
      }
    }

    const now = input.now ?? new Date();
    const record: OperatorPermissionRecord = Object.freeze({
      id: input.id ?? randomUUID(),
      userId: input.userId,
      permission: input.permission,
      grantedBy: input.grantedBy,
      grantReason: input.grantReason ?? null,
      isRevoked: false,
      createdAt: new Date(now.getTime()),
      revokedAt: null,
      revokedBy: null,
    });

    this.records.set(record.id, record);
    return record;
  }

  async revokePermission(input: RevokeOperatorPermissionInput): Promise<boolean> {
    const now = input.now ?? new Date();
    let revokedAny = false;

    for (const [id, record] of this.records.entries()) {
      if (
        record.userId === input.userId &&
        record.permission === input.permission &&
        !record.isRevoked
      ) {
        this.records.set(
          id,
          Object.freeze({
            ...record,
            isRevoked: true,
            revokedAt: new Date(now.getTime()),
            revokedBy: input.revokedBy,
          })
        );
        revokedAny = true;
      }
    }

    return revokedAny;
  }

  async revokeAllUserPermissions(
    userId: UserId,
    revokedBy: UserId | null,
    now: Date = new Date()
  ): Promise<number> {
    let count = 0;
    for (const [id, record] of this.records.entries()) {
      if (record.userId === userId && !record.isRevoked) {
        this.records.set(
          id,
          Object.freeze({
            ...record,
            isRevoked: true,
            revokedAt: new Date(now.getTime()),
            revokedBy,
          })
        );
        count++;
      }
    }
    return count;
  }

  async countActiveOperatorPermissions(): Promise<number> {
    let count = 0;
    for (const record of this.records.values()) {
      if (!record.isRevoked) {
        count++;
      }
    }
    return count;
  }
}
