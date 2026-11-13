import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, AuthenticationError, RateLimitError } from 'openai';
import { AiTextGenerationError } from '../../application/ports/ai-text-generator.js';
import { enforceAiTextGenerationLimits } from '../../application/ports/ai-text-generation-policy.js';
import { env } from '../../../../config/env.js';
import { resolveOpenAiConfiguration } from './openai-configuration.js';
export class OpenAiTextGenerationError extends AiTextGenerationError {
    kind;
    incompleteReason;
    failureStage;
    constructor(kind, message, incompleteReason, failureStage) {
        super(kind, message, incompleteReason, failureStage);
        this.kind = kind;
        this.incompleteReason = incompleteReason;
        this.failureStage = failureStage;
        this.name = 'OpenAiTextGenerationError';
    }
}
function generationLimits(configuration) {
    return {
        maxContextMessages: configuration.maxContextMessages,
        maxContextCharacters: configuration.maxContextCharacters,
        maxOutputTokens: configuration.maxOutputTokens,
        defaultOutputTokens: configuration.maxOutputTokens,
    };
}
function resultUsage(response) {
    return response.usage ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
    } : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalidResponse(stage, message = 'Text generation provider returned an invalid response') {
    return new OpenAiTextGenerationError('invalid_response', message, undefined, stage);
}
function eventRecord(value) {
    if (!isRecord(value) || typeof value.type !== 'string' || !value.type)
        throw invalidResponse('event_validation');
    if (typeof value.sequence_number !== 'number' || !Number.isSafeInteger(value.sequence_number) || value.sequence_number < 0) {
        throw invalidResponse('event_validation');
    }
    return { record: value, type: value.type, sequenceNumber: value.sequence_number };
}
function validateOutputItems(value) {
    if (!Array.isArray(value))
        throw invalidResponse('final_text_validation');
    const items = [];
    for (const item of value) {
        if (!isRecord(item) || typeof item.type !== 'string')
            throw invalidResponse('final_text_validation');
        if (item.type !== 'message')
            continue;
        if (item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) {
            throw invalidResponse('final_text_validation');
        }
        for (const part of item.content) {
            if (!isRecord(part) || typeof part.type !== 'string')
                throw invalidResponse('final_text_validation');
            if (part.type === 'output_text') {
                if (typeof part.text !== 'string')
                    throw invalidResponse('final_text_validation');
            }
            else if (part.type === 'refusal') {
                if (typeof part.refusal !== 'string')
                    throw invalidResponse('final_text_validation');
            }
            else {
                throw invalidResponse('final_text_validation');
            }
        }
        items.push(item);
    }
    return items;
}
function extractCompletedText(responseValue) {
    if (!isRecord(responseValue))
        throw invalidResponse('final_text_validation');
    const response = responseValue;
    if (typeof response.status !== 'string')
        throw invalidResponse('final_text_validation');
    if (response.status !== 'completed') {
        const reason = isRecord(response.incomplete_details) && response.incomplete_details.reason === 'max_output_tokens' ? 'max_output_tokens' : 'other';
        throw new OpenAiTextGenerationError('incomplete_response', 'Text generation did not complete successfully', reason, 'final_text_validation');
    }
    if (!Object.hasOwn(response, 'error'))
        throw invalidResponse('final_text_validation');
    if (response.error !== null) {
        throw new OpenAiTextGenerationError('incomplete_response', 'Text generation did not complete successfully', undefined, 'final_text_validation');
    }
    const outputItems = validateOutputItems(response.output);
    let text;
    if (Object.hasOwn(response, 'output_text')) {
        if (typeof response.output_text !== 'string')
            throw invalidResponse('final_text_validation');
        text = response.output_text;
    }
    else {
        text = outputItems.flatMap(item => item.content)
            .filter(part => part.type === 'output_text')
            .map(part => part.text)
            .join('');
    }
    const normalizedText = text.trim();
    if (!normalizedText)
        throw new OpenAiTextGenerationError('empty_response', 'Text generation provider returned empty text', undefined, 'final_text_validation');
    return { text: normalizedText, response };
}
function validateIncompleteReason(responseValue) {
    if (!isRecord(responseValue) || responseValue.status !== 'incomplete')
        throw invalidResponse('event_validation');
    if (!Object.hasOwn(responseValue, 'incomplete_details'))
        throw invalidResponse('event_validation');
    const details = responseValue.incomplete_details;
    if (details === null)
        return 'other';
    if (!isRecord(details))
        throw invalidResponse('event_validation');
    if (details.reason !== undefined && typeof details.reason !== 'string')
        throw invalidResponse('event_validation');
    return details.reason === 'max_output_tokens' ? 'max_output_tokens' : 'other';
}
function validateUsage(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!isRecord(value))
        throw invalidResponse('usage_extraction');
    const inputTokens = value.input_tokens;
    const outputTokens = value.output_tokens;
    const totalTokens = value.total_tokens;
    const tokenCounts = [inputTokens, outputTokens, totalTokens];
    if (tokenCounts.some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) {
        throw invalidResponse('usage_extraction');
    }
    return { inputTokens: inputTokens, outputTokens: outputTokens, totalTokens: totalTokens };
}
function isAbortError(error) {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
async function nextWithAbort(next, signal) {
    if (!signal)
        return next;
    if (signal.aborted)
        throw new OpenAiTextGenerationError('cancelled', 'Text generation was cancelled');
    let removeAbortListener = () => { };
    const aborted = new Promise((_resolve, reject) => {
        const onAbort = () => reject(new OpenAiTextGenerationError('cancelled', 'Text generation was cancelled'));
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    try {
        return await Promise.race([next, aborted]);
    }
    finally {
        removeAbortListener();
    }
}
function mapProviderError(error) {
    if (error instanceof APIConnectionTimeoutError) {
        return new OpenAiTextGenerationError('timeout', 'Text generation provider timed out', undefined, 'provider_iterator');
    }
    if (error instanceof AuthenticationError) {
        return new OpenAiTextGenerationError('authentication', 'Text generation provider rejected its credentials', undefined, 'provider_iterator');
    }
    if (error instanceof RateLimitError) {
        return new OpenAiTextGenerationError('rate_limit', 'Text generation provider rate limit was reached', undefined, 'provider_iterator');
    }
    if (error instanceof APIConnectionError) {
        return new OpenAiTextGenerationError('connection', 'Text generation provider could not be reached', undefined, 'provider_iterator');
    }
    if (error instanceof APIError) {
        return new OpenAiTextGenerationError('provider', 'Text generation provider returned an error', undefined, 'provider_iterator');
    }
    return new OpenAiTextGenerationError('provider', 'Text generation provider failed unexpectedly', undefined, 'provider_iterator');
}
export class OpenAiTextGenerator {
    configuration;
    client;
    constructor(settings = env, client) {
        this.configuration = resolveOpenAiConfiguration(settings);
        this.client = client ?? new OpenAI({
            apiKey: this.configuration.apiKey,
            timeout: this.configuration.timeoutMs,
            maxRetries: 0,
        });
    }
    async generateText(request) {
        const bounded = enforceAiTextGenerationLimits(request, generationLimits(this.configuration));
        let response;
        try {
            response = await this.client.responses.create({
                model: this.configuration.model,
                instructions: bounded.instructions,
                input: bounded.messages.map(({ role, content }) => ({ role, content })),
                max_output_tokens: bounded.maxOutputTokens,
                store: false,
                stream: false,
                tools: [],
            }, { timeout: this.configuration.timeoutMs, maxRetries: 0 });
        }
        catch (error) {
            throw mapProviderError(error);
        }
        if (response.status !== 'completed' || response.error !== null) {
            throw new OpenAiTextGenerationError('invalid_response', 'Text generation provider did not complete the response');
        }
        const text = response.output_text.trim();
        if (!text)
            throw new OpenAiTextGenerationError('invalid_response', 'Text generation provider returned empty text');
        const usage = resultUsage(response);
        return { text, ...(usage ? { usage } : {}) };
    }
    async *streamText(request, signal) {
        const bounded = enforceAiTextGenerationLimits(request, generationLimits(this.configuration));
        if (signal?.aborted)
            throw new OpenAiTextGenerationError('cancelled', 'Text generation was cancelled');
        let stream;
        try {
            stream = await this.client.responses.create({
                model: this.configuration.model,
                instructions: bounded.instructions,
                input: bounded.messages.map(({ role, content }) => ({ role, content })),
                max_output_tokens: bounded.maxOutputTokens,
                store: false,
                stream: true,
                tools: [],
            }, { timeout: this.configuration.timeoutMs, maxRetries: 0, signal });
        }
        catch (error) {
            if (signal?.aborted || error instanceof APIUserAbortError || isAbortError(error)) {
                throw new OpenAiTextGenerationError('cancelled', 'Text generation was cancelled');
            }
            throw mapProviderError(error);
        }
        const iterator = stream[Symbol.asyncIterator]();
        let accumulatedText = '';
        let lastSequenceNumber = -1;
        let completed = false;
        try {
            while (true) {
                let step;
                try {
                    step = await nextWithAbort(Promise.resolve(iterator.next()), signal);
                }
                catch (error) {
                    if (signal?.aborted || error instanceof APIUserAbortError || isAbortError(error)) {
                        throw new OpenAiTextGenerationError('cancelled', 'Text generation was cancelled');
                    }
                    if (error instanceof OpenAiTextGenerationError)
                        throw error;
                    throw mapProviderError(error);
                }
                if (step.done)
                    break;
                const { record: event, type, sequenceNumber } = eventRecord(step.value);
                if (sequenceNumber <= lastSequenceNumber)
                    continue;
                lastSequenceNumber = sequenceNumber;
                if (type === 'response.output_text.delta') {
                    if (typeof event.delta !== 'string')
                        throw invalidResponse('event_validation');
                    if (!event.delta)
                        continue;
                    accumulatedText += event.delta;
                    yield { type: 'delta', text: event.delta };
                    continue;
                }
                if (type === 'response.completed') {
                    if (!Object.hasOwn(event, 'response'))
                        throw invalidResponse('event_validation');
                    const { text, response } = extractCompletedText(event.response);
                    if (accumulatedText.trim() !== text) {
                        throw invalidResponse('final_text_validation', 'Text generation stream did not match its final response');
                    }
                    const usage = validateUsage(response.usage);
                    completed = true;
                    yield { type: 'completed', result: { text, ...(usage ? { usage } : {}) } };
                    return;
                }
                if (type === 'response.failed') {
                    if (!isRecord(event.response) || event.response.status !== 'failed' || !Object.hasOwn(event.response, 'error')) {
                        throw invalidResponse('event_validation');
                    }
                    throw new OpenAiTextGenerationError('provider', 'Text generation provider failed the response');
                }
                if (type === 'response.incomplete') {
                    if (!Object.hasOwn(event, 'response'))
                        throw invalidResponse('event_validation');
                    const reason = validateIncompleteReason(event.response);
                    throw new OpenAiTextGenerationError('incomplete_response', 'Text generation provider returned an incomplete response', reason);
                }
                if (type === 'error') {
                    if (event.code !== undefined && event.code !== null && typeof event.code !== 'string')
                        throw invalidResponse('event_validation');
                    const code = typeof event.code === 'string' ? event.code.toLowerCase() : '';
                    const kind = code.includes('auth') || code.includes('api_key') ? 'authentication'
                        : code.includes('rate_limit') ? 'rate_limit' : 'provider';
                    throw new OpenAiTextGenerationError(kind, 'Text generation provider emitted an error');
                }
            }
        }
        catch (error) {
            if (error instanceof OpenAiTextGenerationError)
                throw error;
            throw invalidResponse('event_validation');
        }
        finally {
            if (!completed) {
                try {
                    await iterator.return?.();
                }
                catch { /* Close best-effort without exposing SDK details. */ }
            }
        }
        if (signal?.aborted)
            throw new OpenAiTextGenerationError('cancelled', 'Text generation was cancelled');
        if (!completed)
            throw new OpenAiTextGenerationError('incomplete_response', 'Text generation stream ended without a completion event');
    }
}
