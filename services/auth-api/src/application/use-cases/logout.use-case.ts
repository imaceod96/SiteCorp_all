import { ForbiddenError, SecurityEvent } from "../../domain";
import {
  ISessionRepository,
  ITokenService,
  ISecurityAuditService,
  ITransactionManager,
} from "../../interfaces";
import { ILogoutUseCase } from "../use-cases.interface";
import { LogoutDto } from "../dto";
import { randomUUID } from "node:crypto";

export class LogoutUseCase implements ILogoutUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly tokenService: ITokenService,
    private readonly auditService: ISecurityAuditService,
    private readonly txManager?: ITransactionManager
  ) {}

  private async executeInTx<T>(work: () => Promise<T>): Promise<T> {
    if (this.txManager) {
      return this.txManager.runInTransaction(() => work());
    }
    return work();
  }

  async execute(dto: LogoutDto): Promise<void> {
    const now = new Date();

    if (dto.allDevices && dto.userId) {
      const userId = dto.userId;
      await this.executeInTx(async () => {
        await this.sessionRepo.revokeAllUserSessions(userId);
        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "LOGOUT", {
            userId,
            metadata: { mode: "ALL_DEVICES" },
            now,
          })
        );
      });
      return;
    }

    if (dto.rawRefreshToken) {
      const tokenHash = this.tokenService.hashOpaqueToken(dto.rawRefreshToken);
      await this.executeInTx(async () => {
        const token = await this.sessionRepo.findRefreshTokenByHash(tokenHash);
        if (!token) {
          return;
        }
        const session = await this.sessionRepo.findSessionById(token.sessionId);
        if (dto.userId && session && session.userId !== dto.userId) {
          throw new ForbiddenError(
            "No está autorizado para cerrar una sesión perteneciente a otro usuario."
          );
        }
        await this.sessionRepo.revokeSession(token.sessionId);
        await this.sessionRepo.revokeTokenFamily(token.familyId);
        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "LOGOUT", {
            userId: session ? session.userId : (dto.userId ?? null),
            metadata: { sessionId: token.sessionId, familyId: token.familyId },
            now,
          })
        );
      });
      return;
    }

    if (dto.sessionId) {
      const sessionId = dto.sessionId;
      await this.executeInTx(async () => {
        const session = await this.sessionRepo.findSessionById(sessionId);
        if (!session) {
          return;
        }
        if (dto.userId && session.userId !== dto.userId) {
          throw new ForbiddenError(
            "No está autorizado para cerrar una sesión perteneciente a otro usuario."
          );
        }
        await this.sessionRepo.revokeSession(sessionId);
        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "LOGOUT", {
            userId: session.userId,
            metadata: { sessionId },
            now,
          })
        );
      });
    }
  }
}
