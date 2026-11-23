import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';

type DrizzleTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Enables the exact pending draft only for one transaction in the isolated test composition. */
export async function enableTechnicalTestDraftForVersion(
  tx: DrizzleTransaction,
  configuredCandidateVersionId: string | undefined,
  instrumentVersionId: string | null,
): Promise<void> {
  if (configuredCandidateVersionId && instrumentVersionId === configuredCandidateVersionId) {
    await tx.execute(sql`SELECT set_config('app.dass21_technical_test', 'enabled', true)`);
  }
}
