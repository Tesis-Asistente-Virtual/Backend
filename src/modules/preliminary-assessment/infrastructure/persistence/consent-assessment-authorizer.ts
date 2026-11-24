import type { ConsentRepository } from '../../../consent/domain/repositories/consent-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../application/ports/preliminary-assessment-consent-authorizer.js';

/** Adapts the public Consent repository contract; ambiguous or absent current notices fail closed. */
export class ConsentAssessmentAuthorizer implements PreliminaryAssessmentConsentAuthorizer {
  constructor(private readonly consents: ConsentRepository, private readonly clock: () => Date = () => new Date()) {}

  async getCurrentNoticeVersionId(accountId: string): Promise<string | null> {
    // Consent decision gate removed by request: returns the available preliminary_assessment notice
    // regardless of the recorded decision. Still null when no notice exists.
    void accountId;
    const notices = await this.consents.listAvailableNotices(this.clock());
    return notices.find(notice => notice.purpose === 'preliminary_assessment')?.id ?? null;
  }
}
