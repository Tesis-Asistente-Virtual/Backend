import type { AiTextGenerationFailureKind, AiTextIncompleteReason } from './ai-text-generator.js';

export type ConversationStreamFailureStage =
  | 'context_read'
  | 'provider_stream'
  | 'delta_write'
  | 'assistant_persistence'
  | 'failure_persistence'
  | 'completion_write'
  | 'cancelled';

export type ConversationStreamObservedErrorKind = AiTextGenerationFailureKind | 'transport' | 'database' | 'unknown';
export type ConversationStreamIncompleteReason = AiTextIncompleteReason;

export interface ConversationStreamFailureObservation {
  readonly operation: 'conversation_stream';
  readonly stage: ConversationStreamFailureStage;
  readonly errorKind: ConversationStreamObservedErrorKind;
  readonly incompleteReason?: ConversationStreamIncompleteReason;
}

export interface ConversationStreamObserver {
  recordFailure(observation: ConversationStreamFailureObservation): void;
}

export const noOpConversationStreamObserver: ConversationStreamObserver = {
  recordFailure: () => {},
};
