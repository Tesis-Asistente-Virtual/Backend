import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { ZodError } from 'zod';
import { env } from '../../../../config/env.js';
import { signalExtractionInstructions } from '../../application/signal-extraction-instructions.js';
import {
  ConversationSignalExtractionError,
  parseConversationSignalExtraction,
  parseExtractConversationSignalsInput,
  type ConversationSignalExtractor,
  type ConversationSignalExtractionFailureKind,
} from '../../application/ports/conversation-signal-extractor.js';
import { conversationSignalExtractionSchema } from '../../domain/model/signal-observation.js';
import { enforceAiTextGenerationLimits } from '../../../conversations/application/ports/ai-text-generation-policy.js';
import { resolveOpenAiConfiguration, type OpenAiConfiguration, type OpenAiEnvironmentSettings } from '../../../conversations/infrastructure/openai/openai-configuration.js';

type OpenAiResponsesClient = Pick<OpenAI['responses'], 'parse'>;
type UnknownRecord = Record<string, unknown>;

const structuredOutputFormat = zodTextFormat(conversationSignalExtractionSchema, 'conversation_signal_extraction');

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => isRecord(item) && item.type === 'message' && Array.isArray(item.content)
    && item.content.some((part: unknown) => isRecord(part) && part.type === 'refusal'));
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function safeError(kind: ConversationSignalExtractionFailureKind, incompleteReason?: 'max_output_tokens' | 'other'): ConversationSignalExtractionError {
  return new ConversationSignalExtractionError(kind, incompleteReason);
}

function mapProviderError(error: unknown): ConversationSignalExtractionError {
  if (error instanceof ConversationSignalExtractionError) return error;
  if (error instanceof APIConnectionTimeoutError) return safeError('timeout');
  if (error instanceof APIUserAbortError || isAbortError(error)) return safeError('cancelled');
  if (error instanceof ZodError || error instanceof SyntaxError) return safeError('invalid_response');
  if (error instanceof APIConnectionError || error instanceof RateLimitError || error instanceof APIError) {
    return safeError('provider_unavailable');
  }
  return safeError('provider_unavailable');
}

function generationLimits(configuration: OpenAiConfiguration) {
  return {
    maxContextMessages: configuration.maxContextMessages,
    maxContextCharacters: configuration.maxContextCharacters,
    maxOutputTokens: configuration.maxOutputTokens,
    defaultOutputTokens: configuration.maxOutputTokens,
  };
}

export class OpenAiConversationSignalExtractor implements ConversationSignalExtractor {
  private readonly configuration: OpenAiConfiguration;
  private readonly client: OpenAiResponsesClient;

  constructor(settings: OpenAiEnvironmentSettings = env, client?: OpenAiResponsesClient) {
    this.configuration = resolveOpenAiConfiguration(settings);
    this.client = client ?? new OpenAI({
      apiKey: this.configuration.apiKey,
      timeout: this.configuration.timeoutMs,
      maxRetries: 0,
    }).responses;
  }

  async extract(inputValue: Parameters<ConversationSignalExtractor['extract']>[0], signal?: AbortSignal) {
    const input = parseExtractConversationSignalsInput(inputValue);
    if (signal?.aborted) throw safeError('cancelled');

    const messagesWithReferences = input.messages.map(({ messageId, role, content }) => ({
      role,
      content: `[messageId:${messageId}]\n${content}`,
    }));
    let boundedMessages: ReturnType<typeof enforceAiTextGenerationLimits>['messages'];
    try {
      boundedMessages = enforceAiTextGenerationLimits({
        instructions: signalExtractionInstructions,
        messages: messagesWithReferences,
      }, generationLimits(this.configuration)).messages;
    } catch {
      throw safeError('invalid_input');
    }

    let response: unknown;
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
    } catch (error) {
      throw mapProviderError(error);
    }

    if (!isRecord(response)) throw safeError('invalid_response');
    if (containsRefusal(response.output)) throw safeError('refusal');
    if (response.status === 'incomplete') {
      const reason = isRecord(response.incomplete_details) && response.incomplete_details.reason === 'max_output_tokens'
        ? 'max_output_tokens' : 'other';
      throw safeError('incomplete_response', reason);
    }
    if (response.status === 'failed') throw safeError('provider_unavailable');
    if (signal?.aborted) throw safeError('cancelled');
    if (response.status !== 'completed' || !Object.hasOwn(response, 'error') || response.error !== null) {
      throw safeError('invalid_response');
    }
    if (!Array.isArray(response.output) || !response.output.some(item =>
      isRecord(item) && item.type === 'message' && Array.isArray(item.content)
      && item.content.some((part: unknown) => isRecord(part) && part.type === 'output_text' && typeof part.text === 'string' && part.text.trim().length > 0),
    )) throw safeError('invalid_response');
    if (!Object.hasOwn(response, 'output_parsed') || response.output_parsed === null || response.output_parsed === undefined) {
      throw safeError('invalid_response');
    }

    const extraction = parseConversationSignalExtraction(response.output_parsed);
    const suppliedMessageIds = new Set(input.messages.map(message => message.messageId));
    const hasUnknownSourceReference = extraction.observations.some(observation =>
      observation.sourceMessageIds.some(messageId => !suppliedMessageIds.has(messageId)),
    );
    if (hasUnknownSourceReference) throw safeError('invalid_response');
    return extraction;
  }
}
