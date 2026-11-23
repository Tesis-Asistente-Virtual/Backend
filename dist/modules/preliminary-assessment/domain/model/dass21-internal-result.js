import { z } from 'zod';
import { dass21AssessmentScoreSchema } from './dass21-assessment-score.js';
import { categorizeDass21Score, dass21InterpretationSupportSchema, DASS21_INTERPRETATION_VERSION } from './dass21-interpretation.js';
import { isInstrumentAvailable } from './instrument.js';
import { validateDass21QuestionMapping } from './dass21-question-mapping.js';
export const DASS21_INTERNAL_RESULT_VERSION = 'dass21-internal-result-1.0';
export const approvedDass21InterpretationSupportSchema = z.object({
    status: z.literal('approved'),
    approvalReference: z.string().trim().min(1).max(300),
    approvedAt: z.date(),
    support: dass21InterpretationSupportSchema,
}).strict();
const dimensionResultSchema = z.object({
    rawScore: z.number().int().min(0).max(21),
    equivalentScore: z.number().int().min(0).max(42),
    category: z.enum(['normal', 'mild', 'moderate', 'severe', 'extremely_severe']),
}).strict().superRefine((dimension, context) => {
    if (dimension.equivalentScore !== dimension.rawScore * 2) {
        context.addIssue({ code: 'custom', path: ['equivalentScore'], message: 'Equivalent score must equal raw score multiplied by two' });
    }
});
export const dass21InternalResultSchema = z.discriminatedUnion('status', [
    z.object({
        schemaVersion: z.literal('1.0'),
        resultVersion: z.literal(DASS21_INTERNAL_RESULT_VERSION),
        status: z.literal('available'),
        assessmentId: z.string().uuid(),
        instrument: z.object({
            code: z.literal('DASS-21'),
            instrumentId: z.string().uuid(),
            instrumentVersionId: z.string().uuid(),
            version: z.string().trim().min(1).max(40),
        }).strict(),
        scoringVersion: z.string().trim().min(1).max(40),
        interpretationVersion: z.literal(DASS21_INTERPRETATION_VERSION),
        dimensions: z.object({
            depression: dimensionResultSchema,
            anxiety: dimensionResultSchema,
            stress: dimensionResultSchema,
        }).strict(),
        limitations: z.tuple([
            z.literal('not_a_diagnosis'),
            z.literal('conventional_categories_are_not_clinical_severity'),
            z.literal('not_for_automated_treatment_or_safety_decisions'),
        ]),
    }).strict(),
    z.object({
        schemaVersion: z.literal('1.0'),
        resultVersion: z.literal(DASS21_INTERNAL_RESULT_VERSION),
        status: z.literal('not_available'),
        assessmentId: z.string().uuid(),
        reason: z.enum([
            'assessment_incomplete',
            'consent_required',
            'score_unavailable',
            'instrument_unavailable',
            'mapping_unavailable',
            'interpretation_support_unavailable',
            'score_invalid',
        ]),
        limitations: z.tuple([
            z.literal('not_a_diagnosis'),
            z.literal('not_for_participant_display'),
        ]),
    }).strict(),
]);
export class Dass21InternalResultError extends Error {
    code;
    constructor(code) {
        super('Internal DASS-21 result is unavailable');
        this.code = code;
        this.name = 'Dass21InternalResultError';
    }
}
/** Pure builder for an internal result; authorization and source retrieval belong to the application layer. */
export function buildInternalDass21Result(input) {
    const scoreParsed = dass21AssessmentScoreSchema.safeParse(input.score);
    const supportParsed = approvedDass21InterpretationSupportSchema.safeParse(input.approvedSupport);
    if (!scoreParsed.success || !supportParsed.success || !isInstrumentAvailable(input.instrument)) {
        throw new Dass21InternalResultError('invalid_result_context');
    }
    const score = scoreParsed.data;
    const support = supportParsed.data;
    const instrument = input.instrument;
    let mapping;
    try {
        mapping = validateDass21QuestionMapping(input.mapping, instrument);
    }
    catch {
        throw new Dass21InternalResultError('invalid_result_context');
    }
    if (score.assessmentId !== input.assessmentId || score.instrumentId !== instrument.instrumentId ||
        score.instrumentVersionId !== instrument.instrumentVersionId || score.instrumentVersionId !== mapping.instrumentVersionId ||
        score.mappingId !== mapping.mappingId || score.mappingVersion !== mapping.mappingVersion || mapping.status !== 'frozen' ||
        mapping.instrumentId !== instrument.instrumentId || support.support.instrumentVersionId !== instrument.instrumentVersionId ||
        support.support.scoringVersion !== score.scoringVersion) {
        throw new Dass21InternalResultError('invalid_result_context');
    }
    let interpretation;
    try {
        interpretation = categorizeDass21Score(score, support.support);
    }
    catch {
        throw new Dass21InternalResultError('invalid_interpretation_support');
    }
    return dass21InternalResultSchema.parse({
        schemaVersion: '1.0',
        resultVersion: DASS21_INTERNAL_RESULT_VERSION,
        status: 'available',
        assessmentId: input.assessmentId,
        instrument: {
            code: 'DASS-21', instrumentId: instrument.instrumentId,
            instrumentVersionId: instrument.instrumentVersionId, version: instrument.version,
        },
        scoringVersion: score.scoringVersion,
        interpretationVersion: interpretation.interpretationVersion,
        dimensions: interpretation.dimensions,
        limitations: [
            'not_a_diagnosis',
            'conventional_categories_are_not_clinical_severity',
            'not_for_automated_treatment_or_safety_decisions',
        ],
    });
}
export function dass21ResultNotAvailable(assessmentId, reason) {
    return dass21InternalResultSchema.parse({
        schemaVersion: '1.0', resultVersion: DASS21_INTERNAL_RESULT_VERSION, status: 'not_available', assessmentId, reason,
        limitations: ['not_a_diagnosis', 'not_for_participant_display'],
    });
}
