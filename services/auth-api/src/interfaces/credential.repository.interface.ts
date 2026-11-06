import { UserId } from "../domain";

export interface UserCredential {
  readonly id: string;
  readonly userId: UserId;
  readonly algorithm: "argon2id" | "bcrypt";
  readonly passwordHash: string;
  readonly version: number;
  readonly createdAt: Date;
}

export interface ICredentialRepository {
  save(credential: UserCredential): Promise<void>;
  findByUserId(userId: UserId): Promise<UserCredential | null>;
  update(credential: UserCredential): Promise<void>;
  deleteByUserId(userId: UserId): Promise<void>;
}
