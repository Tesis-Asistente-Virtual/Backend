import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError, RateLimitError } from 'openai';
import type { AiTextGenerationRequest, AiTextGenerationResult, AiTextGenerator } from '../../application/ports/ai-text-generator.js';
import { enforceAiTextGenerationLimits } from '../../application/ports/ai-text-generation-policy.js';
import { env } from '../../../../config/env.js';
import { resolveOpenAiConfiguration, type OpenAiConfiguration, type OpenAiEnvironmentSettings } from './openai-configuration.js';

export type OpenAiTextGenerationFailureKind = 'authentication' | 'rate_limit' | 'timeout' | 'connection' | 'invalid_response' | 'provider';

export class OpenAiTextGenerationError extends Error {
  constructor(readonly kind: OpenAiTextGenerationFailureKind, message: string) {
    super(message);
    this.name = 'OpenAiTextGenerationError';
  }
}

type OpenAiClient = Pick<OpenAI, 'responses'>;

function mapProviderError(error: unknown): OpenAiTextGenerationError {
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

export class OpenAiTextGenerator implements AiTextGenerator {
  private readonly configuration: OpenAiConfiguration;
  private readonly client: OpenAiClient;

  constructor(settings: OpenAiEnvironmentSettings = env, client?: OpenAiClient) {
    this.configuration = resolveOpenAiConfiguration(settings);
    this.client = client ?? new OpenAI({
      apiKey: this.configuration.apiKey,
      timeout: this.configuration.timeoutMs,
      maxRetries: 0,
    });
  }

  async generateText(request: AiTextGenerationRequest): Promise<AiTextGenerationResult> {
    const bounded = enforceAiTextGenerationLimits(request, {
      maxContextMessages: this.configuration.maxContextMessages,
      maxContextCharacters: this.configuration.maxContextCharacters,
      maxOutputTokens: this.configuration.maxOutputTokens,
      defaultOutputTokens: this.configuration.maxOutputTokens,
    });

    let response: OpenAI.Responses.Response;
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
    } catch (error) {
      throw mapProviderError(error);
    }

    if (response.status !== 'completed' || response.error !== null) {
      throw new OpenAiTextGenerationError('invalid_response', 'Text generation provider did not complete the response');
    }
    const text = response.output_text.trim();
    if (!text) throw new OpenAiTextGenerationError('invalid_response', 'Text generation provider returned empty text');
    return {
      text,
      ...(response.usage ? {
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        },
      } : {}),
    };
  }
}
