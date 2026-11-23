import { isTechnicalTestDass21Candidate, TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID } from './dass21-candidate-fixture.js';
import { PreliminaryAssessmentError } from '../domain/model/assessment-errors.js';
/**
 * Restrictive catalog used only by the technical-test router. It makes one
 * exact pending draft available to that composition; the normal catalog and
 * persisted clinical approval fields remain untouched.
 */
export class TechnicalTestDass21Catalog {
    underlying;
    constructor(underlying) {
        this.underlying = underlying;
    }
    createDraft(instrument) { return this.underlying.createDraft(instrument); }
    updateDraft(instrument) { return this.underlying.updateDraft(instrument); }
    publishVersion(versionId, publication) {
        return this.underlying.publishVersion(versionId, publication);
    }
    findVersion(instrumentId, versionId) {
        return this.underlying.findVersion(instrumentId, versionId);
    }
    async findAvailableByVersionId(versionId, at) {
        if (versionId !== TECHNICAL_TEST_DASS21_VERSION_ID)
            return null;
        const candidate = await this.underlying.findVersion(TECHNICAL_TEST_DASS21_INSTRUMENT_ID, versionId);
        return candidate && isTechnicalTestDass21Candidate(candidate, at) ? candidate : null;
    }
    async listAvailable(limit, offset, at) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
            throw new PreliminaryAssessmentError('instrument_unavailable');
        }
        if (offset > 0)
            return [];
        const candidate = await this.findAvailableByVersionId(TECHNICAL_TEST_DASS21_VERSION_ID, at);
        return candidate ? [candidate] : [];
    }
}
