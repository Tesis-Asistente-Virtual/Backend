import { describe, expect, it, vi } from 'vitest';
import OpenAI, { APIConnectionTimeoutError } from 'openai';
import type { AiTextGenerationRequest, AiTextStreamEvent } from '../../../src/modules/conversations/application/ports/ai-text-generator.js';
import { OpenAiTextGenerator, OpenAiTextGenerationError } from '../../../src/modules/conversations/infrastructure/openai/openai-text-generator.js';
import type { OpenAiEnvironmentSettings } from '../../../src/modules/conversations/infrastructure/openai/openai-configuration.js';

const settings: OpenAiEnvironmentSettings = {
  openAiApiKey: 'stream-test-key', openAiModel: 'stream-test-model', openAiTimeoutMs: 15_000,
  openAiMaxOutputTokens: 500, openAiMaxContextMessages: 10, openAiMaxContextCharacters: 5000,
};
const request: AiTextGenerationRequest = {
  instructions: 'Versioned assistant instructions.',
  messages: [{ role: 'user', content: 'First user text' }, { role: 'assistant', content: 'Prior response' }],
  maxOutputTokens: 120,
};

function completedResponse(text: string, status: OpenAI.Responses.Response['status'] = 'completed'): OpenAI.Responses.Response {
  return {
    id: 'remote-id-is-private', access_programs: null, created_at: 1, error: null, incomplete_details: null,
    instructions: null, metadata: null, model: 'stream-test-model', object: 'response', output: [],
    output_text: text, parallel_tool_calls: false, temperature: 1, tool_choice: 'auto', tools: [], top_p: 1,
    status, truncation: 'disabled', usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  } as unknown as OpenAI.Responses.Response;
}

function delta(text: string, sequence: number): OpenAI.Responses.ResponseStreamEvent {
  return { type: 'response.output_text.delta', content_index: 0, delta: text, item_id: 'private-item-id', logprobs: [], output_index: 0, sequence_number: sequence };
}

function completed(text: string, sequence: number): OpenAI.Responses.ResponseStreamEvent {
  return { type: 'response.completed', response: completedResponse(text), sequence_number: sequence };
}

function streamHarness(stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>) {
  const create = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsStreaming, _options?: OpenAI.RequestOptions) => stream);
  const client = { responses: { create } } as unknown as Pick<OpenAI, 'responses'>;
  return { generator: new OpenAiTextGenerator(settings, client), create };
}

async function consume(events: AsyncIterable<AiTextStreamEvent>): Promise<AiTextStreamEvent[]> {
  const values: AiTextStreamEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
}

async function consumeUntilError(events: AsyncIterable<AiTextStreamEvent>, emitted: AiTextStreamEvent[]): Promise<unknown> {
  try {
    for await (const event of events) emitted.push(event);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('OpenAiTextGenerator streaming', () => {
  it('sends explicit streaming parameters and yields ordered deltas plus one verifiable completion', async () => {
    async function* events() {
      yield delta('Hola ', 1);
      yield delta('estudiante.', 2);
      yield delta('estudiante.', 2); // Duplicate sequence number is ignored.
      yield completed('Hola estudiante.', 3);
    }
    const { generator, create } = streamHarness(events());
    const output = await consume(generator.streamText(request));
    const [body, options] = create.mock.calls[0] ?? [];

    expect(body).toMatchObject({
      model: 'stream-test-model',
      instructions: request.instructions,
      input: request.messages,
      max_output_tokens: 120,
      store: false,
      stream: true,
      tools: [],
    });
    expect(body).not.toHaveProperty('previous_response_id');
    expect(body).not.toHaveProperty('conversation');
    expect(options).toMatchObject({ timeout: 15_000, maxRetries: 0 });
    expect(output).toEqual([
      { type: 'delta', text: 'Hola ' },
      { type: 'delta', text: 'estudiante.' },
      { type: 'completed', result: { text: 'Hola estudiante.', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } } },
    ]);
  });

  it('rejects an iterator that ends without response.completed', async () => {
    async function* events() { yield delta('Partial text', 1); }
    const { generator } = streamHarness(events());
    const emitted: AiTextStreamEvent[] = [];
    const caught = await consumeUntilError(generator.streamText(request), emitted);
    expect(emitted).toEqual([{ type: 'delta', text: 'Partial text' }]);
    expect(caught).toMatchObject({ kind: 'incomplete_response' });
    expect(emitted.some(event => event.type === 'completed')).toBe(false);
  });

  it('rejects failed, incomplete, error events and empty final responses without completion', async () => {
    const terminalEvents: OpenAI.Responses.ResponseStreamEvent[] = [
      { type: 'response.failed', response: completedResponse('', 'failed'), sequence_number: 1 },
      { type: 'response.incomplete', response: completedResponse('', 'incomplete'), sequence_number: 1 },
      { type: 'error', code: 'rate_limit_exceeded', message: 'private provider message', param: null, sequence_number: 1 },
    ];
    const expectedKinds = ['provider', 'incomplete_response', 'rate_limit'] as const;
    for (const [index, terminal] of terminalEvents.entries()) {
      async function* events() { yield delta('Some text', 0); yield terminal; }
      const { generator } = streamHarness(events());
      const emitted: AiTextStreamEvent[] = [];
      const caught = await consumeUntilError(generator.streamText(request), emitted);
      expect(caught).toMatchObject({ kind: expectedKinds[index] });
      expect(caught).toBeInstanceOf(OpenAiTextGenerationError);
      expect((caught as Error).message).not.toContain('private provider message');
      expect(emitted.some(event => event.type === 'completed')).toBe(false);
    }

    async function* emptyResponse() { yield completed('', 1); }
    const { generator } = streamHarness(emptyResponse());
    await expect(consume(generator.streamText(request))).rejects.toMatchObject({ kind: 'empty_response' });

    async function* mismatchedFinal() { yield delta('partial', 1); yield completed('different final text', 2); }
    const mismatched = streamHarness(mismatchedFinal());
    await expect(consume(mismatched.generator.streamText(request))).rejects.toMatchObject({ kind: 'invalid_response' });

    async function* wrongFinalStatus() {
      yield delta('some text', 1);
      const terminal: OpenAI.Responses.ResponseStreamEvent = {
        type: 'response.completed', response: completedResponse('some text', 'incomplete'), sequence_number: 2,
      };
      yield terminal;
    }
    const wrongStatus = streamHarness(wrongFinalStatus());
    await expect(consume(wrongStatus.generator.streamText(request))).rejects.toMatchObject({ kind: 'incomplete_response' });
  });

  it('classifies max_output_tokens and unknown incomplete reasons without preserving provider payloads', async () => {
    for (const [reason, expected] of [['max_output_tokens', 'max_output_tokens'], ['future_private_reason', 'other']] as const) {
      async function* events() {
        yield delta('Visible prefix', 1);
        yield {
          type: 'response.incomplete',
          response: { ...completedResponse('Visible prefix', 'incomplete'), incomplete_details: { reason } },
          sequence_number: 2,
        } as unknown as OpenAI.Responses.ResponseStreamEvent;
      }
      const { generator } = streamHarness(events());
      const emitted: AiTextStreamEvent[] = [];
      const caught = await consumeUntilError(generator.streamText(request), emitted);
      expect(caught).toMatchObject({ kind: 'incomplete_response', incompleteReason: expected });
      expect(emitted.some(event => event.type === 'completed')).toBe(false);
      expect((caught as Error).message).not.toContain('future_private_reason');
    }
  });

  it('maps timeouts that occur during iteration and never emits completion after deltas', async () => {
    async function* events() {
      yield delta('Visible prefix', 1);
      throw new APIConnectionTimeoutError({ message: 'private timeout data' });
    }
    const { generator } = streamHarness(events());
    const emitted: AiTextStreamEvent[] = [];
    const caught = await consumeUntilError(generator.streamText(request), emitted);
    expect(emitted).toEqual([{ type: 'delta', text: 'Visible prefix' }]);
    expect(caught).toMatchObject({ kind: 'timeout' });
    expect((caught as Error).message).not.toContain('private timeout data');
    expect(emitted.some(event => event.type === 'completed')).toBe(false);
  });

  it('propagates AbortSignal and stops consuming without reporting completion', async () => {
    const controller = new AbortController();
    let returnCalled = false;
    const stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent> = {
      [Symbol.asyncIterator]() {
        let count = 0;
        return {
          next: async (): Promise<IteratorResult<OpenAI.Responses.ResponseStreamEvent>> => {
            count += 1;
            if (count === 1) return { done: false, value: delta('Prefix', 1) };
            return new Promise<IteratorResult<OpenAI.Responses.ResponseStreamEvent>>(() => {});
          },
          return: async () => { returnCalled = true; return { done: true, value: undefined }; },
        };
      },
    };
    const { generator, create } = streamHarness(stream);
    const iterator = generator.streamText(request, controller.signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'delta', text: 'Prefix' } });
    const pendingNext = iterator.next();
    controller.abort();
    let caught: unknown;
    try { await pendingNext; } catch (error) { caught = error; }
    expect(caught).toMatchObject({ kind: 'cancelled' });
    expect(returnCalled).toBe(true);
    const [, options] = create.mock.calls[0] ?? [];
    expect(options?.signal).toBe(controller.signal);
  });

  it('preserves non-streaming generation behavior', async () => {
    const response = completedResponse('complete non-stream response');
    const create = vi.fn(async (_body: OpenAI.Responses.ResponseCreateParamsNonStreaming, _options?: OpenAI.RequestOptions) => response);
    const client = { responses: { create } } as unknown as Pick<OpenAI, 'responses'>;
    const generator = new OpenAiTextGenerator(settings, client);
    await expect(generator.generateText(request)).resolves.toMatchObject({ text: 'complete non-stream response' });
    expect(create.mock.calls[0]?.[0].stream).toBe(false);
  });
});
