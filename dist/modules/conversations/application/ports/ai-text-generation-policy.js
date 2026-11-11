export class AiTextRequestLimitError extends Error {
    constructor(message) { super(message); this.name = 'AiTextRequestLimitError'; }
}
/** Rejects oversized context instead of silently truncating or dropping student messages. */
export function enforceAiTextGenerationLimits(request, limits) {
    if (request.messages.length > limits.maxContextMessages) {
        throw new AiTextRequestLimitError('Conversation context exceeds the configured message limit');
    }
    const contextCharacters = request.messages.reduce((total, message) => total + message.content.length, 0);
    if (contextCharacters > limits.maxContextCharacters) {
        throw new AiTextRequestLimitError('Conversation context exceeds the configured character limit');
    }
    if (!request.instructions.trim())
        throw new AiTextRequestLimitError('Assistant instructions must not be empty');
    const maxOutputTokens = request.maxOutputTokens ?? limits.defaultOutputTokens;
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > limits.maxOutputTokens) {
        throw new AiTextRequestLimitError('Requested output token limit is invalid');
    }
    return { ...request, maxOutputTokens, messages: [...request.messages] };
}
