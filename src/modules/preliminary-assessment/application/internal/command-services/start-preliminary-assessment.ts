import { randomUUID } from 'node:crypto';
import { createPreliminaryAssessment } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy } from '../../../domain/model/instrument.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

export class StartPreliminaryAssessment {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly instruments: InstrumentCatalog,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
    private readonly availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
  ) {}

  async execute(accountId: string, instrumentVersionId: string) {
    const consentNoticeVersionId = await this.consent.getCurrentNoticeVersionId(accountId);
    if (!consentNoticeVersionId) throw new PreliminaryAssessmentError('consent_required');
    const selected = await this.instruments.findAvailableByVersionId(instrumentVersionId, this.clock());
    if (!selected || !this.availability(selected, this.clock())) throw new PreliminaryAssessmentError('instrument_unavailable');
    const now = this.clock();
    if (selected.effectiveAt > now) throw new PreliminaryAssessmentError('instrument_unavailable');
    const assessment = createPreliminaryAssessment({
      assessmentId: randomUUID(), accountId, assessmentType: 'structured_instrument', mode: 'structured_instrument',
      instrumentVersionId: selected.instrumentVersionId, consentNoticeVersionId, createdAt: now, startedAt: now,
    });
    await this.assessments.create(assessment);
    return assessment;
  }
}
