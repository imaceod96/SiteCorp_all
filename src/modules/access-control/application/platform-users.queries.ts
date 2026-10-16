// Platform users queries
export interface PlatformUsersQueries {
  getPlatformUsers(): Promise<any>
  getPlatformUser(userId: string): Promise<any>
}