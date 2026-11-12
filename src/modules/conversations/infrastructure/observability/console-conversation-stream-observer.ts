import type { ConversationStreamFailureObservation, ConversationStreamObserver } from '../../application/ports/conversation-stream-observer.js';

/** Emits only the closed, sanitized observation shape. Never pass provider errors or user content here. */
export class ConsoleConversationStreamObserver implements ConversationStreamObserver {
  recordFailure(observation: ConversationStreamFailureObservation): void {
    console.warn('conversation_stream_failure', {
      operation: observation.operation,
      stage: observation.stage,
      errorKind: observation.errorKind,
      ...(observation.incompleteReason ? { incompleteReason: observation.incompleteReason } : {}),
    });
  }
}
