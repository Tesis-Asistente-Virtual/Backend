export class OpenAiConfigurationError extends Error {
    constructor(message) { super(message); this.name = 'OpenAiConfigurationError'; }
}
export function resolveOpenAiConfiguration(settings) {
    const apiKey = settings.openAiApiKey?.trim();
    const model = settings.openAiModel?.trim();
    if (!apiKey)
        throw new OpenAiConfigurationError('OPENAI_API_KEY is required to use the OpenAI adapter');
    if (!model)
        throw new OpenAiConfigurationError('OPENAI_MODEL is required to use the OpenAI adapter');
    return {
        apiKey,
        model,
        timeoutMs: settings.openAiTimeoutMs,
        maxOutputTokens: settings.openAiMaxOutputTokens,
        maxContextMessages: settings.openAiMaxContextMessages,
        maxContextCharacters: settings.openAiMaxContextCharacters,
    };
}
