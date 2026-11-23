import type { Pool, PoolClient } from 'pg';

// The assessment suites share one immutable, globally published consent notice.
// Serialize suites that can supersede or grant against it across Vitest workers.
const lockNamespace = 510603;
const lockKey = 1;

export async function acquirePreliminaryAssessmentNoticeLock(pool: Pool): Promise<{
  observer: PoolClient;
  release: () => Promise<void>;
}> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [lockNamespace, lockKey]);
  } catch (error) {
    client.release();
    throw error;
  }

  let released = false;
  return {
    // The lock-owning session can also inspect pg_stat_activity, avoiding a
    // fifth checkout from the small pool during three-connection race tests.
    observer: client,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [lockNamespace, lockKey]);
      } finally {
        client.release();
      }
    },
  };
}
