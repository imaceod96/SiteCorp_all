import { UserId, Email } from "../domain";

export interface AuthenticatedPrincipal {
  readonly userId: UserId;
  readonly email: Email;
  readonly permissions: ReadonlySet<string>;
  readonly isPlatformAdmin?: boolean;
}

export interface IAuthorizationPolicyService {
  canManageUsers(principal: AuthenticatedPrincipal): boolean;
  canSuspendUser(principal: AuthenticatedPrincipal, targetUserId: UserId): boolean;
  canDeleteUser(principal: AuthenticatedPrincipal, targetUserId: UserId): boolean;
}
