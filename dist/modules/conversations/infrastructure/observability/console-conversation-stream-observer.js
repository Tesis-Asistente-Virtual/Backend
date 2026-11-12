/** Emits only the closed, sanitized observation shape. Never pass provider errors or user content here. */
export class ConsoleConversationStreamObserver {
    recordFailure(observation) {
        console.warn('conversation_stream_failure', {
            operation: observation.operation,
            stage: observation.stage,
            errorKind: observation.errorKind,
            ...(observation.incompleteReason ? { incompleteReason: observation.incompleteReason } : {}),
        });
    }
}
