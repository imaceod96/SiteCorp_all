// Entity access queries
export interface EntityAccessQueries {
  getEntityAccess(entityId: string): Promise<any>
  listEntityUsers(entityId: string): Promise<any[]>
  getUserEntityRoles(userId: string): Promise<any[]>
}