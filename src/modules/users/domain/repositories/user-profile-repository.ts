/** Repository is bound to the Unit of Work's active transaction. */
export interface UserProfileRepository {
  createForAccount(accountId: string): Promise<void>;
  findByAccountId(accountId: string): Promise<{ firstName: string | null; lastName: string | null; phone: string | null } | null>;
  updateByAccountId(accountId: string, changes: { firstName?: string | null; lastName?: string | null; phone?: string | null }): Promise<{ firstName: string | null; lastName: string | null; phone: string | null } | null>;
}
