// Entity access commands
export interface EntityAccessCommands {
  grantEntityAccess(entityId: string, userId: string, role: string): Promise<void>
  revokeEntityAccess(entityId: string, userId: string): Promise<void>
}