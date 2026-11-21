import { z } from 'zod';
/** Explicitly unavailable sections prevent consumers from mistaking missing rules for a zero/low result. */
const unavailableSchema = z.object({
    status: z.literal('not_available'),
    reason: z.enum(['no_approved_instrument', 'no_approved_scoring_rules', 'not_assessed']),
}).strict();
export const preliminaryAssessmentResultSchema = z.object({
    schemaVersion: z.literal('1.0'),
    assessmentId: z.string().uuid(),
    instrumentVersionId: z.string().uuid().nullable(),
    calculatedAt: z.date(),
    instrumentScores: unavailableSchema,
    interpretation: unavailableSchema,
    attentionPriority: unavailableSchema,
    safetyState: unavailableSchema,
}).strict();
/** This factory publishes no score, diagnosis, priority, or safety conclusion. */
export function createUnavailableAssessmentResult(assessmentId, instrumentVersionId, calculatedAt) {
    const reason = instrumentVersionId === null ? 'no_approved_instrument' : 'no_approved_scoring_rules';
    return preliminaryAssessmentResultSchema.parse({
        schemaVersion: '1.0', assessmentId, instrumentVersionId, calculatedAt,
        instrumentScores: { status: 'not_available', reason },
        interpretation: { status: 'not_available', reason },
        attentionPriority: { status: 'not_available', reason },
        safetyState: { status: 'not_available', reason: 'not_assessed' },
    });
}
