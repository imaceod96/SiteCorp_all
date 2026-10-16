// Roles queries
export interface RolesQueries {
  getRoles(): Promise<any>
  getRole(roleId: string): Promise<any>
}