// Roles commands
export interface RolesCommands {
  createRole(data: any): Promise<void>
  updateRole(roleId: string, data: any): Promise<void>
  deleteRole(roleId: string): Promise<void>
}