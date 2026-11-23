import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import { env } from '../src/config/env.js';
import { assistantInstructions } from '../src/modules/conversations/application/assistant-instructions.js';
import { OpenAiTextGenerationError, OpenAiTextGenerator } from '../src/modules/conversations/infrastructure/openai/openai-text-generator.js';
import type { AiTextGenerator, AiTextGenerationFailureStage, AiTextGenerationResult, AiTextIncompleteReason } from '../src/modules/conversations/application/ports/ai-text-generator.js';
import { ConversationSignalExtractionError, type ConversationSignalExtractor } from '../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import { conversationSignalExtractionSchema } from '../src/modules/conversational-processing/domain/model/signal-observation.js';
import { OpenAiConversationSignalExtractor } from '../src/modules/conversational-processing/infrastructure/openai/openai-conversation-signal-extractor.js';
import type { OpenAiEnvironmentSettings } from '../src/modules/conversations/infrastructure/openai/openai-configuration.js';

export const syntheticOpenAiActivationFlag = '--run-synthetic-openai-check';
export const syntheticOnlyConfirmationFlag = '--confirm-synthetic-only';

export const syntheticTestMessage = 'Soy estudiante universitario y últimamente me cuesta organizarme para los exámenes. Me gustaría conversar sobre cómo manejar mejor mi tiempo.';

const syntheticMessageId = '550e8400-e29b-41d4-a716-446655440010';
export const syntheticTokenBudgets = {
  generation: 256,
  extraction: 1_200,
} as const;
export const syntheticTokenBudgetBounds = {
  generation: { minimum: 128, maximum: 512 },
  extraction: { minimum: 768, maximum: 2_048 },
} as const;

const syntheticSettings = {
  openAiTimeoutMs: 15_000,
  openAiMaxContextMessages: 1,
  openAiMaxContextCharacters: 1_000,
} as const;

export type SyntheticOpenAiCheckErrorKind =
  | 'activation_required'
  | 'synthetic_confirmation_required'
  | 'unexpected_arguments'
  | 'production_environment_blocked'
  | 'api_key_missing'
  | 'model_missing'
  | 'configuration_error'
  | 'invalid_response'
  | 'provider_error'
  | 'timeout'
  | 'rate_limit'
  | 'authentication'
  | 'connection'
  | 'cancelled'
  | 'incomplete_response'
  | 'empty_response'
  | 'refusal'
  | 'validation_error'
  | 'unexpected_error';

export function isSyntheticTokenBudgetValid(budgets: { readonly generation: number; readonly extraction: number }): boolean {
  return Number.isSafeInteger(budgets.generation)
    && budgets.generation >= syntheticTokenBudgetBounds.generation.minimum
    && budgets.generation <= syntheticTokenBudgetBounds.generation.maximum
    && Number.isSafeInteger(budgets.extraction)
    && budgets.extraction >= syntheticTokenBudgetBounds.extraction.minimum
    && budgets.extraction <= syntheticTokenBudgetBounds.extraction.maximum;
}

export class SyntheticOpenAiCheckConfigurationError extends Error {
  constructor(readonly kind: Extract<SyntheticOpenAiCheckErrorKind,
    'activation_required' | 'synthetic_confirmation_required' | 'unexpected_arguments' |
    'production_environment_blocked' | 'api_key_missing' | 'model_missing' | 'configuration_error'>) {
    super('Synthetic OpenAI check is not enabled or is not configured');
    this.name = 'SyntheticOpenAiCheckConfigurationError';
  }
}

export interface SyntheticOpenAiCheckAdapters {
  readonly createGenerator: (settings: OpenAiEnvironmentSettings) => Pick<AiTextGenerator, 'generateText'>;
  readonly createExtractor: (settings: OpenAiEnvironmentSettings) => Pick<ConversationSignalExtractor, 'extract'>;
}

export interface SyntheticOpenAiCheckSummary {
  readonly operation: 'synthetic_openai_check';
  readonly syntheticOnly: true;
  readonly generation: { readonly status: 'completed' } | {
    readonly status: 'failed'; readonly errorKind: SyntheticOpenAiCheckErrorKind;
    readonly failureStage?: AiTextGenerationFailureStage; readonly incompleteReason?: AiTextIncompleteReason;
  };
  readonly extraction: { readonly status: 'validated' }
    | { readonly status: 'failed'; readonly errorKind: SyntheticOpenAiCheckErrorKind; readonly incompleteReason?: 'max_output_tokens' | 'other' };
}

const productionAdapters: SyntheticOpenAiCheckAdapters = {
  createGenerator: settings => new OpenAiTextGenerator(settings),
  createExtractor: settings => new OpenAiConversationSignalExtractor(settings),
};

function resolveSafeSettings(args: readonly string[], nodeEnv: string | undefined, source: OpenAiEnvironmentSettings): OpenAiEnvironmentSettings {
  if (!args.includes(syntheticOpenAiActivationFlag)) throw new SyntheticOpenAiCheckConfigurationError('activation_required');
  if (!args.includes(syntheticOnlyConfirmationFlag)) throw new SyntheticOpenAiCheckConfigurationError('synthetic_confirmation_required');
  if (args.length !== 2 || new Set(args).size !== 2) throw new SyntheticOpenAiCheckConfigurationError('unexpected_arguments');
  if (nodeEnv === 'production') throw new SyntheticOpenAiCheckConfigurationError('production_environment_blocked');
  const apiKey = source.openAiApiKey?.trim();
  if (!apiKey) throw new SyntheticOpenAiCheckConfigurationError('api_key_missing');
  const model = source.openAiModel?.trim();
  if (!model) throw new SyntheticOpenAiCheckConfigurationError('model_missing');
  if (!isSyntheticTokenBudgetValid(syntheticTokenBudgets)) throw new SyntheticOpenAiCheckConfigurationError('configuration_error');
  return {
    openAiApiKey: apiKey,
    openAiModel: model,
    ...syntheticSettings,
    openAiMaxOutputTokens: syntheticTokenBudgets.generation,
  };
}

function safeErrorKind(error: unknown): SyntheticOpenAiCheckErrorKind {
  if (error instanceof SyntheticOpenAiCheckConfigurationError) return error.kind;
  if (error instanceof ZodError) return 'validation_error';
  if (error instanceof OpenAiTextGenerationError) {
    switch (error.kind) {
      case 'timeout': case 'rate_limit': case 'authentication': case 'connection': case 'cancelled':
      case 'incomplete_response': case 'empty_response': case 'invalid_response': return error.kind;
      case 'provider': return 'provider_error';
    }
  }
  if (error instanceof ConversationSignalExtractionError) {
    switch (error.kind) {
      case 'timeout': case 'cancelled': case 'incomplete_response': case 'invalid_response':
      case 'refusal': return error.kind;
      case 'provider_unavailable': return 'provider_error';
      case 'invalid_input': return 'validation_error';
    }
  }
  return 'unexpected_error';
}

function safeGenerationFailure(error: unknown): Extract<SyntheticOpenAiCheckSummary['generation'], { status: 'failed' }> {
  if (error instanceof OpenAiTextGenerationError) {
    return {
      status: 'failed', errorKind: safeErrorKind(error),
      ...(error.failureStage ? { failureStage: error.failureStage } : {}),
      ...(error.incompleteReason ? { incompleteReason: error.incompleteReason } : {}),
    };
  }
  return { status: 'failed', errorKind: safeErrorKind(error) };
}

function safeExtractionFailure(error: unknown): Extract<SyntheticOpenAiCheckSummary['extraction'], { status: 'failed' }> {
  if (error instanceof ConversationSignalExtractionError) {
    return {
      status: 'failed', errorKind: safeErrorKind(error),
      ...(error.incompleteReason ? { incompleteReason: error.incompleteReason } : {}),
    };
  }
  return { status: 'failed', errorKind: safeErrorKind(error) };
}

function safeUsage(result: AiTextGenerationResult): Record<string, number> | undefined {
  const usage = result.usage;
  if (!usage) return undefined;
  const counts = {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
  };
  return Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0) ? counts : undefined;
}

export async function runSyntheticOpenAiCheck(options: {
  readonly args: readonly string[];
  readonly nodeEnv?: string;
  readonly settings: OpenAiEnvironmentSettings;
  readonly adapters?: SyntheticOpenAiCheckAdapters;
  readonly writeSummary: (line: string) => void;
}): Promise<SyntheticOpenAiCheckSummary> {
  let settings: OpenAiEnvironmentSettings;
  try {
    settings = resolveSafeSettings(options.args, options.nodeEnv, options.settings);
  } catch (error) {
    const kind = safeErrorKind(error);
    const summary: SyntheticOpenAiCheckSummary = {
      operation: 'synthetic_openai_check', syntheticOnly: true,
      generation: { status: 'failed', errorKind: kind },
      extraction: { status: 'failed', errorKind: kind },
    };
    options.writeSummary(JSON.stringify(summary));
    return summary;
  }

  let generator: Pick<AiTextGenerator, 'generateText'>;
  let extractor: Pick<ConversationSignalExtractor, 'extract'>;
  try {
    const adapters = options.adapters ?? productionAdapters;
    generator = adapters.createGenerator(settings);
    extractor = adapters.createExtractor({ ...settings, openAiMaxOutputTokens: syntheticTokenBudgets.extraction });
  } catch (error) {
    const summary: SyntheticOpenAiCheckSummary = {
      operation: 'synthetic_openai_check', syntheticOnly: true,
      generation: { status: 'failed', errorKind: safeErrorKind(error) === 'unexpected_error' ? 'configuration_error' : safeErrorKind(error) },
      extraction: { status: 'failed', errorKind: safeErrorKind(error) === 'unexpected_error' ? 'configuration_error' : safeErrorKind(error) },
    };
    options.writeSummary(JSON.stringify(summary));
    return summary;
  }

  let generation: SyntheticOpenAiCheckSummary['generation'];
  let usage: Record<string, number> | undefined;
  try {
    const result = await generator.generateText({
      instructions: assistantInstructions,
      messages: [{ role: 'user', content: syntheticTestMessage }],
      maxOutputTokens: syntheticTokenBudgets.generation,
    });
    if (!result.text.trim()) throw new OpenAiTextGenerationError('invalid_response', 'Invalid synthetic generation result');
    generation = { status: 'completed' };
    usage = safeUsage(result);
  } catch (error) {
    generation = safeGenerationFailure(error);
  }

  let extraction: SyntheticOpenAiCheckSummary['extraction'];
  try {
    conversationSignalExtractionSchema.parse(await extractor.extract({
      messages: [{ messageId: syntheticMessageId, role: 'user', content: syntheticTestMessage }],
    }));
    extraction = { status: 'validated' };
  } catch (error) {
    extraction = safeExtractionFailure(error);
  }

  const summary: SyntheticOpenAiCheckSummary = { operation: 'synthetic_openai_check', syntheticOnly: true, generation, extraction };
  options.writeSummary(JSON.stringify({ ...summary, ...(usage ? { generationUsage: usage } : {}) }));
  return summary;
}

async function main(): Promise<void> {
  const summary = await runSyntheticOpenAiCheck({
    args: process.argv.slice(2),
    nodeEnv: process.env.NODE_ENV,
    settings: env,
    writeSummary: line => console.log(line),
  });
  if (summary.generation.status !== 'completed' || summary.extraction.status !== 'validated') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => {
    console.log(JSON.stringify({
      operation: 'synthetic_openai_check', syntheticOnly: true,
      generation: { status: 'failed', errorKind: 'unexpected_error' },
      extraction: { status: 'failed', errorKind: 'unexpected_error' },
    } satisfies SyntheticOpenAiCheckSummary));
    process.exitCode = 1;
  });
}
