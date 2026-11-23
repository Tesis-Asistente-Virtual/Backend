import { z } from 'zod';
export const monitoringEnrollmentIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const monitoringSessionConversationParamsSchema = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }).strict();
export const startMonitoringEnrollmentBodySchema = z.object({ explicitOptIn: z.literal(true) }).strict();
export const associateMonitoringConversationBodySchema = z.object({
    conversationId: z.string().uuid(),
    explicitAssociation: z.literal(true),
}).strict();
export const emptyMonitoringBodySchema = z.object({}).strict();
const queryInteger = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
export const monitoringPaginationSchema = z.object({
    limit: queryInteger.pipe(z.number().int().min(1).max(99)).optional(),
    offset: queryInteger.pipe(z.number().int().max(1_000_000)).optional(),
}).strict().transform(({ limit, offset }) => ({ limit: limit ?? 20, offset: offset ?? 0 }));
