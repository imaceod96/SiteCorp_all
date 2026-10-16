// Authentication queries
export interface AuthenticationQueries {
  getCurrentUser(): Promise<any>
  isAuthenticated(): Promise<boolean>
  getUserPermissions(): Promise<string[]>
}