import { isInstrumentAvailable } from '../../../domain/model/instrument.js';
import { dass21AssessmentScoreSchema } from '../../../domain/model/dass21-assessment-score.js';
import { approvedDass21InterpretationSupportSchema, buildInternalDass21Result, dass21ResultNotAvailable } from '../../../domain/model/dass21-internal-result.js';
import { DASS21_INTERPRETATION_VERSION } from '../../../domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../../../domain/model/dass21-scoring.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
/** Internal-only reader. It is not composed into REST, jobs, or participant workflows. */
export class GetMyInternalDass21Result {
    reads;
    support;
    clock;
    constructor(reads, support, clock = () => new Date()) {
        this.reads = reads;
        this.support = support;
        this.clock = clock;
    }
    async execute(assessmentId, accountId) {
        if (!isUuid(assessmentId) || !isUuid(accountId))
            throw new PreliminaryAssessmentError('assessment_not_found');
        const checkedAt = this.clock();
        try {
            return await this.reads.execute(async (session) => {
                // Consent locks come first, matching the shared order used by Consent and assessment writes.
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
                if (assessment.consentNoticeVersionId !== currentNoticeVersionId) {
                    return dass21ResultNotAvailable(assessmentId, 'consent_required');
                }
                if (assessment.status !== 'completed' || assessment.mode !== 'structured_instrument' || !assessment.instrumentVersionId) {
                    return dass21ResultNotAvailable(assessmentId, 'assessment_incomplete');
                }
                const responses = assessment.responses;
                if (responses.length !== 21 || responses.some(response => response.assessmentId !== assessmentId ||
                    response.instrumentVersionId !== assessment.instrumentVersionId || response.status !== 'answered' || response.answer === null) ||
                    new Set(responses.map(response => response.questionId)).size !== 21) {
                    return dass21ResultNotAvailable(assessmentId, 'assessment_incomplete');
                }
                const instrument = await session.findAvailableInstrumentVersion(assessment.instrumentVersionId, checkedAt);
                if (!instrument || instrument.instrumentVersionId !== assessment.instrumentVersionId ||
                    !isInstrumentAvailable(instrument) || instrument.questions.length !== 21) {
                    return dass21ResultNotAvailable(assessmentId, 'instrument_unavailable');
                }
                // This provider is a synchronous, server-owned lookup. No external work is done while locks are held.
                const parsedSupport = approvedDass21InterpretationSupportSchema.safeParse(this.support.getApprovedSupport(instrument.instrumentVersionId));
                if (!parsedSupport.success || parsedSupport.data.status !== 'approved' || parsedSupport.data.approvedAt > checkedAt ||
                    parsedSupport.data.support.instrumentVersionId !== instrument.instrumentVersionId ||
                    parsedSupport.data.support.scoringVersion !== DASS21_SCORING_VERSION ||
                    parsedSupport.data.support.interpretationVersion !== DASS21_INTERPRETATION_VERSION) {
                    return dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable');
                }
                const scoreValue = await session.findScoreForOwner(assessmentId, accountId);
                if (!scoreValue)
                    return dass21ResultNotAvailable(assessmentId, 'score_unavailable');
                const parsedScore = dass21AssessmentScoreSchema.safeParse(scoreValue);
                if (!parsedScore.success || parsedScore.data.accountId !== accountId || parsedScore.data.assessmentId !== assessmentId ||
                    parsedScore.data.instrumentId !== instrument.instrumentId || parsedScore.data.instrumentVersionId !== instrument.instrumentVersionId) {
                    return dass21ResultNotAvailable(assessmentId, 'score_invalid');
                }
                if (parsedSupport.data.support.scoringVersion !== parsedScore.data.scoringVersion) {
                    return dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable');
                }
                const mapping = await session.findFrozenMapping(instrument.instrumentVersionId, parsedScore.data.mappingVersion, instrument);
                if (!mapping || mapping.mappingId !== parsedScore.data.mappingId || mapping.instrumentId !== instrument.instrumentId ||
                    mapping.instrumentVersionId !== instrument.instrumentVersionId || mapping.status !== 'frozen') {
                    return dass21ResultNotAvailable(assessmentId, 'mapping_unavailable');
                }
                return buildInternalDass21Result({
                    assessmentId, score: parsedScore.data, instrument, mapping, approvedSupport: parsedSupport.data,
                });
            });
        }
        catch (error) {
            if (error instanceof PreliminaryAssessmentError && error.code === 'assessment_not_found')
                throw error;
            // SQL/transaction errors never escape this internal boundary or produce a partial result.
            return dass21ResultNotAvailable(assessmentId, 'authorization_unavailable');
        }
    }
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
