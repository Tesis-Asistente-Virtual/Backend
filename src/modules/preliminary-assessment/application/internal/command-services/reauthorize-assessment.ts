import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { reauthorizeAssessment } from '../../../domain/model/preliminary-assessment.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

/** Rebinds an open assessment to a newly granted, currently published notice. */
export class ReauthorizeAssessment {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(assessmentId: string, accountId: string) {
    const current = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!current) throw new PreliminaryAssessmentError('assessment_not_found');
    if (current.status !== 'in_progress' && current.status !== 'paused') {
      throw new PreliminaryAssessmentError('assessment_closed');
    }

    const currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId);
    if (!currentNoticeId) throw new PreliminaryAssessmentError('consent_required');
    if (currentNoticeId === current.consentNoticeVersionId) return current;

    const at = new Date(Math.max(this.clock().getTime(), current.updatedAt.getTime() + 1));
    const updated = reauthorizeAssessment(current, currentNoticeId, at);
    const saved = await this.assessments.saveForOwner(updated, accountId, current.updatedAt);
    if (!saved) throw new PreliminaryAssessmentError('concurrent_modification');
    return updated;
  }
}
