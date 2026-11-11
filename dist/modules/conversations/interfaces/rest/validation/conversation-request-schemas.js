import { z } from 'zod';
export const createConversationRequestSchema = z.object({
    title: z.string().max(150).nullable().optional(),
}).strict();
export const sendConversationMessageRequestSchema = z.object({
    content: z.string().trim().min(1).max(5_000),
}).strict();
export const conversationIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const nonNegativeIntegerQuery = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
export const paginationQuerySchema = z.object({
    limit: nonNegativeIntegerQuery.pipe(z.number().int().min(1).max(100)).optional(),
    offset: nonNegativeIntegerQuery.pipe(z.number().int().max(1_000_000)).optional(),
}).strict().transform(({ limit, offset }) => ({ limit: limit ?? 20, offset: offset ?? 0 }));
