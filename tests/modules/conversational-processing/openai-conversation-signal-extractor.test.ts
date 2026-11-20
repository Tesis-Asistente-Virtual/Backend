import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError, RateLimitError } from 'openai';
import type { RequestOptions } from 'openai/internal/request-options.js';
import { describe, expect, it, vi } from 'vitest';
import { signalExtractionInstructions, signalExtractionInstructionsVersion } from '../../../src/modules/conversational-processing/application/signal-extraction-instructions.js';
import { ConversationSignalExtractionError, type ExtractConversationSignalsInput } from '../../../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import { signalSchemaVersion } from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';
import { OpenAiConfigurationError, type OpenAiEnvironmentSettings } from '../../../src/modules/conversations/infrastructure/openai/openai-configuration.js';
import { OpenAiConversationSignalExtractor } from '../../../src/modules/conversational-processing/infrastructure/openai/openai-conversation-signal-extractor.js';

const settings: OpenAiEnvironmentSettings = {
  openAiApiKey: 'unit-test-key-only',
  openAiModel: 'configured-test-model',
  openAiTimeoutMs: 9_000,
  openAiMaxOutputTokens: 500,
  openAiMaxContextMessages: 4,
  openAiMaxContextCharacters: 2_000,
};

const messageId = '550e8400-e29b-41d4-a716-446655440000';
const input: ExtractConversationSignalsInput = {
  messages: [{ messageId, role: 'user', content: 'Me siento sobrecargada por los exámenes desde hace unas semanas.' }],
};

function validExtraction() {
  return {
    schemaVersion: '1.0',
    observations: [{
      evidence: 'reported',
      manifestation: { status: 'reported', value: 'Refiere sentirse sobrecargada por exámenes.' },
      possibleDimensions: ['stress', 'anxiety'],
      duration: { status: 'reported', value: 'Desde hace unas semanas.' },
      frequency: { status: 'not_reported' },
      intensity: { status: 'not_assessed' },
      contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Exámenes universitarios.' } }],
      functionalImpact: { status: 'ambiguous', note: null },
      sourceMessageIds: [messageId],
    }],
    missingInformation: [{ field: 'frequency', reason: 'not_reported' }],
    clarificationQuestions: ['¿Con qué frecuencia te sucede?'],
  };
}

function response(parsed: unknown, overrides: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    error: null,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(parsed) }] }],
    output_parsed: parsed,
    ...overrides,
  } as unknown as OpenAI.Responses.ParsedResponse<unknown>;
}

function harness(result: OpenAI.Responses.ParsedResponse<unknown> = response(validExtraction())) {
  const parse = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, _options?: RequestOptions) => result);
  const client = { parse } as unknown as Pick<OpenAI['responses'], 'parse'>;
  return { extractor: new OpenAiConversationSignalExtractor(settings, client), parse };
}

describe('OpenAiConversationSignalExtractor', () => {
  it('sends authorized minimal context with strict Structured Outputs and privacy settings', async () => {
    const { extractor, parse } = harness();
    const extracted = await extractor.extract(input);
    const [body, options] = parse.mock.calls[0] ?? [];

    expect(extracted.observations[0]?.possibleDimensions).toEqual(['stress', 'anxiety']);
    expect(body).toMatchObject({
      model: 'configured-test-model',
      instructions: signalExtractionInstructions,
      input: [{ role: 'user', content: `[messageId:${messageId}]\n${input.messages[0]?.content}` }],
      max_output_tokens: 500,
      store: false,
      tools: [],
      text: { format: { type: 'json_schema', name: 'conversation_signal_extraction', strict: true } },
    });
    expect(options).toMatchObject({ timeout: 9_000, maxRetries: 0 });
    expect(body).not.toHaveProperty('previous_response_id');
    expect(body).not.toHaveProperty('conversation');
  });

  it('uses versioned non-diagnostic instructions', () => {
    expect(signalExtractionInstructionsVersion).toBe(signalSchemaVersion);
    expect(signalExtractionInstructions).toContain('no constituye un trastorno');
    expect(signalExtractionInstructions).toContain('not_reported significa solamente');
    expect(signalExtractionInstructions).toContain('No determines niveles de seguridad');
    expect(signalExtractionInstructions).toContain('No recomiendes medicamentos');
  });

  it('accepts a valid structured empty extraction when the provider returns it successfully', async () => {
    const empty = { schemaVersion: '1.0', observations: [], missingInformation: [], clarificationQuestions: [] };
    await expect(harness(response(empty)).extractor.extract(input)).resolves.toEqual(empty);
  });

  it('rejects unexpected fields and source message references not present in the authorized input', async () => {
    const withExtra = { ...validExtraction(), diagnosis: 'depression' };
    await expect(harness(response(withExtra)).extractor.extract(input)).rejects.toMatchObject({ kind: 'invalid_response' });
    const wrongReference = validExtraction();
    wrongReference.observations[0]!.sourceMessageIds = ['550e8400-e29b-41d4-a716-446655440099'];
    await expect(harness(response(wrongReference)).extractor.extract(input)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('maps malformed JSON, empty response, refusal and incomplete response to distinct safe errors', async () => {
    const malformed = harness();
    malformed.parse.mockRejectedValueOnce(new SyntaxError('raw provider output must not escape'));
    await expect(malformed.extractor.extract(input)).rejects.toMatchObject({ kind: 'invalid_response' });

    await expect(harness(response(null, { output: [{ type: 'message', content: [] }], output_parsed: null })).extractor.extract(input))
      .rejects.toMatchObject({ kind: 'invalid_response' });
    const refusalResponse = response(null, { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal text' }] }], output_parsed: null });
    await expect(harness(refusalResponse).extractor.extract(input)).rejects.toMatchObject({ kind: 'refusal' });
    await expect(harness(response(null, { status: 'incomplete', output_parsed: null })).extractor.extract(input))
      .rejects.toMatchObject({ kind: 'incomplete_response' });
  });

  it('maps timeout and provider errors without exposing provider messages', async () => {
    const failures: Array<{ error: Error; kind: string }> = [
      { error: new APIConnectionTimeoutError({ message: 'private timeout text' }), kind: 'timeout' },
      { error: new AuthenticationError(401, {}, 'private auth details', new Headers()), kind: 'provider_unavailable' },
      { error: new RateLimitError(429, {}, 'private rate limit details', new Headers()), kind: 'provider_unavailable' },
      { error: new APIConnectionError({ message: 'private connection detail' }), kind: 'provider_unavailable' },
      { error: new APIError(500, {}, 'private provider payload', new Headers()), kind: 'provider_unavailable' },
      { error: new Error('unexpected private message'), kind: 'provider_unavailable' },
    ];
    for (const failure of failures) {
      const testHarness = harness();
      testHarness.parse.mockRejectedValueOnce(failure.error);
      let caught: unknown;
      try { await testHarness.extractor.extract(input); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ConversationSignalExtractionError);
      expect(caught).toMatchObject({ kind: failure.kind });
      if (caught instanceof Error) expect(caught.message).not.toContain('private');
    }
  });

  it('sets zero automatic retries and applies the explicit request timeout', async () => {
    const { extractor, parse } = harness();
    await extractor.extract(input);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]?.[1]).toMatchObject({ timeout: 9_000, maxRetries: 0 });
  });

  it('passes AbortSignal to Responses API and rejects cancellation without accepting a result', async () => {
    const { extractor, parse } = harness();
    const controller = new AbortController();
    await extractor.extract(input, controller.signal);
    expect(parse.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    const pendingHarness = harness();
    const pendingController = new AbortController();
    let resolvePending: (result: OpenAI.Responses.ParsedResponse<unknown>) => void = () => {};
    pendingHarness.parse.mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }));
    const pending = pendingHarness.extractor.extract(input, pendingController.signal);
    pendingController.abort();
    resolvePending(response(validExtraction()));
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });

    const preCancelled = new AbortController();
    preCancelled.abort();
    await expect(pendingHarness.extractor.extract(input, preCancelled.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('rejects invalid or oversized input before contacting the provider', async () => {
    const { extractor, parse } = harness();
    await expect(extractor.extract({ ...input, accountId: 'not-accepted' } as unknown as ExtractConversationSignalsInput))
      .rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(extractor.extract({ messages: [{ ...input.messages[0]!, content: 'x'.repeat(2_001) }] }))
      .rejects.toMatchObject({ kind: 'invalid_input' });
    expect(parse).not.toHaveBeenCalled();
  });

  it('does not log messages, structured data, prompts, or provider errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const testHarness = harness();
      testHarness.parse.mockRejectedValueOnce(new APIError(500, {}, 'private psychological response', new Headers()));
      await expect(testHarness.extractor.extract(input)).rejects.toMatchObject({ kind: 'provider_unavailable' });
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('fails construction explicitly when OpenAI configuration is absent', () => {
    expect(() => new OpenAiConversationSignalExtractor({
      openAiTimeoutMs: 9_000, openAiMaxOutputTokens: 500, openAiMaxContextMessages: 4, openAiMaxContextCharacters: 2_000,
    })).toThrow(OpenAiConfigurationError);
  });
});
