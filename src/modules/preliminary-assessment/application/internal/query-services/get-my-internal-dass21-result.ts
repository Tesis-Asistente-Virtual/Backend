import { isInstrumentAvailable } from '../../../domain/model/instrument.js';
import { dass21AssessmentScoreSchema } from '../../../domain/model/dass21-assessment-score.js';
import { approvedDass21InterpretationSupportSchema, dass21ResultNotAvailable, buildInternalDass21Result } from '../../../domain/model/dass21-internal-result.js';
import { DASS21_INTERPRETATION_VERSION } from '../../../domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../../../domain/model/dass21-scoring.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import type { Dass21QuestionMappingRepository } from '../../../domain/repositories/dass21-question-mapping-repository.js';
import type { Dass21AssessmentScoreRepository } from '../../../domain/repositories/dass21-assessment-score-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';
import type { Dass21InterpretationSupportProvider } from '../../ports/dass21-interpretation-support-provider.js';

/**
 * Internal-only read preparation. It is deliberately not composed into REST;
 * public /result remains the unavailable, score-free contract.
 */
export class GetMyInternalDass21Result {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly instruments: InstrumentCatalog,
    private readonly mappings: Dass21QuestionMappingRepository,
    private readonly scores: Dass21AssessmentScoreRepository,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly support: Dass21InterpretationSupportProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(assessmentId: string, accountId: string) {
    if (!isUuid(assessmentId) || !isUuid(accountId)) throw new PreliminaryAssessmentError('assessment_not_found');
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status !== 'completed' || assessment.mode !== 'structured_instrument' || !assessment.instrumentVersionId) {
      return dass21ResultNotAvailable(assessmentId, 'assessment_incomplete');
    }
    const responses = assessment.responses;
    if (responses.length !== 21 || responses.some(response => response.assessmentId !== assessmentId ||
      response.instrumentVersionId !== assessment.instrumentVersionId || response.status !== 'answered' || response.answer === null) ||
      new Set(responses.map(response => response.questionId)).size !== 21) {
      return dass21ResultNotAvailable(assessmentId, 'assessment_incomplete');
    }

    if (!await this.hasCurrentConsent(accountId, assessment.consentNoticeVersionId)) {
      return dass21ResultNotAvailable(assessmentId, 'consent_required');
    }

    let instrument;
    try {
      instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, this.clock());
    } catch {
      return dass21ResultNotAvailable(assessmentId, 'instrument_unavailable');
    }
    if (!instrument || instrument.instrumentVersionId !== assessment.instrumentVersionId ||
      !isInstrumentAvailable(instrument) || instrument.questions.length !== 21) {
      return dass21ResultNotAvailable(assessmentId, 'instrument_unavailable');
    }

    let approvedSupport;
    try {
      approvedSupport = await this.support.getApprovedSupport(instrument.instrumentVersionId);
    } catch {
      return dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable');
    }
    const parsedSupport = approvedDass21InterpretationSupportSchema.safeParse(approvedSupport);
    if (!parsedSupport.success || parsedSupport.data.status !== 'approved' || parsedSupport.data.approvedAt > this.clock() ||
      parsedSupport.data.support.instrumentVersionId !== instrument.instrumentVersionId ||
      parsedSupport.data.support.scoringVersion !== DASS21_SCORING_VERSION ||
      parsedSupport.data.support.interpretationVersion !== DASS21_INTERPRETATION_VERSION) {
      return dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable');
    }
    approvedSupport = parsedSupport.data;

    let scoreValue;
    try {
      scoreValue = await this.scores.findByAssessmentForOwner(assessmentId, accountId);
    } catch {
      return dass21ResultNotAvailable(assessmentId, 'score_unavailable');
    }
    if (!scoreValue) return dass21ResultNotAvailable(assessmentId, 'score_unavailable');
    const parsedScore = dass21AssessmentScoreSchema.safeParse(scoreValue);
    if (!parsedScore.success || parsedScore.data.accountId !== accountId || parsedScore.data.assessmentId !== assessmentId ||
      parsedScore.data.instrumentId !== instrument.instrumentId || parsedScore.data.instrumentVersionId !== instrument.instrumentVersionId) {
      return dass21ResultNotAvailable(assessmentId, 'score_invalid');
    }
    if (parsedSupport.data.support.scoringVersion !== parsedScore.data.scoringVersion) {
      return dass21ResultNotAvailable(assessmentId, 'interpretation_support_unavailable');
    }

    let mapping;
    try {
      mapping = await this.mappings.findFrozen(instrument.instrumentVersionId, parsedScore.data.mappingVersion);
    } catch {
      return dass21ResultNotAvailable(assessmentId, 'mapping_unavailable');
    }
    if (!mapping || mapping.mappingId !== parsedScore.data.mappingId || mapping.instrumentId !== instrument.instrumentId ||
      mapping.instrumentVersionId !== instrument.instrumentVersionId || mapping.status !== 'frozen') {
      return dass21ResultNotAvailable(assessmentId, 'mapping_unavailable');
    }

    // Revalidate after reading sensitive score material; there is no public reader composed in this sprint.
    if (!await this.hasCurrentConsent(accountId, assessment.consentNoticeVersionId)) {
      return dass21ResultNotAvailable(assessmentId, 'consent_required');
    }

    try {
      return buildInternalDass21Result({ assessmentId, score: parsedScore.data, instrument, mapping, approvedSupport });
    } catch {
      return dass21ResultNotAvailable(assessmentId, 'score_invalid');
    }
  }

  private async hasCurrentConsent(accountId: string, expectedNoticeVersionId: string): Promise<boolean> {
    try {
      const currentNoticeVersionId = await this.consent.getCurrentNoticeVersionId(accountId);
      return currentNoticeVersionId !== null && currentNoticeVersionId === expectedNoticeVersionId;
    } catch {
      return false;
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
