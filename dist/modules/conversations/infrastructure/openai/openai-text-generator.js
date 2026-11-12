import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, AuthenticationError, RateLimitError } from 'openai';
import { AiTextGenerationError } from '../../application/ports/ai-text-generator.js';
import { enforceAiTextGenerationLimits } from '../../application/ports/ai-text-generation-policy.js';
import { env } from '../../../../config/env.js';
import { resolveOpenAiConfiguration } from './openai-configuration.js';
export class OpenAiTextGenerationError extends AiTextGenerationError {
    kind;
    incompleteReason;
    constructor(kind, message, incompleteReason) {
        super(kind, message, incompleteReason);
        this.kind = kind;
        this.incompleteReason = incompleteReason;
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
        return new OpenAiTextGenerationError('timeout', 'Text generation provider timed out');
    }
    if (error instanceof AuthenticationError) {
        return new OpenAiTextGenerationError('authentication', 'Text generation provider rejected its credentials');
    }
    if (error instanceof RateLimitError) {
        return new OpenAiTextGenerationError('rate_limit', 'Text generation provider rate limit was reached');
    }
    if (error instanceof APIConnectionError) {
        return new OpenAiTextGenerationError('connection', 'Text generation provider could not be reached');
    }
    if (error instanceof APIError) {
        return new OpenAiTextGenerationError('provider', 'Text generation provider returned an error');
    }
    return new OpenAiTextGenerationError('provider', 'Text generation provider failed unexpectedly');
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
                const event = step.value;
                if (event.sequence_number <= lastSequenceNumber)
                    continue;
                lastSequenceNumber = event.sequence_number;
                if (event.type === 'response.output_text.delta') {
                    if (!event.delta)
                        continue;
                    accumulatedText += event.delta;
                    yield { type: 'delta', text: event.delta };
                    continue;
                }
                if (event.type === 'response.completed') {
                    if (event.response.status !== 'completed' || event.response.error !== null) {
                        const reason = event.response.incomplete_details?.reason === 'max_output_tokens' ? 'max_output_tokens' : 'other';
                        throw new OpenAiTextGenerationError('incomplete_response', 'Text generation did not complete successfully', reason);
                    }
                    const text = event.response.output_text.trim();
                    if (!text)
                        throw new OpenAiTextGenerationError('empty_response', 'Text generation provider returned empty text');
                    if (accumulatedText.trim() !== text) {
                        throw new OpenAiTextGenerationError('invalid_response', 'Text generation stream did not match its final response');
                    }
                    completed = true;
                    const usage = resultUsage(event.response);
                    yield { type: 'completed', result: { text, ...(usage ? { usage } : {}) } };
                    return;
                }
                if (event.type === 'response.failed') {
                    throw new OpenAiTextGenerationError('provider', 'Text generation provider failed the response');
                }
                if (event.type === 'response.incomplete') {
                    const reason = event.response.incomplete_details?.reason === 'max_output_tokens' ? 'max_output_tokens' : 'other';
                    throw new OpenAiTextGenerationError('incomplete_response', 'Text generation provider returned an incomplete response', reason);
                }
                if (event.type === 'error') {
                    const code = event.code?.toLowerCase() ?? '';
                    const kind = code.includes('auth') || code.includes('api_key') ? 'authentication'
                        : code.includes('rate_limit') ? 'rate_limit' : 'provider';
                    throw new OpenAiTextGenerationError(kind, 'Text generation provider emitted an error');
                }
            }
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
