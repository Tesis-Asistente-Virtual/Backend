/** Repository is bound to the Unit of Work's active transaction. */
export interface UserProfileRepository {
  createForAccount(accountId: string): Promise<void>;
}
