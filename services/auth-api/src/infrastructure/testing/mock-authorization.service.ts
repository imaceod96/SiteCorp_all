import {
  AuthenticatedPrincipal,
  IAuthorizationPolicyService,
} from "../../interfaces";
import { UserId } from "../../domain";

export class MockAuthorizationPolicyService implements IAuthorizationPolicyService {
  private isRestrictedPendingPasswordChange(principal: AuthenticatedPrincipal): boolean {
    return (
      principal.mustChangePassword === true ||
      principal.role === "pending_password_change"
    );
  }

  canManageUsers(principal: AuthenticatedPrincipal): boolean {
    if (this.isRestrictedPendingPasswordChange(principal)) return false;
    if (principal.isPlatformAdmin) return true;
    return principal.permissions.has("security.manage") || principal.permissions.has("users.manage");
  }

  canSuspendUser(principal: AuthenticatedPrincipal, targetUserId: UserId): boolean {
    if (this.isRestrictedPendingPasswordChange(principal)) return false;
    // Un operador no puede suspender su propia cuenta
    if (principal.userId === targetUserId) return false;
    return this.canManageUsers(principal);
  }

  canDeleteUser(principal: AuthenticatedPrincipal, targetUserId: UserId): boolean {
    if (this.isRestrictedPendingPasswordChange(principal)) return false;
    if (principal.userId === targetUserId) return false;
    return principal.isPlatformAdmin === true || principal.permissions.has("security.admin") || principal.permissions.has("security.manage");
  }
}
