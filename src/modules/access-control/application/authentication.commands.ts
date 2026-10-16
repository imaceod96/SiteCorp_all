// Authentication commands
export interface AuthenticationCommands {
  login(email: string, password: string): Promise<any>
  logout(): Promise<void>
  resetPassword(email: string): Promise<void>
  updatePassword(currentPassword: string, newPassword: string): Promise<void>
}