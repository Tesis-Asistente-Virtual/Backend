import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import { isInstrumentAvailable, toPublicInstrumentQuestion, type InstrumentAvailabilityPolicy } from '../../../domain/model/instrument.js';

export class GetAssessmentInfo {
  constructor(
    private readonly instruments: InstrumentCatalog,
    private readonly clock: () => Date = () => new Date(),
    private readonly availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
  ) {}

  async execute() {
    const now = this.clock();
    const available = (await this.instruments.listAvailable(100, 0, now)).filter(instrument => this.availability(instrument, now));
    return {
      assessmentAvailable: available.length > 0,
      mode: 'structured_instrument' as const,
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
