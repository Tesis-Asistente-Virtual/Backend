import { z } from 'zod';
import { conversationSignalExtractionSchema, type ConversationSignalExtraction } from '../../domain/model/signal-observation.js';

export const authorizedSignalMessageSchema = z.object({
  messageId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(5000),
}).strict();

/** Minimal message data supplied only after the caller has checked authorization and purpose consent. */
export const extractConversationSignalsInputSchema = z.object({
  messages: z.array(authorizedSignalMessageSchema).min(1).max(20),
}).strict();
export type AuthorizedSignalMessage = z.infer<typeof authorizedSignalMessageSchema>;
export type ExtractConversationSignalsInput = z.infer<typeof extractConversationSignalsInputSchema>;

export type ConversationSignalExtractionFailureKind =
  | 'invalid_input'
  | 'invalid_response'
  | 'provider_unavailable'
  | 'timeout'
  | 'refusal'
  | 'incomplete_response'
  | 'cancelled';

/** Provider-neutral and safe for application handling; never carries prompts or provider payloads. */
export class ConversationSignalExtractionError extends Error {
  constructor(readonly kind: ConversationSignalExtractionFailureKind) {
    super('Conversation signal extraction failed');
    this.name = 'ConversationSignalExtractionError';
  }
}

/**
 * Port for tentative structured extraction only. Callers must separately authorize the account,
 * verify `structured_signal_extraction` consent, and limit messages to the approved context.
 * Its result is not a diagnosis, a score, a priority, or a safety assessment.
 */
export interface ConversationSignalExtractor {
  extract(input: ExtractConversationSignalsInput, signal?: AbortSignal): Promise<ConversationSignalExtraction>;
}

export function parseExtractConversationSignalsInput(input: unknown): ExtractConversationSignalsInput {
  const parsed = extractConversationSignalsInputSchema.safeParse(input);
  if (!parsed.success) throw new ConversationSignalExtractionError('invalid_input');
  return parsed.data;
}

/** Shared parser for provider or test implementations; unknown fields are rejected by the schema. */
export function parseConversationSignalExtraction(input: unknown): ConversationSignalExtraction {
  const parsed = conversationSignalExtractionSchema.safeParse(input);
  if (!parsed.success) throw new ConversationSignalExtractionError('invalid_response');
  return parsed.data;
}
