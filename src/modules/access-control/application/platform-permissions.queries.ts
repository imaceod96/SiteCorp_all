// Platform permissions queries
export interface PlatformPermissionsQueries {
  getPlatformPermissions(): Promise<any>
  checkPermission(permission: string): Promise<boolean>
}