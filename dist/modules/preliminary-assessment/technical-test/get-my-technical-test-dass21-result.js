import { buildInternalDass21Result, dass21ResultNotAvailable } from '../domain/model/dass21-internal-result.js';
import { dass21AssessmentScoreSchema } from '../domain/model/dass21-assessment-score.js';
import { DASS21_INTERPRETATION_BASIS, DASS21_INTERPRETATION_VERSION } from '../domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../domain/model/dass21-scoring.js';
import { PreliminaryAssessmentError } from '../domain/model/assessment-errors.js';
import { TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID, TECHNICAL_TEST_DASS21_VERSION } from './dass21-candidate-fixture.js';
import { TECHNICAL_TEST_DASS21_MAPPING_VERSION } from './ensure-dass21-technical-test-mapping.js';
import { z } from 'zod';
import { dass21ParticipantResultSchema, toDass21ParticipantResult } from '../interfaces/rest/transformers/dass21-participant-result-transformer.js';
export const technicalTestDass21ResultResponseSchema = z.object({
    technicalTest: z.object({
        scope: z.literal('synthetic_only'),
        instrumentApprovalStatus: z.literal('not_approved'),
    }).strict(),
    result: dass21ParticipantResultSchema,
}).strict();
const technicalSupport = {
    status: 'synthetic_technical_test',
    support: {
        instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
        scoringVersion: DASS21_SCORING_VERSION,
        interpretationVersion: DASS21_INTERPRETATION_VERSION,
        basis: DASS21_INTERPRETATION_BASIS,
    },
};
/** Owner and consent-scoped result read for the loopback technical-test composition only. */
export class GetMyTechnicalTestDass21Result {
    reads;
    availability;
    clock;
    constructor(reads, availability, clock = () => new Date()) {
        this.reads = reads;
        this.availability = availability;
        this.clock = clock;
    }
    async execute(assessmentId, accountId) {
        if (!isUuid(assessmentId) || !isUuid(accountId))
            throw new PreliminaryAssessmentError('assessment_not_found');
        const checkedAt = this.clock();
        try {
            const internal = await this.reads.execute(async (session) => {
                let currentNoticeVersionId;
                try {
                    currentNoticeVersionId = await session.requireCurrentConsentNotice(accountId, checkedAt);
                }
                catch {
                    return dass21ResultNotAvailable(assessmentId, 'consent_required');
                }
                const assessment = await session.findAssessmentForOwner(assessmentId, accountId);
                if (!assessment)
                    throw new PreliminaryAssessmentError('assessment_not_found');
                if (assessment.consentNoticeVersionId !== currentNoticeVersionId)
                    return dass21ResultNotAvailable(assessmentId, 'consent_required');
                if (assessment.status !== 'completed' || assessment.mode !== 'structured_instrument' ||
                    assessment.instrumentVersionId !== TECHNICAL_TEST_DASS21_VERSION_ID || assessment.responses.length !== 21 ||
                    assessment.responses.some(answer => answer.status !== 'answered' || answer.answer === null) ||
                    new Set(assessment.responses.map(answer => answer.questionId)).size !== 21) {
                    return dass21ResultNotAvailable(assessmentId, 'assessment_incomplete');
                }
                const instrument = await session.findAvailableInstrumentVersion(TECHNICAL_TEST_DASS21_VERSION_ID, checkedAt);
                if (!instrument || !this.availability(instrument, checkedAt) || instrument.instrumentId !== TECHNICAL_TEST_DASS21_INSTRUMENT_ID ||
                    instrument.version !== TECHNICAL_TEST_DASS21_VERSION || instrument.questions.length !== 21) {
                    return dass21ResultNotAvailable(assessmentId, 'instrument_unavailable');
                }
                const scoreValue = await session.findScoreForOwner(assessmentId, accountId);
                if (!scoreValue)
                    return dass21ResultNotAvailable(assessmentId, 'score_unavailable');
                const score = dass21AssessmentScoreSchema.safeParse(scoreValue);
                if (!score.success || score.data.accountId !== accountId || score.data.instrumentId !== instrument.instrumentId ||
                    score.data.instrumentVersionId !== instrument.instrumentVersionId || score.data.mappingVersion !== TECHNICAL_TEST_DASS21_MAPPING_VERSION ||
                    score.data.scoringVersion !== DASS21_SCORING_VERSION)
                    return dass21ResultNotAvailable(assessmentId, 'score_invalid');
                const mapping = await session.findFrozenMapping(instrument.instrumentVersionId, score.data.mappingVersion, instrument);
                if (!mapping || mapping.mappingVersion !== TECHNICAL_TEST_DASS21_MAPPING_VERSION || mapping.status !== 'frozen' ||
                    mapping.mappingId !== score.data.mappingId)
                    return dass21ResultNotAvailable(assessmentId, 'mapping_unavailable');
                return buildInternalDass21Result({
                    assessmentId, score: score.data, instrument, mapping, approvedSupport: technicalSupport,
                    authorization: 'synthetic_technical_test', availability: this.availability, at: checkedAt,
                });
            });
            return technicalTestDass21ResultResponseSchema.parse({
                technicalTest: { scope: 'synthetic_only', instrumentApprovalStatus: 'not_approved' },
                result: toDass21ParticipantResult(internal),
            });
        }
        catch (error) {
            if (error instanceof PreliminaryAssessmentError && error.code === 'assessment_not_found')
                throw error;
            return technicalTestDass21ResultResponseSchema.parse({
                technicalTest: { scope: 'synthetic_only', instrumentApprovalStatus: 'not_approved' },
                result: toDass21ParticipantResult(dass21ResultNotAvailable(assessmentId, 'authorization_unavailable')),
            });
        }
    }
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
