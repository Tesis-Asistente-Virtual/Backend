export type AiTextRole = 'user' | 'assistant';

export interface AiTextContextMessage {
  readonly role: AiTextRole;
  readonly content: string;
}

export interface AiTextGenerationRequest {
  readonly instructions: string;
  readonly messages: readonly AiTextContextMessage[];
  readonly maxOutputTokens?: number;
}

export interface AiTextUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiTextGenerationResult {
  readonly text: string;
  readonly usage?: AiTextUsage;
}

export type AiTextGenerationFailureKind =
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'connection'
  | 'invalid_response'
  | 'empty_response'
  | 'incomplete_response'
  | 'cancelled'
  | 'provider';

export type AiTextIncompleteReason = 'max_output_tokens' | 'other';
export type AiTextGenerationFailureStage =
  | 'provider_iterator'
  | 'event_validation'
  | 'final_text_validation'
  | 'usage_extraction';

/** Provider-neutral failure categories; provider messages and identifiers are intentionally omitted. */
export class AiTextGenerationError extends Error {
  constructor(
    readonly kind: AiTextGenerationFailureKind,
    message: string,
    readonly incompleteReason?: AiTextIncompleteReason,
    readonly failureStage?: AiTextGenerationFailureStage,
  ) {
    super(message);
    this.name = 'AiTextGenerationError';
  }
}

export type AiTextStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'completed'; readonly result: AiTextGenerationResult };

/**
 * `streamText` yields zero or more text deltas followed by exactly one completed event.
 * Provider errors, incomplete streams, and cancellation reject iteration with safe typed errors;
 * an iterator ending without `completed` is never treated as success.
 */
export interface AiTextGenerator {
  generateText(request: AiTextGenerationRequest): Promise<AiTextGenerationResult>;
  streamText(request: AiTextGenerationRequest, signal?: AbortSignal): AsyncIterable<AiTextStreamEvent>;
}
