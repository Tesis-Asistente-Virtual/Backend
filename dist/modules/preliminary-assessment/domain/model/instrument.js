import { z } from 'zod';
import { PreliminaryAssessmentError } from './assessment-errors.js';
const optionSchema = z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(300),
}).strict();
const questionBase = {
    id: z.string().uuid(),
    prompt: z.string().trim().min(1).max(1000),
    required: z.boolean(),
};
export const instrumentQuestionSchema = z.discriminatedUnion('responseType', [
    z.object({ ...questionBase, responseType: z.literal('text'), maxLength: z.number().int().min(1).max(2000) }).strict(),
    z.object({ ...questionBase, responseType: z.literal('single_choice'), options: z.array(optionSchema).min(1).max(50) }).strict(),
    z.object({ ...questionBase, responseType: z.literal('multiple_choice'), options: z.array(optionSchema).min(1).max(50), maxSelections: z.number().int().min(1).max(50) }).strict(),
    z.object({ ...questionBase, responseType: z.literal('number'), minimum: z.number().finite(), maximum: z.number().finite() }).strict()
        .refine(question => question.minimum <= question.maximum, 'Question minimum must not exceed maximum'),
    z.object({ ...questionBase, responseType: z.literal('boolean') }).strict(),
]);
export const instrumentVersionSchema = z.object({
    instrumentId: z.string().uuid(),
    instrumentVersionId: z.string().uuid(),
    version: z.string().trim().min(1).max(40),
    effectiveAt: z.date(),
    status: z.enum(['draft', 'approved', 'retired']),
    questions: z.array(instrumentQuestionSchema).max(200),
    approval: z.object({
        status: z.enum(['pending', 'approved', 'rejected']),
        approvedAt: z.date().nullable(),
        approvalReference: z.string().trim().min(1).max(300).nullable(),
    }).strict(),
    license: z.object({
        status: z.enum(['not_reviewed', 'authorized', 'restricted', 'not_applicable']),
        reference: z.string().trim().min(1).max(300).nullable(),
    }).strict(),
}).strict().superRefine((instrument, context) => {
    const ids = instrument.questions.map(question => question.id);
    if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', path: ['questions'], message: 'Question identifiers must be unique within an instrument version' });
    }
    for (const question of instrument.questions) {
        if ('options' in question) {
            const optionIds = question.options.map(option => option.id);
            if (new Set(optionIds).size !== optionIds.length) {
                context.addIssue({ code: 'custom', path: ['questions'], message: 'Option identifiers must be unique within a question' });
            }
            if (question.responseType === 'multiple_choice' && question.maxSelections > question.options.length) {
                context.addIssue({ code: 'custom', path: ['questions'], message: 'Maximum selections cannot exceed available options' });
            }
        }
    }
    if (instrument.status === 'approved' && instrument.questions.length === 0) {
        context.addIssue({ code: 'custom', path: ['questions'], message: 'An approved instrument must define at least one question' });
    }
    if (instrument.status === 'approved' && (instrument.approval.status !== 'approved' || !instrument.approval.approvedAt ||
        !instrument.approval.approvalReference ||
        !['authorized', 'not_applicable'].includes(instrument.license.status))) {
        context.addIssue({ code: 'custom', path: ['approval'], message: 'An approved instrument needs approval and license metadata' });
    }
});
export function parseInstrumentVersion(value) {
    const parsed = instrumentVersionSchema.safeParse(value);
    if (!parsed.success)
        throw new PreliminaryAssessmentError('instrument_unavailable');
    return parsed.data;
}
export function isInstrumentAvailable(instrument) {
    return instrument.status === 'approved' && instrument.approval.status === 'approved' &&
        instrument.approval.approvedAt !== null && instrument.approval.approvalReference !== null &&
        (instrument.license.status === 'authorized' || instrument.license.status === 'not_applicable') &&
        instrument.questions.length > 0;
}
