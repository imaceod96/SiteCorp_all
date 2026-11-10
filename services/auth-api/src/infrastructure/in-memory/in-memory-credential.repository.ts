import { UserId } from "../../domain";
import { ICredentialRepository, UserCredential } from "../../interfaces";
import { SnapshotableRepository } from "./in-memory-transaction.manager";

export class InMemoryCredentialRepository
  implements ICredentialRepository, SnapshotableRepository
{
  private readonly credentialsByUserId = new Map<string, UserCredential>();

  private clone(cred: UserCredential): UserCredential {
    return {
      id: cred.id,
      userId: cred.userId,
      algorithm: cred.algorithm,
      passwordHash: cred.passwordHash,
      version: cred.version,
      createdAt: new Date(cred.createdAt.getTime()),
    };
  }

  async save(credential: UserCredential): Promise<void> {
    this.credentialsByUserId.set(credential.userId, this.clone(credential));
  }

  async findByUserId(userId: UserId): Promise<UserCredential | null> {
    const cred = this.credentialsByUserId.get(userId);
    if (!cred) return null;
    return this.clone(cred);
  }

  async findByUserIdForUpdate(userId: UserId): Promise<UserCredential | null> {
    return this.findByUserId(userId);
  }

  async update(credential: UserCredential): Promise<void> {
    if (!this.credentialsByUserId.has(credential.userId)) {
      throw new Error(`Credencial para usuario '${credential.userId}' no encontrada.`);
    }
    this.credentialsByUserId.set(credential.userId, this.clone(credential));
  }

  async deleteByUserId(userId: UserId): Promise<void> {
    this.credentialsByUserId.delete(userId);
  }

  createSnapshot(): unknown {
    const copy = new Map<string, UserCredential>();
    for (const [k, v] of this.credentialsByUserId.entries()) {
      copy.set(k, this.clone(v));
    }
    return copy;
  }

  restoreSnapshot(snapshot: unknown): void {
    const state = snapshot as Map<string, UserCredential>;
    this.credentialsByUserId.clear();
    for (const [k, v] of state.entries()) {
      this.credentialsByUserId.set(k, this.clone(v));
    }
  }

  clear(): void {
    this.credentialsByUserId.clear();
  }
}

