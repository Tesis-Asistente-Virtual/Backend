import { randomUUID } from 'node:crypto';
import { createPreliminaryAssessment } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy } from '../../../domain/model/instrument.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

/** Compara fechas por día del calendario del servidor (zona horaria del proceso). */
function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

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
    // Una evaluación por día calendario: evita acumular varias el mismo día y sesga las estadísticas.
    const [latest] = await this.assessments.listByOwner(accountId, 1, 0);
    if (latest && isSameCalendarDay(latest.createdAt, now)) throw new PreliminaryAssessmentError('daily_limit_reached');
    const assessment = createPreliminaryAssessment({
      assessmentId: randomUUID(), accountId, assessmentType: 'structured_instrument', mode: 'structured_instrument',
      instrumentVersionId: selected.instrumentVersionId, consentNoticeVersionId, createdAt: now, startedAt: now,
    });
    await this.assessments.create(assessment);
    return assessment;
  }
}
