import type { Pool } from 'pg';
import { ConversationTurnInProgress, type ConversationTurnLock } from '../../application/ports/conversation-turn-lock.js';

export class ConversationTurnLockReleaseError extends Error {
  constructor() { super('Could not safely release the conversation turn lock'); this.name = 'ConversationTurnLockReleaseError'; }
}

/** Uses a PostgreSQL session advisory lock, not a transaction, across the provider call. */
export class PostgresConversationTurnLock implements ConversationTurnLock {
  constructor(private readonly pool: Pool) {}

  async runExclusive<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let acquired = false;
    let acquisitionCompleted = false;
    let destroyClient = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('conversation-turn:' || $1, 0)) AS locked",
        [conversationId],
      );
      acquisitionCompleted = true;
      acquired = result.rows[0]?.locked === true;
      if (!acquired) throw new ConversationTurnInProgress();
      return await operation();
    } catch (error) {
      if (!acquisitionCompleted) destroyClient = true;
      throw error;
    } finally {
      if (acquired) {
        try {
          const result = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended('conversation-turn:' || $1, 0)) AS unlocked",
            [conversationId],
          );
          if (result.rows[0]?.unlocked !== true) destroyClient = true;
        } catch {
          destroyClient = true;
        }
      }
      client.release(destroyClient ? new Error('Discard connection after advisory lock failure') : undefined);
      if (destroyClient && acquired) throw new ConversationTurnLockReleaseError();
    }
  }
}
