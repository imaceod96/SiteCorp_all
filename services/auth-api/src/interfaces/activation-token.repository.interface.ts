import { ActivationToken, ActivationTokenType, UserId } from "../domain";

export interface IActivationTokenRepository {
  save(token: ActivationToken): Promise<void>;
  findByTokenHash(hash: string): Promise<ActivationToken | null>;
  invalidatePendingForUser(userId: UserId, tokenType: ActivationTokenType): Promise<void>;
  markUsed(
    tokenId: string,
    usedAt: Date,
    consumedIp?: string | null,
    consumedUserAgent?: string | null
  ): Promise<void>;
}
