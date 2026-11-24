import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { consentNoticeVersions } from '../modules/consent/infrastructure/persistence/schema.js';
const label = 'SOLO PRUEBA TÉCNICA / NO APROBACIÓN LEGAL / DATOS FICTICIOS.';
export const integratedStagingSyntheticNotices = [
    { purpose: 'ai_conversation_processing', version: 'staging-synthetic-8b1-ai-v1', content: `${label} Aviso ficticio para probar procesamiento conversacional local en tesis_staging_db. No es un aviso legal y no autoriza participantes reales.` },
    { purpose: 'structured_signal_extraction', version: 'staging-synthetic-8b1-extraction-v1', content: `${label} Aviso ficticio para probar extracción estructurada local en tesis_staging_db. No es un aviso legal y no autoriza participantes reales.` },
    { purpose: 'preliminary_assessment', version: 'staging-synthetic-8b1-assessment-v1', content: `${label} Aviso ficticio para probar el flujo técnico de evaluación en tesis_staging_db. No es un aviso legal, una aprobación profesional ni una autorización de uso clínico.` },
];
/** Opt-in, idempotent setup for one dedicated staging database; never supersedes or edits a notice. */
export async function ensureIntegratedStagingSyntheticNotices(db, clock = () => new Date()) {
    return db.transaction(async (tx) => {
        await tx.execute(sql `select pg_advisory_xact_lock(420081)`);
        const ids = {};
        for (const fixture of integratedStagingSyntheticNotices) {
            const rows = await tx.select().from(consentNoticeVersions).where(eq(consentNoticeVersions.purpose, fixture.purpose));
            const expectedHash = createHash('sha256').update(fixture.content).digest('hex');
            const published = rows.filter(row => row.status === 'published');
            if (published.length > 1)
                throw new Error('Synthetic staging notice conflict');
            const current = published[0];
            if (current) {
                if (current.version !== fixture.version || current.content !== fixture.content || current.contentHash !== expectedHash || current.effectiveAt > clock()) {
                    throw new Error('Synthetic staging notice conflict');
                }
                ids[fixture.purpose] = current.id;
                continue;
            }
            const draft = rows.find(row => row.version === fixture.version);
            if (draft && (draft.status !== 'draft' || draft.content !== fixture.content || draft.contentHash !== expectedHash || draft.effectiveAt > clock())) {
                throw new Error('Synthetic staging notice conflict');
            }
            let draftId = draft?.id;
            if (!draftId) {
                const [created] = await tx.insert(consentNoticeVersions).values({
                    purpose: fixture.purpose, version: fixture.version, content: fixture.content,
                    contentHash: expectedHash, effectiveAt: clock(), status: 'draft',
                }).returning({ id: consentNoticeVersions.id });
                if (!created)
                    throw new Error('Synthetic staging notice setup failed');
                draftId = created.id;
            }
            const [publishedDraft] = await tx.update(consentNoticeVersions).set({ status: 'published' }).where(and(eq(consentNoticeVersions.id, draftId), eq(consentNoticeVersions.status, 'draft'))).returning({ id: consentNoticeVersions.id });
            if (!publishedDraft)
                throw new Error('Synthetic staging notice setup failed');
            ids[fixture.purpose] = publishedDraft.id;
        }
        return ids;
    });
}
