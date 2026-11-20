import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ZodError } from 'zod';
import { env } from '../../../../config/env.js';
import { signalExtractionInstructions } from '../../application/signal-extraction-instructions.js';
import { ConversationSignalExtractionError, parseConversationSignalExtraction, parseExtractConversationSignalsInput, } from '../../application/ports/conversation-signal-extractor.js';
import { conversationSignalExtractionSchema } from '../../domain/model/signal-observation.js';
import { enforceAiTextGenerationLimits } from '../../../conversations/application/ports/ai-text-generation-policy.js';
import { resolveOpenAiConfiguration } from '../../../conversations/infrastructure/openai/openai-configuration.js';
const structuredOutputFormat = zodTextFormat(conversationSignalExtractionSchema, 'conversation_signal_extraction');
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function containsRefusal(output) {
    if (!Array.isArray(output))
        return false;
    return output.some((item) => isRecord(item) && item.type === 'message' && Array.isArray(item.content)
        && item.content.some((part) => isRecord(part) && part.type === 'refusal'));
}
function isAbortError(error) {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
function safeError(kind) {
    return new ConversationSignalExtractionError(kind);
}
function mapProviderError(error) {
    if (error instanceof ConversationSignalExtractionError)
        return error;
    if (error instanceof APIConnectionTimeoutError)
        return safeError('timeout');
    if (error instanceof APIUserAbortError || isAbortError(error))
        return safeError('cancelled');
    if (error instanceof ZodError || error instanceof SyntaxError)
        return safeError('invalid_response');
    if (error instanceof APIConnectionError || error instanceof RateLimitError || error instanceof APIError) {
        return safeError('provider_unavailable');
    }
    return safeError('provider_unavailable');
}
function generationLimits(configuration) {
    return {
        maxContextMessages: configuration.maxContextMessages,
        maxContextCharacters: configuration.maxContextCharacters,
        maxOutputTokens: configuration.maxOutputTokens,
        defaultOutputTokens: configuration.maxOutputTokens,
    };
}
export class OpenAiConversationSignalExtractor {
    configuration;
    client;
    constructor(settings = env, client) {
        this.configuration = resolveOpenAiConfiguration(settings);
        this.client = client ?? new OpenAI({
            apiKey: this.configuration.apiKey,
            timeout: this.configuration.timeoutMs,
            maxRetries: 0,
        }).responses;
    }
    async extract(inputValue, signal) {
        const input = parseExtractConversationSignalsInput(inputValue);
        if (signal?.aborted)
            throw safeError('cancelled');
        const messagesWithReferences = input.messages.map(({ messageId, role, content }) => ({
            role,
            content: `[messageId:${messageId}]\n${content}`,
        }));
        let boundedMessages;
        try {
            boundedMessages = enforceAiTextGenerationLimits({
                instructions: signalExtractionInstructions,
                messages: messagesWithReferences,
            }, generationLimits(this.configuration)).messages;
        }
        catch {
            throw safeError('invalid_input');
        }
        let response;
        try {
            response = await this.client.parse({
                model: this.configuration.model,
                instructions: signalExtractionInstructions,
                input: boundedMessages.map(message => ({ ...message })),
                max_output_tokens: this.configuration.maxOutputTokens,
                store: false,
                tools: [],
                text: { format: structuredOutputFormat },
            }, {
                timeout: this.configuration.timeoutMs,
                maxRetries: 0,
                ...(signal ? { signal } : {}),
            });
        }
        catch (error) {
            throw mapProviderError(error);
        }
        if (!isRecord(response))
            throw safeError('invalid_response');
        if (containsRefusal(response.output))
            throw safeError('refusal');
        if (response.status === 'incomplete')
            throw safeError('incomplete_response');
        if (response.status === 'failed')
            throw safeError('provider_unavailable');
        if (signal?.aborted)
            throw safeError('cancelled');
        if (response.status !== 'completed' || !Object.hasOwn(response, 'error') || response.error !== null) {
            throw safeError('invalid_response');
        }
        if (!Array.isArray(response.output) || !response.output.some(item => isRecord(item) && item.type === 'message' && Array.isArray(item.content)
            && item.content.some((part) => isRecord(part) && part.type === 'output_text' && typeof part.text === 'string' && part.text.trim().length > 0)))
            throw safeError('invalid_response');
        if (!Object.hasOwn(response, 'output_parsed') || response.output_parsed === null || response.output_parsed === undefined) {
            throw safeError('invalid_response');
        }
        const extraction = parseConversationSignalExtraction(response.output_parsed);
        const suppliedMessageIds = new Set(input.messages.map(message => message.messageId));
        const hasUnknownSourceReference = extraction.observations.some(observation => observation.sourceMessageIds.some(messageId => !suppliedMessageIds.has(messageId)));
        if (hasUnknownSourceReference)
            throw safeError('invalid_response');
        return extraction;
    }
}
