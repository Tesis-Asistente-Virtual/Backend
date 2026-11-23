import { isInstrumentAvailable, toPublicInstrumentQuestion } from '../../../domain/model/instrument.js';
export class GetAssessmentInfo {
    instruments;
    clock;
    availability;
    constructor(instruments, clock = () => new Date(), availability = instrument => isInstrumentAvailable(instrument)) {
        this.instruments = instruments;
        this.clock = clock;
        this.availability = availability;
    }
    async execute() {
        const now = this.clock();
        const available = (await this.instruments.listAvailable(100, 0, now)).filter(instrument => this.availability(instrument, now));
        return {
            assessmentAvailable: available.length > 0,
            mode: 'structured_instrument',
            instruments: available.map(item => ({
                instrumentId: item.instrumentId,
                instrumentVersionId: item.instrumentVersionId,
                version: item.version,
                effectiveAt: item.effectiveAt,
                questions: item.questions.map(toPublicInstrumentQuestion),
            })),
        };
    }
}
