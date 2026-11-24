import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ZodError } from 'zod';
import { env } from '../../../../config/env.js';
import { conversationalSignalAnalysisInstructions } from '../../application/conversational-signal-analysis-instructions.js';
import {
  ConversationalSignalAnalysisError,
  analyzeConversationalSignalsInputSchema,
  getSafeConversationalSignalResponseDiagnostics,
  type ConversationalSignalAnalyzer,
} from '../../application/ports/conversational-signal-analyzer.js';
import { conversationalSignalAnalysisPayloadSchema } from '../../domain/model/conversational-signal-analysis.js';
import { enforceAiTextGenerationLimits } from '../../../conversations/application/ports/ai-text-generation-policy.js';
import { resolveOpenAiConfiguration, type OpenAiEnvironmentSettings } from '../../../conversations/infrastructure/openai/openai-configuration.js';

type ResponsesClient = Pick<OpenAI['responses'], 'parse'>;
const outputFormat = zodTextFormat(conversationalSignalAnalysisPayloadSchema, 'conversational_signal_analysis');

function hasOutputText(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || !('output' in response) || !Array.isArray(response.output)) return false;
  return response.output.some((item: unknown) => typeof item === 'object' && item !== null && 'type' in item && item.type === 'message' &&
    'content' in item && Array.isArray(item.content) && item.content.some((part: unknown) => typeof part === 'object' && part !== null &&
      'type' in part && part.type === 'output_text' && 'text' in part && typeof part.text === 'string' && part.text.trim().length > 0));
}

function isRefusal(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || !('output' in response) || !Array.isArray(response.output)) return false;
  return response.output.some((item: unknown) => typeof item === 'object' && item !== null && 'content' in item && Array.isArray(item.content) &&
    item.content.some((part: unknown) => typeof part === 'object' && part !== null && 'type' in part && part.type === 'refusal'));
}

function mapError(error: unknown): ConversationalSignalAnalysisError {
  if (error instanceof ConversationalSignalAnalysisError) return error;
  if (error instanceof APIConnectionTimeoutError) return new ConversationalSignalAnalysisError('timeout', { failureStage: 'transport_timeout' });
  if (error instanceof APIUserAbortError || (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')) {
    return new ConversationalSignalAnalysisError('cancelled', { failureStage: 'cancelled' });
  }
  if (error instanceof ZodError) return new ConversationalSignalAnalysisError('invalid_response', { failureStage: 'schema_validation' });
  if (error instanceof SyntaxError) return new ConversationalSignalAnalysisError('invalid_response', { failureStage: 'unparsed_output' });
  if (error instanceof APIConnectionError || error instanceof RateLimitError || error instanceof APIError) {
    return new ConversationalSignalAnalysisError('provider_unavailable', { failureStage: 'provider_transport_error' });
  }
  return new ConversationalSignalAnalysisError('provider_unavailable');
}

export class OpenAiConversationalSignalAnalyzer implements ConversationalSignalAnalyzer {
  readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly maxContextMessages: number;
  private readonly maxContextCharacters: number;
  private readonly client: ResponsesClient;

  constructor(settings: OpenAiEnvironmentSettings = env, client?: ResponsesClient) {
    const configuration = resolveOpenAiConfiguration(settings);
    this.modelVersion = configuration.model;
    this.timeoutMs = configuration.timeoutMs;
    this.maxOutputTokens = configuration.maxOutputTokens;
    this.maxContextMessages = configuration.maxContextMessages;
    this.maxContextCharacters = configuration.maxContextCharacters;
    this.client = client ?? new OpenAI({ apiKey: configuration.apiKey, timeout: configuration.timeoutMs, maxRetries: 0 }).responses;
  }

  async analyze(inputValue: Parameters<ConversationalSignalAnalyzer['analyze']>[0], signal?: AbortSignal) {
    const parsed = analyzeConversationalSignalsInputSchema.safeParse(inputValue);
    if (!parsed.success || signal?.aborted) throw new ConversationalSignalAnalysisError(parsed.success ? 'cancelled' : 'invalid_input');
    const messages = parsed.data.messages.map(({ messageId, content }) => ({ role: 'user' as const, content: `[messageId:${messageId}]\n${content}` }));
    let bounded;
    try {
      bounded = enforceAiTextGenerationLimits({ instructions: conversationalSignalAnalysisInstructions, messages }, {
        maxContextMessages: this.maxContextMessages, maxContextCharacters: this.maxContextCharacters,
        maxOutputTokens: this.maxOutputTokens, defaultOutputTokens: this.maxOutputTokens,
      }).messages;
    } catch {
      throw new ConversationalSignalAnalysisError('invalid_input');
    }

    let response: unknown;
    try {
      response = await this.client.parse({
        model: this.modelVersion,
        instructions: conversationalSignalAnalysisInstructions,
        input: bounded.map(message => ({ ...message })),
        max_output_tokens: this.maxOutputTokens,
        store: false,
        tools: [],
        text: { format: outputFormat },
      }, { timeout: this.timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) });
    } catch (error) {
      throw mapError(error);
    }

    if (signal?.aborted) throw new ConversationalSignalAnalysisError('cancelled');
    if (typeof response !== 'object' || response === null) {
      throw new ConversationalSignalAnalysisError('invalid_response', { failureStage: 'response_status' });
    }
    if (isRefusal(response)) throw new ConversationalSignalAnalysisError('refusal');
    if ('status' in response && response.status === 'incomplete') {
      throw new ConversationalSignalAnalysisError('incomplete_response',
        getSafeConversationalSignalResponseDiagnostics(response, 'incomplete_response'));
    }
    if ('status' in response && response.status === 'failed') {
      throw new ConversationalSignalAnalysisError('provider_unavailable',
        getSafeConversationalSignalResponseDiagnostics(response, 'provider_response_error'));
    }
    if (!('status' in response) || response.status !== 'completed') {
      throw new ConversationalSignalAnalysisError('invalid_response',
        getSafeConversationalSignalResponseDiagnostics(response, 'response_status'));
    }
    if (!('error' in response) || response.error !== null) {
      throw new ConversationalSignalAnalysisError('provider_unavailable',
        getSafeConversationalSignalResponseDiagnostics(response, 'provider_response_error'));
    }
    if (!hasOutputText(response)) {
      throw new ConversationalSignalAnalysisError('invalid_response',
        getSafeConversationalSignalResponseDiagnostics(response, 'empty_output'));
    }
    if (!('output_parsed' in response) || response.output_parsed === null || response.output_parsed === undefined) {
      throw new ConversationalSignalAnalysisError('invalid_response',
        getSafeConversationalSignalResponseDiagnostics(response, 'unparsed_output'));
    }
    const parsedPayload = conversationalSignalAnalysisPayloadSchema.safeParse(response.output_parsed);
    if (!parsedPayload.success) {
      throw new ConversationalSignalAnalysisError('invalid_response',
        getSafeConversationalSignalResponseDiagnostics(response, 'schema_validation'));
    }
    const result = parsedPayload.data;
    const allowedIds = new Set(parsed.data.messages.map(message => message.messageId.toLowerCase()));
    if (Object.values(result.signals).some(dimension => dimension.evidence.some(item => !allowedIds.has(item.messageId.toLowerCase())))) {
      throw new ConversationalSignalAnalysisError('invalid_response',
        getSafeConversationalSignalResponseDiagnostics(response, 'message_reference_validation'));
    }
    return result;
  }
}
