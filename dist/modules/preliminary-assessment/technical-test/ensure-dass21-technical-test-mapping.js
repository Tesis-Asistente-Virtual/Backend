import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Dass21ScoringError } from '../domain/model/dass21-scoring.js';
import { validateDass21QuestionMapping } from '../domain/model/dass21-question-mapping.js';
import { assessmentScoringItemMappings, assessmentScoringMappingVersions } from '../infrastructure/persistence/schema.js';
import { isTechnicalTestDass21Candidate, technicalTestDass21QuestionId, TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID } from './dass21-candidate-fixture.js';
export const TECHNICAL_TEST_DASS21_MAPPING_ID = '00000000-0000-4000-8000-000000008a94';
export const TECHNICAL_TEST_DASS21_MAPPING_VERSION = 'dass21-technical-test-map-1.0';
function expectedEntries() {
    return Array.from({ length: 21 }, (_, index) => ({ questionId: technicalTestDass21QuestionId(index), itemNumber: index + 1 }));
}
/** Creates or verifies one frozen, synthetic mapping for the exact pending candidate. */
export async function ensureDass21TechnicalTestMapping(db, instrument, at = new Date()) {
    if (!isTechnicalTestDass21Candidate(instrument, at))
        throw new Dass21ScoringError('invalid_instrument');
    const expected = validateDass21QuestionMapping({
        schemaVersion: '1.0', mappingId: TECHNICAL_TEST_DASS21_MAPPING_ID, instrumentCode: 'DASS-21',
        instrumentId: TECHNICAL_TEST_DASS21_INSTRUMENT_ID, instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
        mappingVersion: TECHNICAL_TEST_DASS21_MAPPING_VERSION, status: 'draft', entries: expectedEntries(),
        createdAt: at, frozenAt: null,
    }, instrument, isTechnicalTestDass21Candidate, at);
    await db.transaction(async (tx) => {
        let [row] = await tx.select().from(assessmentScoringMappingVersions).where(and(eq(assessmentScoringMappingVersions.instrumentVersionId, TECHNICAL_TEST_DASS21_VERSION_ID), eq(assessmentScoringMappingVersions.mappingVersion, TECHNICAL_TEST_DASS21_MAPPING_VERSION))).for('update').limit(1);
        if (row && (row.mappingId !== TECHNICAL_TEST_DASS21_MAPPING_ID || row.instrumentId !== TECHNICAL_TEST_DASS21_INSTRUMENT_ID)) {
            throw new Dass21ScoringError('mapping_conflict');
        }
        if (!row) {
            [row] = await tx.insert(assessmentScoringMappingVersions).values({
                mappingId: TECHNICAL_TEST_DASS21_MAPPING_ID,
                instrumentId: TECHNICAL_TEST_DASS21_INSTRUMENT_ID,
                instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
                mappingVersion: TECHNICAL_TEST_DASS21_MAPPING_VERSION,
                status: 'draft', createdAt: at, frozenAt: null,
            }).returning();
        }
        if (!row)
            throw new Dass21ScoringError('mapping_conflict');
        const actualItems = await tx.select().from(assessmentScoringItemMappings)
            .where(eq(assessmentScoringItemMappings.mappingId, row.mappingId))
            .orderBy(asc(assessmentScoringItemMappings.itemNumber));
        const actualEntries = actualItems.map(({ questionId, itemNumber }) => ({ questionId, itemNumber }));
        const mappingWithStoredCreation = { ...expected, createdAt: row.createdAt };
        if (row.status === 'frozen') {
            if (!isDeepStrictEqual(actualEntries, expected.entries))
                throw new Dass21ScoringError('mapping_conflict');
            validateDass21QuestionMapping({ ...mappingWithStoredCreation, status: 'frozen', frozenAt: row.frozenAt }, instrument, isTechnicalTestDass21Candidate, at);
            return;
        }
        if (row.status !== 'draft')
            throw new Dass21ScoringError('mapping_conflict');
        if (actualItems.length === 0) {
            await tx.insert(assessmentScoringItemMappings).values(expected.entries.map(entry => ({
                mappingId: TECHNICAL_TEST_DASS21_MAPPING_ID, instrumentId: TECHNICAL_TEST_DASS21_INSTRUMENT_ID,
                instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID, questionId: entry.questionId, itemNumber: entry.itemNumber,
            })));
        }
        else if (!isDeepStrictEqual(actualEntries, expected.entries)) {
            throw new Dass21ScoringError('mapping_conflict');
        }
        await tx.execute(sql `SELECT set_config('app.dass21_technical_test', 'enabled', true)`);
        const frozenAt = new Date(Math.max(at.getTime(), row.createdAt.getTime()));
        const [frozen] = await tx.update(assessmentScoringMappingVersions).set({ status: 'frozen', frozenAt }).where(and(eq(assessmentScoringMappingVersions.mappingId, row.mappingId), eq(assessmentScoringMappingVersions.status, 'draft'))).returning({ mappingId: assessmentScoringMappingVersions.mappingId });
        if (!frozen)
            throw new Dass21ScoringError('mapping_not_frozen');
    });
}
