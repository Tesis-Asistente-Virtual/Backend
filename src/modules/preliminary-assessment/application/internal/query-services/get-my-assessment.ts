import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

export class GetMyAssessment {
  constructor(private readonly assessments: PreliminaryAssessmentRepository, private readonly consent?: PreliminaryAssessmentConsentAuthorizer) {}
  async execute(assessmentId: string, accountId: string) {
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status === 'in_progress' || assessment.status === 'paused') {
      if (!this.consent) throw new PreliminaryAssessmentError('consent_required');
      let currentNoticeId: string | null;
      try { currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId); }
      catch { throw new PreliminaryAssessmentError('consent_required'); }
      if (!currentNoticeId || currentNoticeId !== assessment.consentNoticeVersionId) throw new PreliminaryAssessmentError('consent_required');
    }
    return assessment;
  }
}
