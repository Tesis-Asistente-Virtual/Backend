/** Provider-neutral failure categories; provider messages and identifiers are intentionally omitted. */
export class AiTextGenerationError extends Error {
    kind;
    incompleteReason;
    failureStage;
    constructor(kind, message, incompleteReason, failureStage) {
        super(message);
        this.kind = kind;
        this.incompleteReason = incompleteReason;
        this.failureStage = failureStage;
        this.name = 'AiTextGenerationError';
    }
}
