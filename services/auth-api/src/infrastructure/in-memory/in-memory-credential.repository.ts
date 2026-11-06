import { UserId } from "../../domain";
import { ICredentialRepository, UserCredential } from "../../interfaces";

export class InMemoryCredentialRepository implements ICredentialRepository {
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

  async update(credential: UserCredential): Promise<void> {
    if (!this.credentialsByUserId.has(credential.userId)) {
      throw new Error(`Credencial para usuario '${credential.userId}' no encontrada.`);
    }
    this.credentialsByUserId.set(credential.userId, this.clone(credential));
  }

  async deleteByUserId(userId: UserId): Promise<void> {
    this.credentialsByUserId.delete(userId);
  }

  clear(): void {
    this.credentialsByUserId.clear();
  }
}
