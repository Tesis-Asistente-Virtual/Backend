import { z } from 'zod';
import { assessmentAnswerSchema } from '../../../domain/model/assessment-response.js';

export const assessmentIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const startAssessmentBodySchema = z.object({ instrumentVersionId: z.string().uuid() }).strict();
export const submitAssessmentResponseBodySchema = z.object({
  questionId: z.string().uuid(),
  answer: assessmentAnswerSchema.nullable(),
}).strict();

const queryInteger = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
export const assessmentPaginationSchema = z.object({
  // Fetch one extra row to compute hasMore while keeping the repository cap at 100.
  limit: queryInteger.pipe(z.number().int().min(1).max(99)).optional(),
  offset: queryInteger.pipe(z.number().int().max(1_000_000)).optional(),
}).strict().transform(({ limit, offset }) => ({ limit: limit ?? 20, offset: offset ?? 0 }));

export const emptyAssessmentBodySchema = z.object({}).strict();
