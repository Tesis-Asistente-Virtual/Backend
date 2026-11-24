import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ZodError } from 'zod';
import { env } from '../../../../config/env.js';
import { resolveOpenAiConfiguration, type OpenAiEnvironmentSettings } from '../../../conversations/infrastructure/openai/openai-configuration.js';
import { wellbeingRecommendationInstructions } from '../../application/recommendation-instructions.js';
import { RecommendationGenerationError, recommendationGenerationOutputSchema, type RecommendationGenerator } from '../../application/ports/recommendation-generator.js';

type ResponsesClient = Pick<OpenAI['responses'], 'parse'>;
const responseFormat = zodTextFormat(recommendationGenerationOutputSchema, 'wellbeing_recommendations');

function safeError(error: unknown): RecommendationGenerationError {
  if (error instanceof RecommendationGenerationError) return error;
  if (error instanceof APIConnectionTimeoutError) return new RecommendationGenerationError('timeout');
  if (error instanceof APIUserAbortError || (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')) {
    return new RecommendationGenerationError('cancelled');
  }
  if (error instanceof ZodError || error instanceof SyntaxError) return new RecommendationGenerationError('invalid_response');
  if (error instanceof APIConnectionError || error instanceof RateLimitError || error instanceof APIError) return new RecommendationGenerationError('unavailable');
  return new RecommendationGenerationError('unavailable');
}

export class OpenAiRecommendationGenerator implements RecommendationGenerator {
  readonly modelVersion: string;
  private readonly client: ResponsesClient;
  private readonly timeoutMs: number;

  constructor(settings: OpenAiEnvironmentSettings = env, client?: ResponsesClient) {
    const config = resolveOpenAiConfiguration(settings);
    this.modelVersion = config.model;
    this.timeoutMs = config.timeoutMs;
    this.client = client ?? new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 0 }).responses;
  }

  async generate(input: Parameters<RecommendationGenerator['generate']>[0], signal?: AbortSignal) {
    if (signal?.aborted) throw new RecommendationGenerationError('cancelled');
    let response: unknown;
    try {
      response = await this.client.parse({
        model: this.modelVersion,
        instructions: wellbeingRecommendationInstructions,
        input: [{ role: 'user', content: JSON.stringify(input) }],
        max_output_tokens: 900,
        store: false,
        tools: [],
        text: { format: responseFormat },
      }, { timeout: this.timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) });
    } catch (error) {
      throw safeError(error);
    }
    if (signal?.aborted) throw new RecommendationGenerationError('cancelled');
    if (typeof response !== 'object' || response === null || !('status' in response)) throw new RecommendationGenerationError('invalid_response');
    if (response.status === 'incomplete') throw new RecommendationGenerationError('incomplete_response');
    if (response.status !== 'completed' || !('error' in response) || response.error !== null ||
      !('output_parsed' in response) || response.output_parsed === null || response.output_parsed === undefined) {
      throw new RecommendationGenerationError('invalid_response');
    }
    const parsed = recommendationGenerationOutputSchema.safeParse(response.output_parsed);
    if (!parsed.success) throw new RecommendationGenerationError('invalid_response');
    return parsed.data;
  }
}
