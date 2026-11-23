import { randomUUID } from 'node:crypto';
import { createPreliminaryAssessment } from '../../../domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { isInstrumentAvailable } from '../../../domain/model/instrument.js';
export class StartPreliminaryAssessment {
    assessments;
    instruments;
    consent;
    clock;
    availability;
    constructor(assessments, instruments, consent, clock = () => new Date(), availability = instrument => isInstrumentAvailable(instrument)) {
        this.assessments = assessments;
        this.instruments = instruments;
        this.consent = consent;
        this.clock = clock;
        this.availability = availability;
    }
    async execute(accountId, instrumentVersionId) {
        const consentNoticeVersionId = await this.consent.getCurrentNoticeVersionId(accountId);
        if (!consentNoticeVersionId)
            throw new PreliminaryAssessmentError('consent_required');
        const selected = await this.instruments.findAvailableByVersionId(instrumentVersionId, this.clock());
        if (!selected || !this.availability(selected, this.clock()))
            throw new PreliminaryAssessmentError('instrument_unavailable');
        const now = this.clock();
        if (selected.effectiveAt > now)
            throw new PreliminaryAssessmentError('instrument_unavailable');
        const assessment = createPreliminaryAssessment({
            assessmentId: randomUUID(), accountId, assessmentType: 'structured_instrument', mode: 'structured_instrument',
            instrumentVersionId: selected.instrumentVersionId, consentNoticeVersionId, createdAt: now, startedAt: now,
        });
        await this.assessments.create(assessment);
        return assessment;
    }
}
