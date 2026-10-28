// Ports for access-control module
export interface AuthenticationRepository {
  login(email: string, password: string): Promise<any>
  logout(): Promise<void>
  getCurrentUser(): Promise<any>
}

export interface UserRepository {
  getUser(userId: string): Promise<any>
  updateUser(userId: string, data: any): Promise<void>
}

export interface RoleRepository {
  getRoles(): Promise<any>
  getRole(roleId: string): Promise<any>
  createRole(data: any): Promise<void>
  updateRole(roleId: string, data: any): Promise<void>
  deleteRole(roleId: string): Promise<void>
}

export interface PermissionRepository {
  getPermissions(): Promise<any>
  getPermission(permissionId: string): Promise<any>
}