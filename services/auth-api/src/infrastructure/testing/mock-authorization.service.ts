import {
  AuthenticatedPrincipal,
  IAuthorizationPolicyService,
} from "../../interfaces";
import { UserId } from "../../domain";

export class MockAuthorizationPolicyService implements IAuthorizationPolicyService {
  canManageUsers(principal: AuthenticatedPrincipal): boolean {
    if (principal.isPlatformAdmin) return true;
    return principal.permissions.has("security.manage") || principal.permissions.has("users.manage");
  }

  canSuspendUser(principal: AuthenticatedPrincipal, targetUserId: UserId): boolean {
    // Un operador no puede suspender su propia cuenta
    if (principal.userId === targetUserId) return false;
    return this.canManageUsers(principal);
  }

  canDeleteUser(principal: AuthenticatedPrincipal, targetUserId: UserId): boolean {
    if (principal.userId === targetUserId) return false;
    return principal.isPlatformAdmin === true || principal.permissions.has("security.admin");
  }
}
