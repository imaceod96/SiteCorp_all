import { randomBytes, randomUUID } from "node:crypto";
import {
  ActivationToken,
  ActivationTokenType,
  UserDeletedError,
  UserNotFoundError,
} from "../../domain";
import {
  AuthenticatedPrincipal,
  IActivationTokenRepository,
  ISecurityAuditService,
  ITransactionManager,
  IUserRepository,
} from "../../interfaces";
import {
  GenerateActivationTokenDto,
  GenerateActivationTokenResult,
} from "../dto";
import { IGenerateActivationTokenUseCase } from "../use-cases.interface";

export class GenerateActivationTokenUseCase implements IGenerateActivationTokenUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly tokenRepo: IActivationTokenRepository,
    private readonly auditService: ISecurityAuditService,
    private readonly txManager: ITransactionManager
  ) {}

  async execute(
    dto: GenerateActivationTokenDto,
    operator?: AuthenticatedPrincipal
  ): Promise<GenerateActivationTokenResult> {
    const user = await this.userRepo.findById(dto.userId);
    if (!user) {
      throw new UserNotFoundError(dto.userId);
    }
    if (user.status === "deleted") {
      throw new UserDeletedError("No es posible generar tokens de activación para usuarios eliminados.");
    }

    const tokenType: ActivationTokenType = dto.tokenType ?? "activation";
    const hours = dto.expiresInHours && dto.expiresInHours > 0 ? dto.expiresInHours : 24;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 3600 * 1000);

    const rawEntropy = randomBytes(32).toString("base64url");
    const tokenId = randomUUID();

    const { token, rawToken } = ActivationToken.create(
      tokenId,
      user.id,
      rawEntropy,
      tokenType,
      expiresAt,
      now,
      operator?.userId ?? dto.createdBy ?? null
    );

    await this.txManager.runInTransaction(async () => {
      // Invalidar tokens previos del mismo tipo pendientes para este usuario
      await this.tokenRepo.invalidatePendingForUser(user.id, tokenType);
      // Guardar el nuevo token con hash SHA-256
      await this.tokenRepo.save(token);

      await this.auditService.recordEvent({
        id: randomUUID(),
        userId: user.id,
        eventType: tokenType === "password_reset" ? "PASSWORD_RESET_REQUESTED" : "USER_ACTIVATED",
        ipAddress: dto.ipAddress ?? null,
        userAgent: dto.userAgent ?? null,
        metadata: {
          tokenId: token.id,
          tokenType,
          expiresAt: expiresAt.toISOString(),
          generatedByOperatorId: operator?.userId ?? null,
        },
        createdAt: now,
      });
    });

    return {
      tokenId: token.id,
      userId: user.id,
      rawToken,
      tokenType,
      expiresAt,
    };
  }
}
