import { z } from 'zod';
import { conversationalSignalAnalysisPayloadSchema, type ConversationalSignalAnalysisPayload } from '../../domain/model/conversational-signal-analysis.js';

export const analyzeConversationalSignalsInputSchema = z.object({
  messages: z.array(z.object({ messageId: z.string().uuid(), content: z.string().min(1).max(20_000) }).strict()).min(1).max(20),
}).strict().superRefine((input, context) => {
  if (new Set(input.messages.map(message => message.messageId.toLowerCase())).size !== input.messages.length) {
    context.addIssue({ code: 'custom', path: ['messages'], message: 'Message references must be unique' });
  }
});

export type AnalyzeConversationalSignalsInput = z.infer<typeof analyzeConversationalSignalsInputSchema>;

export type SafeConversationalSignalResponseStatus = 'completed' | 'incomplete' | 'failed' | 'cancelled' | 'queued' | 'in_progress';
export type SafeConversationalSignalIncompleteReason = 'max_output_tokens' | 'max_messages' | 'content_filter' | 'steered' | 'other';
export type ConversationalSignalResponseFailureStage =
  | 'incomplete_response' | 'provider_response_error' | 'provider_transport_error' | 'transport_timeout'
  | 'cancelled' | 'response_status' | 'empty_output'
  | 'unparsed_output' | 'schema_validation' | 'message_reference_validation';

/** Safe response metadata only; never includes response text, prompts, headers, or provider error messages. */
export interface ConversationalSignalResponseDiagnostics {
  readonly responseStatus?: SafeConversationalSignalResponseStatus;
  readonly incompleteReason?: SafeConversationalSignalIncompleteReason;
  readonly failureStage?: ConversationalSignalResponseFailureStage;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
}

export function getSafeConversationalSignalResponseDiagnostics(
  response: unknown,
  failureStage?: ConversationalSignalResponseFailureStage,
): ConversationalSignalResponseDiagnostics {
  const value = typeof response === 'object' && response !== null ? response as Record<string, unknown> : {};
  const status = value.status;
  const responseStatus = typeof status === 'string' &&
    ['completed', 'incomplete', 'failed', 'cancelled', 'queued', 'in_progress'].includes(status)
    ? status as SafeConversationalSignalResponseStatus : undefined;
  const details = typeof value.incomplete_details === 'object' && value.incomplete_details !== null
    ? value.incomplete_details as Record<string, unknown> : {};
  const rawReason = details.reason;
  const incompleteReason = typeof rawReason === 'string'
    ? (['max_output_tokens', 'max_messages', 'content_filter', 'steered'].includes(rawReason)
      ? rawReason as Exclude<SafeConversationalSignalIncompleteReason, 'other'> : 'other')
    : undefined;
  const usage = typeof value.usage === 'object' && value.usage !== null ? value.usage as Record<string, unknown> : {};
  const outputDetails = typeof usage.output_tokens_details === 'object' && usage.output_tokens_details !== null
    ? usage.output_tokens_details as Record<string, unknown> : {};
  const safeCount = (count: unknown): number | undefined => Number.isSafeInteger(count) && (count as number) >= 0 ? count as number : undefined;
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
  constructor(
    readonly kind: 'invalid_input' | 'invalid_response' | 'provider_unavailable' | 'timeout' | 'cancelled' | 'refusal' | 'incomplete_response',
    readonly diagnostics?: ConversationalSignalResponseDiagnostics,
  ) {
    super('Conversational signal analysis failed');
    this.name = 'ConversationalSignalAnalysisError';
  }
}

export interface ConversationalSignalAnalyzer {
  readonly modelVersion: string;
  analyze(input: AnalyzeConversationalSignalsInput, signal?: AbortSignal): Promise<ConversationalSignalAnalysisPayload>;
}

export function parseConversationalSignalAnalysisPayload(input: unknown): ConversationalSignalAnalysisPayload {
  const parsed = conversationalSignalAnalysisPayloadSchema.safeParse(input);
  if (!parsed.success) throw new ConversationalSignalAnalysisError('invalid_response');
  return parsed.data;
}

