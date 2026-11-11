import type { AiTextGenerationRequest } from './ai-text-generator.js';

export interface AiTextGenerationLimits {
  readonly maxContextMessages: number;
  readonly maxContextCharacters: number;
  readonly maxOutputTokens: number;
  readonly defaultOutputTokens: number;
}

export interface BoundedAiTextGenerationRequest extends AiTextGenerationRequest {
  readonly maxOutputTokens: number;
}

export class AiTextRequestLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'AiTextRequestLimitError'; }
}

/** Rejects oversized context instead of silently truncating or dropping student messages. */
export function enforceAiTextGenerationLimits(
  request: AiTextGenerationRequest,
  limits: AiTextGenerationLimits,
): BoundedAiTextGenerationRequest {
  if (request.messages.length > limits.maxContextMessages) {
    throw new AiTextRequestLimitError('Conversation context exceeds the configured message limit');
  }
  const contextCharacters = request.messages.reduce((total, message) => total + message.content.length, 0);
  if (contextCharacters > limits.maxContextCharacters) {
    throw new AiTextRequestLimitError('Conversation context exceeds the configured character limit');
  }
  if (!request.instructions.trim()) throw new AiTextRequestLimitError('Assistant instructions must not be empty');
  const maxOutputTokens = request.maxOutputTokens ?? limits.defaultOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > limits.maxOutputTokens) {
    throw new AiTextRequestLimitError('Requested output token limit is invalid');
  }
  return { ...request, maxOutputTokens, messages: [...request.messages] };
}
