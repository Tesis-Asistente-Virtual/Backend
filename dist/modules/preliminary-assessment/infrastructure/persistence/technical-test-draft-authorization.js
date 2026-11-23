import { sql } from 'drizzle-orm';
/** Enables the exact pending draft only for one transaction in the isolated test composition. */
export async function enableTechnicalTestDraftForVersion(tx, configuredCandidateVersionId, instrumentVersionId) {
    if (configuredCandidateVersionId && instrumentVersionId === configuredCandidateVersionId) {
        await tx.execute(sql `SELECT set_config('app.dass21_technical_test', 'enabled', true)`);
    }
}
