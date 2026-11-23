import type { AssessmentAnswer, AssessmentResponse } from '../../../domain/model/assessment-response.js';
import { recordAssessmentResponse } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { AssessmentResponseRepository } from '../../../domain/repositories/assessment-response-repository.js';
import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy } from '../../../domain/model/instrument.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

export class SubmitAssessmentResponse {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly responses: AssessmentResponseRepository,
    private readonly instruments: InstrumentCatalog,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
    private readonly availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
  ) {}

  async execute(assessmentId: string, accountId: string, questionId: string, answer: AssessmentAnswer | null) {
    const assessment = await this.assessments.findByIdForOwner(assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status !== 'in_progress' || !assessment.instrumentVersionId) throw new PreliminaryAssessmentError('assessment_closed');
    const currentNotice = await this.consent.getCurrentNoticeVersionId(accountId);
    if (!currentNotice || currentNotice !== assessment.consentNoticeVersionId) throw new PreliminaryAssessmentError('consent_required');
    const instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, this.clock());
    if (!instrument || !this.availability(instrument, this.clock())) throw new PreliminaryAssessmentError('instrument_unavailable');
    const previous = assessment.responses.find(response => response.questionId === questionId);
    const now = this.clock();
    const updatedAt = new Date(Math.max(now.getTime(), assessment.updatedAt.getTime() + 1));
    const response: AssessmentResponse = {
      assessmentId, instrumentVersionId: instrument.instrumentVersionId, questionId,
      status: answer === null ? 'pending' : 'answered', answer,
      createdAt: previous?.createdAt ?? updatedAt,
      updatedAt,
    };
    const updated = recordAssessmentResponse(assessment, response, instrument, this.availability);
    const persisted = updated.responses.find(item => item.questionId === questionId);
    if (!persisted) throw new PreliminaryAssessmentError('invalid_response');
    await this.responses.saveForOwner(persisted, accountId);
    return persisted;
  }
}
