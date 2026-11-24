import { describe, expect, it, vi } from 'vitest';
import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { ZodError } from 'zod';
import type { RequestOptions } from 'openai/internal/request-options.js';
import {
  areConversationalSignalEvidenceReferencesValid,
  createConversationalSignalAnalysis,
  conversationalSignalAnalysisPayloadSchema,
  type ConversationalSignalAnalysisPayload,
} from '../../../src/modules/conversational-processing/domain/model/conversational-signal-analysis.js';
import {
  AnalyzeAuthorizedConversationSignals,
  ConversationalSignalAnalysisConsentRequired,
  ConversationalSignalAnalysisUnavailable,
  GetMyConversationalSignalAnalysis,
} from '../../../src/modules/conversational-processing/application/internal/command-services/analyze-authorized-conversation-signals.js';
import {
  ConversationalSignalAnalysisError,
  type ConversationalSignalAnalyzer,
} from '../../../src/modules/conversational-processing/application/ports/conversational-signal-analyzer.js';
import type { ConsentPurposeChecker } from '../../../src/modules/consent/application/ports/consent-purpose-checker.js';
import { OpenAiConversationalSignalAnalyzer } from '../../../src/modules/conversational-processing/infrastructure/openai/openai-conversational-signal-analyzer.js';
import type { OpenAiEnvironmentSettings } from '../../../src/modules/conversations/infrastructure/openai/openai-configuration.js';
import { syntheticSignalFixtures } from '../../../scripts/conversational-signals-openai-fixtures.js';

const ownerId = '2d1f07b8-2194-4cf8-99cf-3274c3ea62f5';
const conversationId = '9f2e750c-c63b-43b3-9bd1-000000000001';
const userMessageId = '9f2e750c-c63b-43b3-9bd1-000000000002';
const assistantMessageId = '9f2e750c-c63b-43b3-9bd1-000000000003';
const now = new Date('2026-11-24T12:00:00.000Z');

function payload(messageId = userMessageId): ConversationalSignalAnalysisPayload {
  const observed = {
    level: 'low' as const,
    evidenceCount: 1,
    indicators: ['worry' as const],
    summary: 'La persona menciona preocupación por sus exámenes.',
    observedPattern: 'single_report' as const,
    evidence: [{ paraphrase: 'Menciona preocupación por sus exámenes.', messageId }],
  };
  const insufficient = {
    level: 'insufficient_evidence' as const,
    evidenceCount: 0,
    indicators: [] as [],
    summary: 'La selección no aporta evidencia textual suficiente para esta dimensión.',
    observedPattern: 'insufficient_evidence' as const,
    evidence: [] as [],
  };
  return {
    signals: { depression: insufficient, anxiety: observed, stress: insufficient },
    overallSummary: 'En los mensajes seleccionados se menciona preocupación por exámenes; la cobertura es limitada.',
  };
}

describe('conversational signal analysis contract', () => {
  it('accepts reference-free abstention and validates every reference that is present', () => {
    const allAbstained = {
      signals: {
        depression: payload().signals.depression,
        anxiety: payload().signals.depression,
        stress: payload().signals.depression,
      },
      overallSummary: 'La selección no aporta evidencia textual suficiente para estas dimensiones.',
    };
    expect(conversationalSignalAnalysisPayloadSchema.safeParse(allAbstained).success).toBe(true);
    expect(areConversationalSignalEvidenceReferencesValid(allAbstained.signals, [userMessageId])).toBe(true);
    expect(areConversationalSignalEvidenceReferencesValid(payload().signals, [userMessageId])).toBe(true);
    expect(areConversationalSignalEvidenceReferencesValid(payload(assistantMessageId).signals, [userMessageId])).toBe(false);
  });

  it('validates a synthetic reported observation and explicit insufficient evidence', () => {
    expect(conversationalSignalAnalysisPayloadSchema.parse(payload()).signals.anxiety.level).toBe('low');
    expect(conversationalSignalAnalysisPayloadSchema.parse(payload()).signals.depression.level).toBe('insufficient_evidence');
  });

  it('rejects evidence counts and insufficient-evidence claims that disagree with their evidence', () => {
    const value = payload();
    expect(conversationalSignalAnalysisPayloadSchema.safeParse({
      ...value,
      signals: { ...value.signals, anxiety: { ...value.signals.anxiety, evidenceCount: 0 } },
    }).success).toBe(false);
    expect(conversationalSignalAnalysisPayloadSchema.safeParse({
      ...value,
      signals: { ...value.signals, anxiety: { ...value.signals.anxiety, level: 'high', observedPattern: 'recurring_across_messages' } },
    }).success).toBe(false);
    expect(conversationalSignalAnalysisPayloadSchema.safeParse({
      ...value,
      signals: { ...value.signals, anxiety: { ...value.signals.anxiety, level: 'moderate', observedPattern: 'context_linked' } },
    }).success).toBe(true);
    expect(conversationalSignalAnalysisPayloadSchema.safeParse({
      ...value,
      signals: { ...value.signals, depression: { ...value.signals.depression, indicators: ['low_mood'] } },
    }).success).toBe(false);
  });

  it('rejects evidence referring to a message outside the exact selected user-message set', () => {
    expect(() => createConversationalSignalAnalysis({
      analysisId: '9f2e750c-c63b-43b3-9bd1-000000000004', conversationId, accountId: ownerId, analyzedAt: now,
      period: { start: now, end: now }, selectedMessageCount: 2, analyzedUserMessageCount: 1,
      excludedNonUserMessageCount: 1, modelVersion: 'synthetic-model-v1', payload: payload(assistantMessageId),
      allowedUserMessageIds: [userMessageId],
    })).toThrow('Evidence references an unselected or non-user message');
  });
});

describe('OpenAI conversational signal analyzer', () => {
  const settings: OpenAiEnvironmentSettings = {
    openAiApiKey: 'unit-test-key-only', openAiModel: 'synthetic-test-model', openAiTimeoutMs: 5_000,
    openAiMaxOutputTokens: 500, openAiMaxContextMessages: 4, openAiMaxContextCharacters: 2_000,
  };

  it('uses strict structured output, bounded context, no provider storage, and validates returned references', async () => {
    const response = {
      status: 'completed', error: null,
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload()) }] }],
      output_parsed: payload(),
    } as unknown as OpenAI.Responses.ParsedResponse<unknown>;
    const parse = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, _options?: RequestOptions) => response);
    const client = { parse } as unknown as Pick<OpenAI['responses'], 'parse'>;
    const analyzer = new OpenAiConversationalSignalAnalyzer(settings, client);

    await expect(analyzer.analyze({ messages: [{ messageId: userMessageId, content: 'Texto sintético de preocupación académica.' }] })).resolves.toEqual(payload());
    const [body, options] = parse.mock.calls[0] ?? [];
    expect(body).toMatchObject({ model: 'synthetic-test-model', max_output_tokens: 500, store: false, tools: [], text: { format: { type: 'json_schema', strict: true } } });
    expect(body.instructions).toContain('No calcules DASS-21');
    expect(options).toMatchObject({ timeout: 5_000, maxRetries: 0 });

    const fabricatedPayload = payload('9f2e750c-c63b-43b3-9bd1-000000000099');
    parse.mockResolvedValueOnce({ ...response, output_parsed: fabricatedPayload } as unknown as OpenAI.Responses.ParsedResponse<unknown>);
    await expect(analyzer.analyze({ messages: [{ messageId: userMessageId, content: 'Texto sintético.' }] }))
      .rejects.toMatchObject({ kind: 'invalid_response', diagnostics: { failureStage: 'message_reference_validation' } });
  });

  it('forwards every selected positive-fixture message with its UUID to the structured request', async () => {
    const selectedMessages = syntheticSignalFixtures['explicit-signals'].messages.map((content, index) => ({
      messageId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      content,
    }));
    const selectedMessagePayload = payload(selectedMessages[0]!.messageId);
    const response = {
      status: 'completed', error: null,
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(selectedMessagePayload) }] }],
      output_parsed: selectedMessagePayload,
    } as unknown as OpenAI.Responses.ParsedResponse<unknown>;
    const parse = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, _options?: RequestOptions) => response);
    const analyzer = new OpenAiConversationalSignalAnalyzer({ ...settings, openAiMaxContextMessages: 8 }, { parse } as unknown as Pick<OpenAI['responses'], 'parse'>);

    await analyzer.analyze({ messages: selectedMessages });

    const [body, options] = parse.mock.calls[0] ?? [];
    expect(body.input).toHaveLength(8);
    selectedMessages.forEach((message, index) => {
      expect(body.input[index]).toMatchObject({ role: 'user', content: expect.stringContaining(`[messageId:${message.messageId}]\n${message.content}`) });
    });
    expect(body).toMatchObject({ store: false, tools: [], text: { format: { type: 'json_schema', strict: true } } });
    expect(options).toMatchObject({ timeout: 5_000, maxRetries: 0 });
  });

  it('maps SDK timeouts safely and forwards cancellation without retrying', async () => {
    const timedOutParse = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, options?: RequestOptions) => {
      expect(options).toMatchObject({ timeout: 5_000, maxRetries: 0 });
      throw new APIConnectionTimeoutError({ message: 'private timeout detail' });
    });
    const timedOutAnalyzer = new OpenAiConversationalSignalAnalyzer(settings, { parse: timedOutParse } as unknown as Pick<OpenAI['responses'], 'parse'>);
    const timeoutFailure = await timedOutAnalyzer.analyze({ messages: [{ messageId: userMessageId, content: 'Texto sintético.' }] }).catch(error => error as Error);
    expect(timeoutFailure).toMatchObject({ kind: 'timeout' });
    expect(timeoutFailure.message).not.toContain('private timeout detail');
    expect(timedOutParse).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const cancelledParse = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, options?: RequestOptions) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      throw new APIUserAbortError();
    });
    const cancelledAnalyzer = new OpenAiConversationalSignalAnalyzer(settings, { parse: cancelledParse } as unknown as Pick<OpenAI['responses'], 'parse'>);
    await expect(cancelledAnalyzer.analyze({ messages: [{ messageId: userMessageId, content: 'Texto sintético.' }] }, controller.signal))
      .rejects.toMatchObject({ kind: 'cancelled' });
    expect(cancelledParse).toHaveBeenCalledTimes(1);
  });

  it('preserves safe status, incomplete reason, and token metadata without retaining response content', async () => {
    const parse = vi.fn();
    const analyzer = new OpenAiConversationalSignalAnalyzer(settings, { parse } as unknown as Pick<OpenAI['responses'], 'parse'>);
    const input = { messages: [{ messageId: userMessageId, content: 'Texto sintético.' }] };
    const incomplete = (reason: string) => ({
      status: 'incomplete', error: null, incomplete_details: { reason }, output: [], output_parsed: null,
      usage: { input_tokens: 640, output_tokens: 500, total_tokens: 1_140, output_tokens_details: { reasoning_tokens: 420 } },
    }) as unknown as OpenAI.Responses.ParsedResponse<unknown>;
    parse.mockResolvedValueOnce(incomplete('max_output_tokens'));
    parse.mockResolvedValueOnce(incomplete('content_filter'));
    parse.mockResolvedValueOnce({
      status: 'failed', error: { code: 'server_error', message: 'private provider detail' }, incomplete_details: null,
      output: [], output_parsed: null, usage: null,
    } as unknown as OpenAI.Responses.ParsedResponse<unknown>);
    parse.mockResolvedValueOnce({
      status: 'completed', error: null, output: [], output_parsed: null,
      usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10, output_tokens_details: { reasoning_tokens: 0 } },
    } as unknown as OpenAI.Responses.ParsedResponse<unknown>);
    parse.mockResolvedValueOnce({
      status: 'completed', error: null,
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }], output_parsed: { invalid: true },
      usage: null,
    } as unknown as OpenAI.Responses.ParsedResponse<unknown>);
    parse.mockRejectedValueOnce(new ZodError([{ code: 'custom', path: ['signals'], message: 'private schema detail' }]));
    parse.mockResolvedValueOnce({
      status: 'completed', error: null,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'structured output' }] }], output_parsed: payload(assistantMessageId),
      usage: null,
    } as unknown as OpenAI.Responses.ParsedResponse<unknown>);

    const failures: ConversationalSignalAnalysisError[] = [];
    for (let index = 0; index < 7; index += 1) {
      const failure = await analyzer.analyze(input).catch(error => error as ConversationalSignalAnalysisError);
      failures.push(failure);
    }
    expect(failures[0]).toMatchObject({
      kind: 'incomplete_response', diagnostics: {
        responseStatus: 'incomplete', incompleteReason: 'max_output_tokens', failureStage: 'incomplete_response',
        inputTokens: 640, outputTokens: 500, totalTokens: 1_140, reasoningTokens: 420,
      },
    });
    expect(failures[1]).toMatchObject({ kind: 'incomplete_response', diagnostics: { incompleteReason: 'content_filter' } });
    expect(failures[2]).toMatchObject({ kind: 'provider_unavailable', diagnostics: { failureStage: 'provider_response_error' } });
    expect(failures[2]?.message).not.toContain('private provider detail');
    expect(failures[3]).toMatchObject({ kind: 'invalid_response', diagnostics: { failureStage: 'empty_output' } });
    expect(failures[4]).toMatchObject({ kind: 'invalid_response', diagnostics: { failureStage: 'schema_validation' } });
    expect(failures[5]).toMatchObject({ kind: 'invalid_response', diagnostics: { failureStage: 'schema_validation' } });
    expect(failures[5]?.message).not.toContain('private schema detail');
    expect(failures[6]).toMatchObject({ kind: 'invalid_response', diagnostics: { failureStage: 'message_reference_validation' } });
    expect(parse).toHaveBeenCalledTimes(7);
  });
});

describe('authorized signal analysis use case', () => {
  const enabledPolicy = { enabled: true, retentionDays: 90, allowedAccountIds: [ownerId] } as const;
  const selectedMessages = [
    { id: assistantMessageId, conversationId, role: 'assistant', content: 'Respuesta del asistente.', status: 'completed', createdAt: now },
    { id: userMessageId, conversationId, role: 'user', content: 'Me preocupa organizar mis exámenes.', status: 'completed', createdAt: now },
  ];

  it('analyzes only owner-selected student messages, persists with expiry, and returns no owner field requirement to clients', async () => {
    const conversationRepository = { findByIdForOwner: vi.fn(async () => ({ id: conversationId, accountId: ownerId })) };
    const messageRepository = { findByIdsForOwner: vi.fn(async () => selectedMessages) };
    const consent = { execute: vi.fn(async () => true) } as unknown as ConsentPurposeChecker;
    const analyzer = { modelVersion: 'synthetic-model-v1', analyze: vi.fn(async () => payload()) } satisfies ConversationalSignalAnalyzer;
    const analyses = { saveForOwnerWithCurrentConsent: vi.fn(async ({ analysis }: { analysis: ReturnType<typeof createConversationalSignalAnalysis> }) => analysis) };
    const useCase = new AnalyzeAuthorizedConversationSignals(
      conversationRepository as never, messageRepository as never, consent, analyzer, analyses as never, enabledPolicy, () => now,
    );

    const result = await useCase.execute(ownerId, { conversationId, messageIds: [userMessageId, assistantMessageId] });

    expect(analyzer.analyze).toHaveBeenCalledWith({ messages: [{ messageId: userMessageId, content: 'Me preocupa organizar mis exámenes.' }] }, undefined);
    expect(analyses.saveForOwnerWithCurrentConsent).toHaveBeenCalledWith(expect.objectContaining({
      userMessageIds: [userMessageId], expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    }));
    expect(result.accountId).toBe(ownerId);
    expect(result.coverage).toMatchObject({ selectedMessageCount: 2, analyzedUserMessageCount: 1, excludedNonUserMessageCount: 1 });
    expect(consent.execute).toHaveBeenCalledTimes(9);
  });

  it('fails closed before provider invocation when any required consent is absent', async () => {
    const analyzer = { modelVersion: 'synthetic-model-v1', analyze: vi.fn(async () => payload()) } satisfies ConversationalSignalAnalyzer;
    const consent = { execute: vi.fn(async (_owner: string, purpose: string) => purpose !== 'conversational_signal_analysis') } as unknown as ConsentPurposeChecker;
    const save = vi.fn();
    const useCase = new AnalyzeAuthorizedConversationSignals(
      { findByIdForOwner: async () => ({ id: conversationId, accountId: ownerId }) } as never,
      { findByIdsForOwner: async () => selectedMessages } as never,
      consent, analyzer, { saveForOwnerWithCurrentConsent: save } as never, enabledPolicy,
    );

    await expect(useCase.execute(ownerId, { conversationId, messageIds: [userMessageId, assistantMessageId] }))
      .rejects.toBeInstanceOf(ConversationalSignalAnalysisConsentRequired);
    expect(analyzer.analyze).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps production-disabled analysis unavailable and never calls the provider', async () => {
    const analyzer = { modelVersion: 'synthetic-model-v1', analyze: vi.fn(async () => payload()) } satisfies ConversationalSignalAnalyzer;
    const useCase = new AnalyzeAuthorizedConversationSignals(
      {} as never, {} as never, {} as never, analyzer, {} as never, { enabled: false, retentionDays: null, allowedAccountIds: [] },
    );
    await expect(useCase.execute(ownerId, { conversationId, messageIds: [userMessageId] })).rejects.toBeInstanceOf(ConversationalSignalAnalysisUnavailable);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });

  it('reads the latest own analysis and returns an explicit empty state without invoking analysis', async () => {
    const saved = createConversationalSignalAnalysis({
      analysisId: '9f2e750c-c63b-43b3-9bd1-000000000004', conversationId, accountId: ownerId, analyzedAt: now,
      period: { start: now, end: now }, selectedMessageCount: 1, analyzedUserMessageCount: 1,
      excludedNonUserMessageCount: 0, modelVersion: 'synthetic-model-v1', payload: payload(), allowedUserMessageIds: [userMessageId],
    });
    const analyses = {
      findLatestForOwnerWithCurrentConsent: vi.fn(async () => saved),
      listRecentForOwnerWithCurrentConsent: vi.fn(async () => []),
    };
    const query = new GetMyConversationalSignalAnalysis(analyses as never, enabledPolicy);
    await expect(query.latest(ownerId)).resolves.toEqual(saved);
    await expect(query.latest(ownerId)).resolves.toEqual(saved);
    expect(analyses.findLatestForOwnerWithCurrentConsent).toHaveBeenCalledWith(ownerId);
    expect(analyses.listRecentForOwnerWithCurrentConsent).not.toHaveBeenCalled();
  });

  it('blocks analysis and reads for accounts outside the server allowlist', async () => {
    const analyzer = { modelVersion: 'synthetic-model-v1', analyze: vi.fn(async () => payload()) } satisfies ConversationalSignalAnalyzer;
    const analyses = { saveForOwnerWithCurrentConsent: vi.fn(), findLatestForOwnerWithCurrentConsent: vi.fn(), listRecentForOwnerWithCurrentConsent: vi.fn() };
    const command = new AnalyzeAuthorizedConversationSignals({} as never, {} as never, {} as never, analyzer, analyses as never, enabledPolicy);
    const query = new GetMyConversationalSignalAnalysis(analyses as never, enabledPolicy);
    const outsideAccountId = 'a11d7c60-d25c-4bec-aeb5-6bdac8910ac3';

    await expect(command.execute(outsideAccountId, { conversationId, messageIds: [userMessageId] }))
      .rejects.toBeInstanceOf(ConversationalSignalAnalysisUnavailable);
    await expect(query.latest(outsideAccountId)).rejects.toBeInstanceOf(ConversationalSignalAnalysisUnavailable);
    await expect(query.history(outsideAccountId, 5)).rejects.toBeInstanceOf(ConversationalSignalAnalysisUnavailable);
    expect(analyzer.analyze).not.toHaveBeenCalled();
    expect(analyses.findLatestForOwnerWithCurrentConsent).not.toHaveBeenCalled();
    expect(analyses.listRecentForOwnerWithCurrentConsent).not.toHaveBeenCalled();
  });
});
