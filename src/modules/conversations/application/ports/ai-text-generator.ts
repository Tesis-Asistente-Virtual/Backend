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

/** Provider-neutral port. A streaming capability can be added as a separate port without changing this contract. */
export interface AiTextGenerator {
  generateText(request: AiTextGenerationRequest): Promise<AiTextGenerationResult>;
}
