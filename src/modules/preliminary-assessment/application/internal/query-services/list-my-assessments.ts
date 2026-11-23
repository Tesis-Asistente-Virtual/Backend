import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

export class ListMyAssessments {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly consent?: PreliminaryAssessmentConsentAuthorizer,
  ) {}

  async execute(accountId: string, limit: number, offset: number) {
    const assessments = await this.assessments.listByOwner(accountId, limit, offset);
    return Promise.all(assessments.map(async assessment => {
      if (assessment.status !== 'in_progress' && assessment.status !== 'paused') return assessment;
      if (!this.consent) return { ...assessment, responses: [] };
      try {
        const currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId);
        return currentNoticeId === assessment.consentNoticeVersionId ? assessment : { ...assessment, responses: [] };
      } catch {
        // Metadata remains useful for recovery, but response payloads stay hidden on authorization failure.
        return { ...assessment, responses: [] };
      }
    }));
  }
}
