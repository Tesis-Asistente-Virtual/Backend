import { isInstrumentAvailable, toPublicInstrumentQuestion } from '../../../domain/model/instrument.js';
export class GetAssessmentInfo {
    instruments;
    clock;
    constructor(instruments, clock = () => new Date()) {
        this.instruments = instruments;
        this.clock = clock;
    }
    async execute() {
        const available = (await this.instruments.listAvailable(100, 0, this.clock())).filter(isInstrumentAvailable);
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
