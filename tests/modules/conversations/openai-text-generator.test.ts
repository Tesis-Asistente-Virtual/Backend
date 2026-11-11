import { describe, expect, it, vi } from 'vitest';
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, AuthenticationError, RateLimitError } from 'openai';
import type { AiTextGenerationRequest } from '../../../src/modules/conversations/application/ports/ai-text-generator.js';
import { OpenAiTextGenerator, OpenAiTextGenerationError } from '../../../src/modules/conversations/infrastructure/openai/openai-text-generator.js';
import type { OpenAiEnvironmentSettings } from '../../../src/modules/conversations/infrastructure/openai/openai-configuration.js';

const settings: OpenAiEnvironmentSettings = {
  openAiApiKey: 'unit-test-key',
  openAiModel: 'configured-test-model',
  openAiTimeoutMs: 12_000,
  openAiMaxOutputTokens: 400,
  openAiMaxContextMessages: 5,
  openAiMaxContextCharacters: 2000,
};
const generationRequest: AiTextGenerationRequest = {
  instructions: 'Safety instructions for this test.',
  messages: [
    { role: 'user', content: 'Estoy pasando por días difíciles.' },
    { role: 'assistant', content: 'Gracias por contármelo.' },
  ],
  maxOutputTokens: 180,
};

function sdkResponse(overrides: Partial<OpenAI.Responses.Response> = {}): OpenAI.Responses.Response {
  return {
    id: 'response-test',
    access_programs: null,
    created_at: 1,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'configured-test-model',
    object: 'response',
    output: [],
    output_text: '  Respuesta empática.  ',
    parallel_tool_calls: false,
    temperature: 1,
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    status: 'completed',
    truncation: 'disabled',
    usage: { input_tokens: 21, output_tokens: 12, total_tokens: 33, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    ...overrides,
  } as unknown as OpenAI.Responses.Response;
}

function harness(result: OpenAI.Responses.Response = sdkResponse()) {
  const create = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, _options?: OpenAI.RequestOptions) => result);
  const client = { responses: { create } } as unknown as Pick<OpenAI, 'responses'>;
  return { generator: new OpenAiTextGenerator(settings, client), create };
}

describe('OpenAiTextGenerator', () => {
  it('builds a bounded non-streaming Responses request with the configured model and privacy settings', async () => {
    const { generator, create } = harness();
    const result = await generator.generateText(generationRequest);
    const [requestBody, requestOptions] = create.mock.calls[0] ?? [];

    expect(requestBody).toMatchObject({
      model: 'configured-test-model',
      instructions: generationRequest.instructions,
      input: generationRequest.messages,
      max_output_tokens: 180,
      store: false,
      stream: false,
      tools: [],
    });
    expect(requestBody).not.toHaveProperty('previous_response_id');
    expect(requestBody).not.toHaveProperty('conversation');
    expect(requestOptions).toMatchObject({ timeout: 12_000, maxRetries: 0 });
    expect(result).toEqual({ text: 'Respuesta empática.', usage: { inputTokens: 21, outputTokens: 12, totalTokens: 33 } });
  });

  it('uses configured max output tokens when the request omits an override', async () => {
    const { generator, create } = harness();
    await generator.generateText({ instructions: 'Rules', messages: [] });
    expect(create.mock.calls[0]?.[0].max_output_tokens).toBe(400);
  });

  it('rejects empty text and incomplete provider responses', async () => {
    const empty = harness(sdkResponse({ output_text: ' \n ' }));
    await expect(empty.generator.generateText(generationRequest)).rejects.toMatchObject({ kind: 'invalid_response' });
    const incomplete = harness(sdkResponse({ status: 'incomplete' }));
    await expect(incomplete.generator.generateText(generationRequest)).rejects.toMatchObject({ kind: 'invalid_response' });
    const failed = harness(sdkResponse({ status: 'failed' }));
    await expect(failed.generator.generateText(generationRequest)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('classifies provider authentication, rate limit, timeout, connection and unexpected failures safely', async () => {
    const providerErrors: Array<{ error: Error; kind: OpenAiTextGenerationError['kind'] }> = [
      { error: new AuthenticationError(401, {}, 'sensitive provider detail', new Headers()), kind: 'authentication' },
      { error: new RateLimitError(429, {}, 'sensitive provider detail', new Headers()), kind: 'rate_limit' },
      { error: new APIConnectionTimeoutError({ message: 'private timeout detail' }), kind: 'timeout' },
      { error: new APIConnectionError({ message: 'private connection detail' }), kind: 'connection' },
      { error: new Error('unexpected secret detail'), kind: 'provider' },
    ];
    for (const providerError of providerErrors) {
      const { generator, create } = harness();
      create.mockRejectedValueOnce(providerError.error);
      let caught: unknown;
      try { await generator.generateText(generationRequest); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ kind: providerError.kind });
      expect(caught).toBeInstanceOf(OpenAiTextGenerationError);
      if (caught instanceof Error) expect(caught.message).not.toContain('detail');
    }
  });

  it('fails explicitly when generation is attempted without API key or model configuration', () => {
    expect(() => new OpenAiTextGenerator({ ...settings, openAiApiKey: undefined })).toThrow('OPENAI_API_KEY');
    expect(() => new OpenAiTextGenerator({ ...settings, openAiModel: undefined })).toThrow('OPENAI_MODEL');
  });

  it('rejects context that exceeds the configured generation limits before calling the SDK', async () => {
    const { generator, create } = harness();
    await expect(generator.generateText({ ...generationRequest, messages: Array(6).fill({ role: 'user', content: 'x' }) }))
      .rejects.toThrow('message limit');
    expect(create).not.toHaveBeenCalled();
  });
});
