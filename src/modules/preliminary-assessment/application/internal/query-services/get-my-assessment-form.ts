import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { isInstrumentAvailable, toPublicInstrumentQuestion } from '../../../domain/model/instrument.js';
import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

/** Returns the exact pinned form and saved progress only to its owner while it remains open and authorized. */
export class GetMyAssessmentForm {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly instruments: InstrumentCatalog,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(assessmentId: string, accountId: string) {
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status !== 'in_progress' && assessment.status !== 'paused') {
      throw new PreliminaryAssessmentError('assessment_closed');
    }
    if (!assessment.instrumentVersionId) throw new PreliminaryAssessmentError('instrument_version_mismatch');
    await this.assertCurrentConsent(assessment.accountId, assessment.consentNoticeVersionId);

    const instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, this.clock());
    if (!instrument || instrument.instrumentVersionId !== assessment.instrumentVersionId || !isInstrumentAvailable(instrument)) {
      throw new PreliminaryAssessmentError('instrument_unavailable');
    }

    // Recheck after assembling the response; a withdrawal or notice replacement fails closed.
    await this.assertCurrentConsent(assessment.accountId, assessment.consentNoticeVersionId);
    return {
      assessment,
      instrument: {
        instrumentId: instrument.instrumentId,
        instrumentVersionId: instrument.instrumentVersionId,
        version: instrument.version,
        effectiveAt: instrument.effectiveAt,
        questions: [...instrument.questions]
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .map(toPublicInstrumentQuestion),
      },
    };
  }

  private async assertCurrentConsent(accountId: string, boundNoticeId: string): Promise<void> {
    let currentNoticeId: string | null;
    try { currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId); }
    catch { throw new PreliminaryAssessmentError('consent_required'); }
    if (!currentNoticeId || currentNoticeId !== boundNoticeId) throw new PreliminaryAssessmentError('consent_required');
  }
}
