import { z } from 'zod';
import type { InstrumentQuestion, InstrumentVersion } from './instrument.js';
import { PreliminaryAssessmentError } from './assessment-errors.js';

export const assessmentAnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('single_choice'), optionId: z.string().trim().min(1).max(80) }).strict(),
  z.object({ type: z.literal('multiple_choice'), optionIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50).refine(values => new Set(values).size === values.length) }).strict(),
  z.object({ type: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('boolean'), value: z.boolean() }).strict(),
]);

export const assessmentResponseSchema = z.object({
  assessmentId: z.string().uuid(),
  instrumentVersionId: z.string().uuid(),
  questionId: z.string().uuid(),
  status: z.enum(['pending', 'answered']),
  answer: assessmentAnswerSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict().superRefine((response, context) => {
  if ((response.status === 'pending') !== (response.answer === null)) {
    context.addIssue({ code: 'custom', path: ['answer'], message: 'Pending responses have no answer; answered responses must have one' });
  }
  if (response.createdAt > response.updatedAt) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Response timestamps are inconsistent' });
  }
});

export type AssessmentAnswer = z.infer<typeof assessmentAnswerSchema>;
export type AssessmentResponse = z.infer<typeof assessmentResponseSchema>;

function answerMatchesQuestion(answer: AssessmentAnswer, question: InstrumentQuestion): boolean {
  if (answer.type !== question.responseType) return false;
  if (answer.type === 'text' && question.responseType === 'text') return answer.value.length <= question.maxLength;
  if (answer.type === 'single_choice' && question.responseType === 'single_choice') {
    return question.options.some(option => option.id === answer.optionId);
  }
  if (answer.type === 'multiple_choice' && question.responseType === 'multiple_choice') {
    return answer.optionIds.length <= question.maxSelections && answer.optionIds.every(id => question.options.some(option => option.id === id));
  }
  if (answer.type === 'number' && question.responseType === 'number') return answer.value >= question.minimum && answer.value <= question.maximum;
  return answer.type === 'boolean' && question.responseType === 'boolean';
}

export function validateResponseForInstrument(responseValue: unknown, instrument: InstrumentVersion): AssessmentResponse {
  const parsed = assessmentResponseSchema.safeParse(responseValue);
  if (!parsed.success) throw new PreliminaryAssessmentError('invalid_response');
  if (parsed.data.instrumentVersionId !== instrument.instrumentVersionId) {
    throw new PreliminaryAssessmentError('instrument_version_mismatch');
  }
  const question = instrument.questions.find(candidate => candidate.id === parsed.data.questionId);
  if (!question || (parsed.data.answer !== null && !answerMatchesQuestion(parsed.data.answer, question))) {
    throw new PreliminaryAssessmentError('invalid_response');
  }
  return parsed.data;
}

/** One current answer per question/version; replacing it edits the answer rather than appending a duplicate. */
export function upsertAssessmentResponse(
  responses: readonly AssessmentResponse[],
  response: AssessmentResponse,
): AssessmentResponse[] {
  const matching = responses.filter(item => item.assessmentId === response.assessmentId && item.questionId === response.questionId);
  if (matching.length > 1) throw new PreliminaryAssessmentError('duplicate_response');
  const remaining = responses.filter(item => !(item.assessmentId === response.assessmentId && item.questionId === response.questionId));
  const previous = matching[0];
  return [...remaining, previous ? { ...response, createdAt: previous.createdAt } : response];
}
