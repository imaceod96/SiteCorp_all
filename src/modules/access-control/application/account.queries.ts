// Account queries
export interface AccountQueries {
  getAccount(): Promise<any>
  updateAccount(data: any): Promise<void>
}