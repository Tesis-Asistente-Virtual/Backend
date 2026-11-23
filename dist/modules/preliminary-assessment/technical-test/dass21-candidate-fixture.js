import { DASS21_SPANISH_CANDIDATE } from '../domain/model/dass21-spanish-candidate.js';
import { isInstrumentAvailable } from '../domain/model/instrument.js';
export const TECHNICAL_TEST_DASS21_INSTRUMENT_ID = '00000000-0000-4000-8000-000000008a91';
export const TECHNICAL_TEST_DASS21_VERSION_ID = '00000000-0000-4000-8000-000000008a92';
export const TECHNICAL_TEST_DASS21_VERSION = 'dass21-spanish-candidate-1.1';
export function technicalTestDass21QuestionId(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 21)
        throw new RangeError('DASS-21 candidate item index is out of range');
    return `00000000-0000-4000-8000-${(0x8a9300 + index).toString(16).padStart(12, '0')}`;
}
/**
 * Persisted only as a draft with pending approval and unreviewed license.
 * These rows are a technical-test projection of the source candidate, not an
 * approval or publication of the instrument.
 */
export function createTechnicalTestDass21Draft(effectiveAt = new Date(Date.now() - 60_000)) {
    return {
        instrumentId: TECHNICAL_TEST_DASS21_INSTRUMENT_ID,
        instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
        version: TECHNICAL_TEST_DASS21_VERSION,
        effectiveAt,
        status: 'draft',
        approval: { status: 'pending', approvedAt: null, approvalReference: null },
        license: { status: 'not_reviewed', reference: null },
        questions: DASS21_SPANISH_CANDIDATE.items.map((item, index) => ({
            id: technicalTestDass21QuestionId(index),
            prompt: item.promptOriginal,
            responseType: 'single_choice',
            required: true,
            displayOrder: item.displayOrder,
            options: item.responseOptions.map((option, optionIndex) => ({
                id: `dass21-candidate-option-${optionIndex}`,
                label: option.label,
                scoringValue: option.scoringValue,
            })),
        })),
    };
}
/** Exact content and status gate used only by the isolated technical-test composition. */
export const isTechnicalTestDass21Candidate = (value, at) => {
    const expected = createTechnicalTestDass21Draft(value.effectiveAt);
    if (value.instrumentId !== expected.instrumentId || value.instrumentVersionId !== expected.instrumentVersionId ||
        value.version !== expected.version || value.status !== 'draft' || value.effectiveAt > at ||
        value.approval.status !== 'pending' || value.approval.approvedAt !== null || value.approval.approvalReference !== null ||
        value.license.status !== 'not_reviewed' || value.license.reference !== null || value.questions.length !== 21)
        return false;
    return value.questions.every((question, index) => {
        const expectedQuestion = expected.questions[index];
        if (!expectedQuestion || question.id !== expectedQuestion.id || question.displayOrder !== expectedQuestion.displayOrder ||
            question.prompt !== expectedQuestion.prompt || question.required !== true || question.responseType !== 'single_choice' ||
            expectedQuestion.responseType !== 'single_choice' || question.options.length !== 4)
            return false;
        return question.options.every((option, optionIndex) => {
            const expectedOption = expectedQuestion.options[optionIndex];
            return !!expectedOption && option.id === expectedOption.id && option.label === expectedOption.label &&
                option.scoringValue === expectedOption.scoringValue;
        });
    });
};
/** Defence-in-depth assertion that normal approved-only availability rejects the draft fixture. */
export function isAvailableInNormalCatalog(instrument) {
    return isInstrumentAvailable(instrument);
}
