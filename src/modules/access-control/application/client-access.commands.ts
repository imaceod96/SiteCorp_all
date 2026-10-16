// Client access commands
export interface ClientAccessCommands {
  grantClientAccess(clientId: string, userId: string): Promise<void>
  revokeClientAccess(clientId: string, userId: string): Promise<void>
}