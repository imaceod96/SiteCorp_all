// Client access queries
export interface ClientAccessQueries {
  getClientAccess(clientId: string): Promise<any>
  listClientUsers(clientId: string): Promise<any[]>
}