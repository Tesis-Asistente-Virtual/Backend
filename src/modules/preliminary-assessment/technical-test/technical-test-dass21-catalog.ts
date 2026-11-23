import type { InstrumentId, InstrumentVersion, InstrumentVersionId } from '../domain/model/instrument.js';
import { isTechnicalTestDass21Candidate, TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID } from './dass21-candidate-fixture.js';
import type { InstrumentCatalog, InstrumentPublication, NewInstrumentDraft } from '../domain/repositories/instrument-catalog.js';
import { PreliminaryAssessmentError } from '../domain/model/assessment-errors.js';

/**
 * Restrictive catalog used only by the technical-test router. It makes one
 * exact pending draft available to that composition; the normal catalog and
 * persisted clinical approval fields remain untouched.
 */
export class TechnicalTestDass21Catalog implements InstrumentCatalog {
  constructor(private readonly underlying: InstrumentCatalog) {}

  createDraft(instrument: NewInstrumentDraft): Promise<void> { return this.underlying.createDraft(instrument); }
  updateDraft(instrument: NewInstrumentDraft): Promise<boolean> { return this.underlying.updateDraft(instrument); }
  publishVersion(versionId: InstrumentVersionId, publication: InstrumentPublication): Promise<InstrumentVersion | null> {
    return this.underlying.publishVersion(versionId, publication);
  }

  findVersion(instrumentId: InstrumentId, versionId: InstrumentVersionId): Promise<InstrumentVersion | null> {
    return this.underlying.findVersion(instrumentId, versionId);
  }

  async findAvailableByVersionId(versionId: InstrumentVersionId, at: Date): Promise<InstrumentVersion | null> {
    if (versionId !== TECHNICAL_TEST_DASS21_VERSION_ID) return null;
    const candidate = await this.underlying.findVersion(TECHNICAL_TEST_DASS21_INSTRUMENT_ID, versionId);
    return candidate && isTechnicalTestDass21Candidate(candidate, at) ? candidate : null;
  }

  async listAvailable(limit: number, offset: number, at: Date): Promise<readonly InstrumentVersion[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new PreliminaryAssessmentError('instrument_unavailable');
    }
    if (offset > 0) return [];
    const candidate = await this.findAvailableByVersionId(TECHNICAL_TEST_DASS21_VERSION_ID, at);
    return candidate ? [candidate] : [];
  }
}
