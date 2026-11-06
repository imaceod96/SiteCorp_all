import { SecurityEvent } from "../../domain";
import {
  ISessionRepository,
  ITokenService,
  ISecurityAuditService,
} from "../../interfaces";
import { ILogoutUseCase } from "../use-cases.interface";
import { LogoutDto } from "../dto";
import { randomUUID } from "node:crypto";

export class LogoutUseCase implements ILogoutUseCase {
  constructor(
    private readonly sessionRepo: ISessionRepository,
    private readonly tokenService: ITokenService,
    private readonly auditService: ISecurityAuditService
  ) {}

  async execute(dto: LogoutDto): Promise<void> {
    const now = new Date();

    if (dto.allDevices && dto.userId) {
      await this.sessionRepo.revokeAllUserSessions(dto.userId);
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGOUT", {
          userId: dto.userId,
          metadata: { mode: "ALL_DEVICES" },
          now,
        })
      );
      return;
    }

    if (dto.rawRefreshToken) {
      const tokenHash = this.tokenService.hashOpaqueToken(dto.rawRefreshToken);
      const token = await this.sessionRepo.findRefreshTokenByHash(tokenHash);
      if (token) {
        await this.sessionRepo.revokeSession(token.sessionId);
        await this.sessionRepo.revokeTokenFamily(token.familyId);
        const session = await this.sessionRepo.findSessionById(token.sessionId);
        await this.auditService.recordEvent(
          SecurityEvent.create(randomUUID(), "LOGOUT", {
            userId: session ? session.userId : null,
            metadata: { sessionId: token.sessionId, familyId: token.familyId },
            now,
          })
        );
      }
      return;
    }

    if (dto.sessionId) {
      const session = await this.sessionRepo.findSessionById(dto.sessionId);
      await this.sessionRepo.revokeSession(dto.sessionId);
      await this.auditService.recordEvent(
        SecurityEvent.create(randomUUID(), "LOGOUT", {
          userId: session ? session.userId : null,
          metadata: { sessionId: dto.sessionId },
          now,
        })
      );
    }
  }
}
