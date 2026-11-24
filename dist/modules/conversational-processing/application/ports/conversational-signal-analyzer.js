import { z } from 'zod';
import { conversationalSignalAnalysisPayloadSchema } from '../../domain/model/conversational-signal-analysis.js';
export const analyzeConversationalSignalsInputSchema = z.object({
    messages: z.array(z.object({ messageId: z.string().uuid(), content: z.string().min(1).max(20_000) }).strict()).min(1).max(20),
}).strict().superRefine((input, context) => {
    if (new Set(input.messages.map(message => message.messageId.toLowerCase())).size !== input.messages.length) {
        context.addIssue({ code: 'custom', path: ['messages'], message: 'Message references must be unique' });
    }
});
export function getSafeConversationalSignalResponseDiagnostics(response, failureStage) {
    const value = typeof response === 'object' && response !== null ? response : {};
    const status = value.status;
    const responseStatus = typeof status === 'string' &&
        ['completed', 'incomplete', 'failed', 'cancelled', 'queued', 'in_progress'].includes(status)
        ? status : undefined;
    const details = typeof value.incomplete_details === 'object' && value.incomplete_details !== null
        ? value.incomplete_details : {};
    const rawReason = details.reason;
    const incompleteReason = typeof rawReason === 'string'
        ? (['max_output_tokens', 'max_messages', 'content_filter', 'steered'].includes(rawReason)
            ? rawReason : 'other')
        : undefined;
    const usage = typeof value.usage === 'object' && value.usage !== null ? value.usage : {};
    const outputDetails = typeof usage.output_tokens_details === 'object' && usage.output_tokens_details !== null
        ? usage.output_tokens_details : {};
    const safeCount = (count) => Number.isSafeInteger(count) && count >= 0 ? count : undefined;
    const inputTokens = safeCount(usage.input_tokens);
    const outputTokens = safeCount(usage.output_tokens);
    const totalTokens = safeCount(usage.total_tokens);
    const reasoningTokens = safeCount(outputDetails.reasoning_tokens);
    return {
        ...(responseStatus ? { responseStatus } : {}),
        ...(incompleteReason ? { incompleteReason } : {}),
        ...(failureStage ? { failureStage } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    };
}
export class ConversationalSignalAnalysisError extends Error {
    kind;
    diagnostics;
    constructor(kind, diagnostics) {
        super('Conversational signal analysis failed');
        this.kind = kind;
        this.diagnostics = diagnostics;
        this.name = 'ConversationalSignalAnalysisError';
    }
}
export function parseConversationalSignalAnalysisPayload(input) {
    const parsed = conversationalSignalAnalysisPayloadSchema.safeParse(input);
    if (!parsed.success)
        throw new ConversationalSignalAnalysisError('invalid_response');
    return parsed.data;
}
