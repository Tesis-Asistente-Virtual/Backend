import { z } from 'zod';
/** Version of the deterministic subscale sum and DASS-21 x2 conversion rules. */
export const DASS21_SCORING_VERSION = 'dass21-score-1.0';
export const DASS21_TECHNICAL_TEST_INSTRUMENT_ID = '00000000-0000-4000-8000-000000008a91';
export const DASS21_TECHNICAL_TEST_VERSION_ID = '00000000-0000-4000-8000-000000008a92';
export const DASS21_TECHNICAL_TEST_VERSION = 'dass21-spanish-candidate-1.1';
const instrumentMetadataSchema = z.object({
    instrumentCode: z.literal('DASS-21'),
    instrumentId: z.string().uuid(),
    instrumentVersionId: z.string().uuid(),
    version: z.string().trim().min(1).max(40),
    status: z.enum(['draft', 'approved', 'retired']),
    approvalStatus: z.enum(['pending', 'approved', 'rejected']),
    licenseStatus: z.enum(['not_reviewed', 'authorized', 'restricted', 'not_applicable']),
}).strict();
const itemAnswerSchema = z.object({
    instrumentVersionId: z.string().uuid(),
    itemNumber: z.number().int().min(1).max(21),
    value: z.number().int().min(0).max(3),
}).strict();
export const dass21ScoreSchema = z.object({
    schemaVersion: z.literal('1.0'),
    scoringVersion: z.literal(DASS21_SCORING_VERSION),
    instrumentVersionId: z.string().uuid(),
    dimensions: z.object({
        depression: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
        anxiety: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
        stress: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
    }).strict(),
}).strict();
/** Safe scoring failure. It intentionally omits the received payload and answer values. */
export class Dass21ScoringError extends Error {
    code;
    constructor(code) {
        super('DASS-21 scoring could not be completed');
        this.code = code;
        this.name = 'Dass21ScoringError';
    }
}
/** Canonical DASS-21 item assignment reused by scoring and version manifests. */
export const DASS21_ITEMS_BY_DIMENSION = Object.freeze({
    depression: Object.freeze([3, 5, 10, 13, 16, 17, 21]),
    anxiety: Object.freeze([2, 4, 7, 9, 15, 19, 20]),
    stress: Object.freeze([1, 6, 8, 11, 12, 14, 18]),
});
/**
 * Pure scoring engine. `itemNumber` is an internal synthetic/test mapping; this
 * function is not wired to HTTP or persistence until an approved instrument
 * version can provide and validate that mapping.
 */
function scoreDass21Core(value, authorization) {
    const instrument = instrumentMetadataSchema.safeParse(value.instrument);
    if (!instrument.success)
        throw new Dass21ScoringError('invalid_instrument');
    const isApproved = instrument.data.status === 'approved' && instrument.data.approvalStatus === 'approved' &&
        ['authorized', 'not_applicable'].includes(instrument.data.licenseStatus);
    const isExactSyntheticCandidate = authorization === 'synthetic_technical_test' &&
        instrument.data.instrumentId === DASS21_TECHNICAL_TEST_INSTRUMENT_ID &&
        instrument.data.instrumentVersionId === DASS21_TECHNICAL_TEST_VERSION_ID &&
        instrument.data.version === DASS21_TECHNICAL_TEST_VERSION && instrument.data.status === 'draft' &&
        instrument.data.approvalStatus === 'pending' && instrument.data.licenseStatus === 'not_reviewed';
    if (!isApproved && !isExactSyntheticCandidate) {
        throw new Dass21ScoringError('instrument_not_approved');
    }
    if (!Array.isArray(value.answers) || value.answers.length !== 21) {
        throw new Dass21ScoringError('incomplete_answers');
    }
    const answers = [];
    for (const candidate of value.answers) {
        const parsed = itemAnswerSchema.safeParse(candidate);
        if (!parsed.success)
            throw new Dass21ScoringError('invalid_answers');
        if (parsed.data.instrumentVersionId !== instrument.data.instrumentVersionId) {
            throw new Dass21ScoringError('instrument_version_mismatch');
        }
        answers.push(parsed.data);
    }
    const byItem = new Map();
    for (const answer of answers) {
        if (byItem.has(answer.itemNumber))
            throw new Dass21ScoringError('invalid_answers');
        byItem.set(answer.itemNumber, answer.value);
    }
    if (byItem.size !== 21)
        throw new Dass21ScoringError('incomplete_answers');
    const dimensions = Object.fromEntries(Object.entries(DASS21_ITEMS_BY_DIMENSION).map(([dimension, itemNumbers]) => {
        const rawScore = itemNumbers.reduce((sum, itemNumber) => sum + (byItem.get(itemNumber) ?? 0), 0);
        return [dimension, { rawScore, equivalentScore: rawScore * 2 }];
    }));
    return dass21ScoreSchema.parse({
        schemaVersion: '1.0',
        scoringVersion: DASS21_SCORING_VERSION,
        instrumentVersionId: instrument.data.instrumentVersionId,
        dimensions,
    });
}
/** Normal scoring entry point: only approved and licensed instrument versions are accepted. */
export function scoreDass21(value) {
    return scoreDass21Core(value, 'approved');
}
/** Explicit technical-test entry point, restricted to the single pending synthetic candidate above. */
export function scoreDass21ForSyntheticTechnicalTest(value) {
    return scoreDass21Core(value, 'synthetic_technical_test');
}
