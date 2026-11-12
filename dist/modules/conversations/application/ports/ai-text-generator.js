/** Provider-neutral failure categories; provider messages and identifiers are intentionally omitted. */
export class AiTextGenerationError extends Error {
    kind;
    incompleteReason;
    constructor(kind, message, incompleteReason) {
        super(message);
        this.kind = kind;
        this.incompleteReason = incompleteReason;
        this.name = 'AiTextGenerationError';
    }
}
