import { isTechnicalTestDass21Candidate, createTechnicalTestDass21Draft, TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID } from './dass21-candidate-fixture.js';
import { PreliminaryAssessmentError } from '../domain/model/assessment-errors.js';
/** Inserts one immutable-by-policy test fixture; existing rows are validated and never replaced. */
export async function ensureDass21TechnicalTestDraft(catalog, at = new Date()) {
    let existing = await catalog.findVersion(TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID);
    if (!existing) {
        await catalog.createDraft(createTechnicalTestDass21Draft(new Date(at.getTime() - 60_000)));
        existing = await catalog.findVersion(TECHNICAL_TEST_DASS21_INSTRUMENT_ID, TECHNICAL_TEST_DASS21_VERSION_ID);
    }
    if (!existing || !isTechnicalTestDass21Candidate(existing, at)) {
        throw new PreliminaryAssessmentError('instrument_unavailable');
    }
}
