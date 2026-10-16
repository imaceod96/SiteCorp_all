// Platform users commands
export interface PlatformUsersCommands {
  createPlatformUser(data: any): Promise<void>
  updatePlatformUser(userId: string, data: any): Promise<void>
  deletePlatformUser(userId: string): Promise<void>
}