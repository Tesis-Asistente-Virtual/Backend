import { pauseAssessment, resumeAssessment, withdrawAssessment } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessment } from '../../../domain/model/preliminary-assessment.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

export type AssessmentStateAction = 'pause' | 'resume' | 'withdraw';

export class ChangeAssessmentState {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(assessmentId: string, accountId: string, action: AssessmentStateAction): Promise<PreliminaryAssessment> {
    const current = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!current) throw new PreliminaryAssessmentError('assessment_not_found');
    if (action === 'resume') {
      const noticeId = await this.consent.getCurrentNoticeVersionId(accountId);
      if (!noticeId || noticeId !== current.consentNoticeVersionId) throw new PreliminaryAssessmentError('consent_required');
    }
    const at = new Date(Math.max(this.clock().getTime(), current.updatedAt.getTime() + 1));
    const next = action === 'pause' ? pauseAssessment(current, at)
      : action === 'resume' ? resumeAssessment(current, at)
        : withdrawAssessment(current, at);
    const saved = await this.assessments.saveForOwner(next, accountId, current.updatedAt);
    if (!saved) throw new PreliminaryAssessmentError('concurrent_modification');
    return next;
  }
}

export class PauseAssessment {
  constructor(private readonly state: ChangeAssessmentState) {}
  execute(assessmentId: string, accountId: string) { return this.state.execute(assessmentId, accountId, 'pause'); }
}

export class ResumeAssessment {
  constructor(private readonly state: ChangeAssessmentState) {}
  execute(assessmentId: string, accountId: string) { return this.state.execute(assessmentId, accountId, 'resume'); }
}

export class WithdrawAssessment {
  constructor(private readonly state: ChangeAssessmentState) {}
  execute(assessmentId: string, accountId: string) { return this.state.execute(assessmentId, accountId, 'withdraw'); }
}
