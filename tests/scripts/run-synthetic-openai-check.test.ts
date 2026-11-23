import { describe, expect, it, vi } from 'vitest';
import {
  runSyntheticOpenAiCheck,
  isSyntheticTokenBudgetValid,
  syntheticTokenBudgetBounds,
  syntheticTokenBudgets,
  syntheticOnlyConfirmationFlag,
  syntheticOpenAiActivationFlag,
  type SyntheticOpenAiCheckAdapters,
} from '../../scripts/run-synthetic-openai-check.js';
import { OpenAiTextGenerationError } from '../../src/modules/conversations/infrastructure/openai/openai-text-generator.js';
import { ConversationSignalExtractionError } from '../../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import type { OpenAiEnvironmentSettings } from '../../src/modules/conversations/infrastructure/openai/openai-configuration.js';

const settings: OpenAiEnvironmentSettings = {
  openAiApiKey: 'synthetic-test-secret',
  openAiModel: 'mock-model',
  openAiTimeoutMs: 1,
  openAiMaxOutputTokens: 1,
  openAiMaxContextMessages: 1,
  openAiMaxContextCharacters: 1,
};
const activationArgs = [syntheticOpenAiActivationFlag, syntheticOnlyConfirmationFlag];
const emptyExtraction = { schemaVersion: '1.0' as const, observations: [], missingInformation: [], clarificationQuestions: [] };

function fakeAdapters(overrides: {
  readonly generation?: () => Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }>;
  readonly extraction?: () => Promise<typeof emptyExtraction>;
} = {}) {
  const generateText = vi.fn(overrides.generation ?? (async () => ({
    text: 'synthetic response should not be printed',
    usage: { inputTokens: 25, outputTokens: 18, totalTokens: 43 },
  })));
  const extract = vi.fn(overrides.extraction ?? (async () => emptyExtraction));
  const createGenerator = vi.fn(() => ({ generateText }));
  const createExtractor = vi.fn(() => ({ extract }));
  const adapters: SyntheticOpenAiCheckAdapters = { createGenerator, createExtractor };
  return { adapters, generateText, extract, createGenerator, createExtractor };
}

describe('manual synthetic OpenAI check', () => {
  it('blocks by default before constructing adapters or making calls', async () => {
    const h = fakeAdapters();
    const writeSummary = vi.fn();
    const summary = await runSyntheticOpenAiCheck({ args: [], settings, adapters: h.adapters, writeSummary });
    expect(summary.generation).toEqual({ status: 'failed', errorKind: 'activation_required' });
    expect(h.createGenerator).not.toHaveBeenCalled();
    expect(h.createExtractor).not.toHaveBeenCalled();
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('requires a separate synthetic-only confirmation flag', async () => {
    const h = fakeAdapters();
    const summary = await runSyntheticOpenAiCheck({
      args: [syntheticOpenAiActivationFlag], settings, adapters: h.adapters, writeSummary: vi.fn(),
    });
    expect(summary.generation).toMatchObject({ status: 'failed', errorKind: 'synthetic_confirmation_required' });
    expect(h.createGenerator).not.toHaveBeenCalled();
  });

  it.each([
    { ...settings, openAiApiKey: undefined, expected: 'api_key_missing' },
    { ...settings, openAiModel: undefined, expected: 'model_missing' },
  ])('fails closed when required configuration is absent ($expected)', async testCase => {
    const h = fakeAdapters();
    const summary = await runSyntheticOpenAiCheck({
      args: activationArgs, settings: testCase, adapters: h.adapters, writeSummary: vi.fn(),
    });
    expect(summary.generation).toMatchObject({ status: 'failed', errorKind: testCase.expected });
    expect(h.createGenerator).not.toHaveBeenCalled();
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('blocks production environment and arbitrary arguments before adapter creation', async () => {
    const h = fakeAdapters();
    const production = await runSyntheticOpenAiCheck({
      args: activationArgs, nodeEnv: 'production', settings, adapters: h.adapters, writeSummary: vi.fn(),
    });
    const extraArgs = await runSyntheticOpenAiCheck({
      args: [...activationArgs, 'message-from-argv'], settings, adapters: h.adapters, writeSummary: vi.fn(),
    });
    expect(production.generation).toMatchObject({ errorKind: 'production_environment_blocked' });
    expect(extraArgs.generation).toMatchObject({ errorKind: 'unexpected_arguments' });
    expect(h.createGenerator).not.toHaveBeenCalled();
  });

  it('makes at most one generation and one extraction request using conservative settings', async () => {
    const h = fakeAdapters();
    const writeSummary = vi.fn();
    const summary = await runSyntheticOpenAiCheck({ args: activationArgs, settings, adapters: h.adapters, writeSummary });
    expect(h.generateText).toHaveBeenCalledTimes(1);
    expect(h.extract).toHaveBeenCalledTimes(1);
    expect(h.createGenerator.mock.calls[0]?.[0]).toMatchObject({
      openAiTimeoutMs: 15_000, openAiMaxOutputTokens: syntheticTokenBudgets.generation, openAiMaxContextMessages: 1, openAiMaxContextCharacters: 1_000,
    });
    expect(h.createExtractor.mock.calls[0]?.[0].openAiMaxOutputTokens).toBe(syntheticTokenBudgets.extraction);
    expect(h.generateText.mock.calls[0]?.[0].maxOutputTokens).toBe(syntheticTokenBudgets.generation);
    expect(h.generateText.mock.calls[0]?.[0].messages[0]?.content).toContain('Soy estudiante universitario');
    expect(h.extract.mock.calls[0]?.[0].messages[0]?.messageId).toBe('550e8400-e29b-41d4-a716-446655440010');
    expect(summary).toMatchObject({
      generation: { status: 'completed' },
      extraction: { status: 'validated' },
    });
    const rendered = writeSummary.mock.calls[0]?.[0] ?? '';
    expect(rendered).toContain('generationUsage');
    expect(rendered).toContain('"totalTokens":43');
    expect(rendered).not.toContain('synthetic-test-secret');
    expect(rendered).not.toContain('synthetic response should not be printed');
    expect(rendered).not.toContain('Soy estudiante universitario');
  });

  it('keeps separate budgets inside hard minimum and maximum bounds', () => {
    expect(syntheticTokenBudgets).toEqual({ generation: 256, extraction: 1_200 });
    expect(isSyntheticTokenBudgetValid(syntheticTokenBudgets)).toBe(true);
    expect(isSyntheticTokenBudgetValid({
      generation: syntheticTokenBudgetBounds.generation.minimum,
      extraction: syntheticTokenBudgetBounds.extraction.minimum,
    })).toBe(true);
    expect(isSyntheticTokenBudgetValid({
      generation: syntheticTokenBudgetBounds.generation.maximum,
      extraction: syntheticTokenBudgetBounds.extraction.maximum,
    })).toBe(true);
    expect(isSyntheticTokenBudgetValid({ generation: 127, extraction: 768 })).toBe(false);
    expect(isSyntheticTokenBudgetValid({ generation: 512, extraction: 2_049 })).toBe(false);
    expect(isSyntheticTokenBudgetValid({ generation: Number.NaN, extraction: 1_200 })).toBe(false);
  });

  it('ignores unsafe or invalid token values supplied in the ambient environment', async () => {
    const h = fakeAdapters();
    const untrustedSettings = { ...settings, openAiMaxOutputTokens: 0, openAiMaxContextCharacters: 9_999_999 };
    await runSyntheticOpenAiCheck({ args: activationArgs, settings: untrustedSettings, adapters: h.adapters, writeSummary: vi.fn() });
    expect(h.createGenerator.mock.calls[0]?.[0]).toMatchObject({
      openAiMaxOutputTokens: syntheticTokenBudgets.generation,
      openAiMaxContextCharacters: 1_000,
    });
    expect(h.createExtractor.mock.calls[0]?.[0].openAiMaxOutputTokens).toBe(syntheticTokenBudgets.extraction);
  });

  it('maps adapter errors to safe categories and never prints provider details or secrets', async () => {
    const privateText = 'private-key-or-provider-payload';
    const h = fakeAdapters({
      generation: async () => { throw new OpenAiTextGenerationError('rate_limit', privateText); },
      extraction: async () => { throw new ConversationSignalExtractionError('provider_unavailable'); },
    });
    const writeSummary = vi.fn();
    const summary = await runSyntheticOpenAiCheck({ args: activationArgs, settings, adapters: h.adapters, writeSummary });
    expect(h.generateText).toHaveBeenCalledTimes(1);
    expect(h.extract).toHaveBeenCalledTimes(1);
    expect(summary.generation).toEqual({ status: 'failed', errorKind: 'rate_limit' });
    expect(summary.extraction).toEqual({ status: 'failed', errorKind: 'provider_error' });
    const rendered = writeSummary.mock.calls[0]?.[0] ?? '';
    expect(rendered).not.toContain(privateText);
    expect(rendered).not.toContain('synthetic-test-secret');
  });

  it('reports only closed incomplete-response diagnostics for troubleshooting', async () => {
    const h = fakeAdapters({
      generation: async () => {
        throw new OpenAiTextGenerationError('incomplete_response', 'private provider payload', 'max_output_tokens', 'final_text_validation');
      },
      extraction: async () => {
        throw new ConversationSignalExtractionError('incomplete_response', 'other');
      },
    });
    const writeSummary = vi.fn();
    const summary = await runSyntheticOpenAiCheck({ args: activationArgs, settings, adapters: h.adapters, writeSummary });
    expect(summary.generation).toEqual({
      status: 'failed', errorKind: 'incomplete_response', failureStage: 'final_text_validation', incompleteReason: 'max_output_tokens',
    });
    expect(summary.extraction).toEqual({ status: 'failed', errorKind: 'incomplete_response', incompleteReason: 'other' });
    const rendered = writeSummary.mock.calls[0]?.[0] ?? '';
    expect(rendered).not.toContain('private provider payload');
    expect(rendered).not.toContain('synthetic-test-secret');
  });
});
