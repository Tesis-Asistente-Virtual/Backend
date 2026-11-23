import { z } from 'zod';
import { isInstrumentAvailable } from './instrument.js';
import { Dass21ScoringError } from './dass21-scoring.js';
const mapEntrySchema = z.object({ questionId: z.string().uuid(), itemNumber: z.number().int().min(1).max(21) }).strict();
export const dass21QuestionMappingSchema = z.object({
    schemaVersion: z.literal('1.0'),
    mappingId: z.string().uuid(),
    instrumentCode: z.literal('DASS-21'),
    instrumentId: z.string().uuid(),
    instrumentVersionId: z.string().uuid(),
    mappingVersion: z.string().trim().min(1).max(40),
    status: z.enum(['draft', 'frozen']),
    entries: z.array(mapEntrySchema).length(21),
    createdAt: z.date(),
    frozenAt: z.date().nullable(),
}).strict().superRefine((mapping, context) => {
    const questionIds = mapping.entries.map(entry => entry.questionId);
    const itemNumbers = mapping.entries.map(entry => entry.itemNumber);
    const itemNumberSet = new Set(itemNumbers);
    if (new Set(questionIds).size !== questionIds.length) {
        context.addIssue({ code: 'custom', path: ['entries'], message: 'Question references must be unique' });
    }
    if (itemNumberSet.size !== itemNumbers.length || Array.from({ length: 21 }, (_, index) => index + 1).some(item => !itemNumberSet.has(item))) {
        context.addIssue({ code: 'custom', path: ['entries'], message: 'Mapping must cover each DASS-21 item exactly once' });
    }
    if ((mapping.status === 'frozen') !== (mapping.frozenAt !== null)) {
        context.addIssue({ code: 'custom', path: ['frozenAt'], message: 'Frozen state and timestamp must match' });
    }
});
/** Validates a UUID-to-item map against one specific approved instrument version. */
export function validateDass21QuestionMapping(mappingValue, instrument) {
    const parsed = dass21QuestionMappingSchema.safeParse(mappingValue);
    if (!parsed.success || !isInstrumentAvailable(instrument))
        throw new Dass21ScoringError('invalid_instrument');
    const mapping = parsed.data;
    if (mapping.instrumentId !== instrument.instrumentId || mapping.instrumentVersionId !== instrument.instrumentVersionId) {
        throw new Dass21ScoringError('instrument_version_mismatch');
    }
    const questions = new Map(instrument.questions.map(question => [question.id, question]));
    if (questions.size !== 21 || mapping.entries.length !== questions.size)
        throw new Dass21ScoringError('invalid_instrument');
    for (const entry of mapping.entries) {
        const question = questions.get(entry.questionId);
        if (!question || question.required !== true || question.displayOrder !== entry.itemNumber) {
            throw new Dass21ScoringError('invalid_instrument');
        }
        const numericQuestion = question.responseType === 'number' && question.minimum === 0 && question.maximum === 3;
        const choiceQuestion = question.responseType === 'single_choice' && question.options.length === 4 &&
            question.options.every(option => option.scoringValue !== undefined) &&
            new Set(question.options.map(option => option.scoringValue)).size === 4 &&
            [0, 1, 2, 3].every(value => question.options.some(option => option.scoringValue === value));
        if (!numericQuestion && !choiceQuestion)
            throw new Dass21ScoringError('invalid_instrument');
    }
    return { ...mapping, entries: [...mapping.entries].sort((left, right) => left.itemNumber - right.itemNumber) };
}
export function freezeDass21QuestionMapping(mapping, at) {
    if (mapping.status !== 'draft' || Number.isNaN(at.getTime()) || at < mapping.createdAt) {
        throw new Dass21ScoringError('invalid_instrument');
    }
    return dass21QuestionMappingSchema.parse({ ...mapping, status: 'frozen', frozenAt: at });
}
