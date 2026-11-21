import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ConversationsController } from '../../../src/modules/conversations/interfaces/rest/resources/conversations-controller.js';
import { CreateConversation } from '../../../src/modules/conversations/application/internal/command-services/create-conversation.js';
import { GetConversation } from '../../../src/modules/conversations/application/internal/query-services/get-conversation.js';
import { ListConversations } from '../../../src/modules/conversations/application/internal/query-services/list-conversations.js';
import { ListConversationMessages } from '../../../src/modules/conversations/application/internal/query-services/list-conversation-messages.js';
import { SendConversationMessage } from '../../../src/modules/conversations/application/internal/command-services/send-conversation-message.js';
import { StreamConversationMessage } from '../../../src/modules/conversations/application/internal/command-services/stream-conversation-message.js';
import type { ConversationStreamFailureObservation, ConversationStreamObserver } from '../../../src/modules/conversations/application/ports/conversation-stream-observer.js';
import { ConsoleConversationStreamObserver } from '../../../src/modules/conversations/infrastructure/observability/console-conversation-stream-observer.js';
import { ConversationTurnInProgress, type ConversationTurnLock } from '../../../src/modules/conversations/application/ports/conversation-turn-lock.js';
import { AiTextGenerationError, type AiTextGenerator } from '../../../src/modules/conversations/application/ports/ai-text-generator.js';
import type { Conversation } from '../../../src/modules/conversations/domain/model/conversation.js';
import type { ConversationMessage } from '../../../src/modules/conversations/domain/model/conversation-message.js';
import type { ConversationRepository } from '../../../src/modules/conversations/domain/repositories/conversation-repository.js';
import type { ConversationMessageRepository } from '../../../src/modules/conversations/domain/repositories/conversation-message-repository.js';
import { ConversationProcessingConsentError, type ConversationProcessingConsentAuthorizer } from '../../../src/modules/conversations/application/ports/conversation-processing-consent.js';

const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const stamp = new Date('2026-01-01T00:00:00Z');

function harness(options: { archived?: boolean; exists?: boolean; lockBusy?: boolean; providerFails?: boolean; providerFailure?: AiTextGenerationError; persistAssistantFails?: boolean; consentResults?: boolean[]; atomicConsentError?: Error; consentError?: Error } = {}) {
  const conversation: Conversation = { id: conversationId, accountId: ownerId, title: null, status: options.archived ? 'archived' : 'active', createdAt: stamp, updatedAt: stamp };
  let id = 1;
  const messagesCreated: ConversationMessage[] = [
    { id: '550e8400-e29b-41d4-a716-446655440010', conversationId, role: 'user', content: 'Earlier student message', status: 'completed', createdAt: new Date(stamp.getTime() - 2_000) },
    { id: '550e8400-e29b-41d4-a716-446655440011', conversationId, role: 'assistant', content: 'Earlier assistant reply', status: 'completed', createdAt: new Date(stamp.getTime() - 1_000) },
  ];
  const generationRequests: Array<{ instructions: string; messages: readonly { role: 'user' | 'assistant'; content: string }[] }> = [];
  const conversations = {
    create: vi.fn(),
    findByIdForOwner: vi.fn(async () => options.exists === false ? null : conversation),
    listByOwner: vi.fn(),
  } as unknown as ConversationRepository;
  const createMessage = vi.fn(async (_account: string, input: { conversationId: string; role: 'user' | 'assistant'; content: string; status?: 'generating' | 'completed' | 'failed' }) => {
      if (options.persistAssistantFails && input.role === 'assistant' && input.status === 'completed') throw new Error('private database detail');
      const created: ConversationMessage = { id: `550e8400-e29b-41d4-a716-44665544000${id++}`, conversationId: input.conversationId, role: input.role, content: input.content, status: input.status ?? 'completed', createdAt: new Date(stamp.getTime() + id) };
      messagesCreated.push(created);
      return created;
    });
  const messages = {
    createForOwner: createMessage,
    createForOwnerWithCurrentProcessingConsent: vi.fn(async (...args: Parameters<typeof createMessage>) => {
      if (options.atomicConsentError) throw options.atomicConsentError;
      return createMessage(...args);
    }),
    listByConversationForOwner: vi.fn(),
    listRecentCompletedForOwner: vi.fn(async () => messagesCreated.filter(message => message.status === 'completed')),
  } as unknown as ConversationMessageRepository;
  const generator: AiTextGenerator = {
    generateText: vi.fn(async () => ({ text: 'unused' })),
    async *streamText(request) {
      generationRequests.push(request);
      if (options.providerFails) {
        yield { type: 'delta', text: 'partial' } as const;
        if (options.providerFailure) throw options.providerFailure;
        throw new Error('private provider detail');
      }
      yield { type: 'delta', text: 'Hola, ' } as const;
      yield { type: 'delta', text: '¿cómo estás?' } as const;
      yield { type: 'completed', result: { text: 'Hola, ¿cómo estás?' } } as const;
    },
  };
  const lock: ConversationTurnLock = {
    runExclusive: vi.fn(async (_id, operation) => {
      if (options.lockBusy) throw new ConversationTurnInProgress();
      return operation();
    }),
  };
  const recordFailure = vi.fn((_observation: ConversationStreamFailureObservation) => {});
  const observer: ConversationStreamObserver & { recordFailure: typeof recordFailure } = { recordFailure };
  let consentIndex = 0;
  const consent: ConversationProcessingConsentAuthorizer = { isAuthorized: vi.fn(async () => {
    if (options.consentError) throw options.consentError;
    return options.consentResults?.[consentIndex++] ?? true;
  }) };
  const stream = new StreamConversationMessage(conversations, messages, generator, lock, 10, 200, consent, observer);
  const controller = new ConversationsController(
    new CreateConversation(conversations), new ListConversations(conversations), new GetConversation(conversations),
    new ListConversationMessages(conversations, messages),
    new SendConversationMessage(conversations, messages, generator, lock, 10, 200, consent), stream,
  );
  return { controller, conversations, messages, generator, lock, consent, messagesCreated, generationRequests, observer };
}

function makeRequest(body: unknown = { content: '  Student text  ' }, authenticated = true): Request {
  const request = new EventEmitter() as EventEmitter & Partial<Request>;
  Object.assign(request, { auth: authenticated ? { accountId: ownerId } : undefined, body, params: { id: conversationId }, aborted: false });
  return request as Request;
}

function makeResponse(writeMode: 'normal' | 'close-on-delta' | 'throw-on-delta' = 'normal') {
  const response = new EventEmitter() as EventEmitter & { chunks: string[]; headers: Record<string, string>; headersSent: boolean; writableEnded: boolean; destroyed: boolean };
  Object.assign(response, {
    chunks: [] as string[], headers: {} as Record<string, string>, headersSent: false, writableEnded: false, destroyed: false,
    status: vi.fn().mockReturnThis(),
    set: vi.fn((headers: Record<string, string>) => { response.headers = headers; return response; }),
    flushHeaders: vi.fn(() => { response.headersSent = true; }),
    write: vi.fn((chunk: string) => {
      if (writeMode === 'throw-on-delta' && chunk.startsWith('event: message.delta')) throw new Error('private socket detail');
      response.chunks.push(chunk);
      if (writeMode === 'close-on-delta' && chunk.startsWith('event: message.delta')) response.emit('close');
      return true;
    }),
    end: vi.fn(() => { response.writableEnded = true; }),
    json: vi.fn(),
  });
  return response as unknown as Response & typeof response;
}

describe('Conversation SSE endpoint', () => {
  it('sends ordered SSE events and persists one completed assistant message', async () => {
    const h = harness(); const req = makeRequest(); const res = makeResponse();
    await h.controller.streamConversationMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.headers).toMatchObject({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    expect(res.chunks.map(chunk => chunk.slice(0, chunk.indexOf('\n')))).toEqual([
      'event: message.started', 'event: message.delta', 'event: message.delta', 'event: message.completed', 'event: stream.completed',
    ]);
    expect(res.chunks.every(chunk => chunk.endsWith('\n\n'))).toBe(true);
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).toHaveBeenCalledTimes(2);
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).toHaveBeenNthCalledWith(1, ownerId, { conversationId, role: 'user', content: 'Student text', status: 'completed' });
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).toHaveBeenNthCalledWith(2, ownerId, { conversationId, role: 'assistant', content: 'Hola, ¿cómo estás?', status: 'completed' });
    expect(h.generationRequests[0]?.messages.map(message => message.content)).toEqual(['Earlier student message', 'Earlier assistant reply', 'Student text']);
    expect(h.generationRequests[0]?.messages.filter(message => message.content === 'Student text')).toHaveLength(1);
    expect(res.writableEnded).toBe(true);
  });

  it('keeps authorization, archived, invalid input and a busy lock as ordinary HTTP errors before SSE starts', async () => {
    const unauthenticated = harness(); const unauthorizedResponse = makeResponse();
    await unauthenticated.controller.streamConversationMessage(makeRequest({}, false), unauthorizedResponse);
    expect(unauthorizedResponse.status).toHaveBeenCalledWith(401);
    expect(unauthorizedResponse.headersSent).toBe(false);

    const invalid = harness();
    await expect(invalid.controller.streamConversationMessage(makeRequest({ content: ' ' }), makeResponse())).rejects.toBeDefined();
    const archived = harness({ archived: true });
    await expect(archived.controller.streamConversationMessage(makeRequest(), makeResponse())).rejects.toMatchObject({ name: 'ConversationArchived' });
    const missing = harness({ exists: false });
    await expect(missing.controller.streamConversationMessage(makeRequest(), makeResponse())).rejects.toMatchObject({ name: 'ConversationNotFound' });
    const busy = harness({ lockBusy: true }); const busyResponse = makeResponse();
    await expect(busy.controller.streamConversationMessage(makeRequest(), busyResponse)).rejects.toBeInstanceOf(ConversationTurnInProgress);
    expect(busyResponse.headersSent).toBe(false);
  });

  it('rejects an unauthorised SSE request before headers, persistence, or provider execution', async () => {
    const h = harness({ consentResults: [false] }); const res = makeResponse();
    await expect(h.controller.streamConversationMessage(makeRequest(), res)).rejects
      .toMatchObject({ name: 'ConversationProcessingConsentError', code: 'consent_required' });
    expect(res.headersSent).toBe(false);
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).not.toHaveBeenCalled();
    expect(h.generationRequests).toHaveLength(0);
  });

  it('emits a safe consent error if authorization is lost after the user message is persisted but before provider disclosure', async () => {
    const h = harness({ consentResults: [true, false] }); const res = makeResponse();
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.chunks.map(chunk => chunk.slice(0, chunk.indexOf('\n')))).toEqual(['event: message.started', 'event: stream.error']);
    expect(res.chunks.at(-1)).toContain('"code":"consent_required"');
    expect(h.generationRequests).toHaveLength(0);
    expect(h.messagesCreated.slice(2)).toHaveLength(1);
    expect(h.messagesCreated[2]).toMatchObject({ role: 'user', status: 'completed' });
    expect(res.chunks.join('')).not.toContain('message.delta');
  });

  it('emits a safe SSE consent error when the atomic persistence boundary detects a concurrent withdrawal', async () => {
    const h = harness({ atomicConsentError: new ConversationProcessingConsentError('consent_required') }); const res = makeResponse();
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(res.headersSent).toBe(true);
    expect(res.chunks.map(chunk => chunk.slice(0, chunk.indexOf('\n')))).toEqual(['event: stream.error']);
    expect(res.chunks[0]).toContain('"code":"consent_required"');
    expect(h.messagesCreated).toHaveLength(2);
    expect(h.generationRequests).toHaveLength(0);
  });

  it('emits a safe stream.error after provider deltas and never emits completion', async () => {
    const h = harness({ providerFails: true }); const res = makeResponse();
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(res.chunks.map(chunk => chunk.slice(0, chunk.indexOf('\n')))).toEqual(['event: message.started', 'event: message.delta', 'event: stream.error']);
    expect(res.chunks.join('')).not.toContain('private provider detail');
    expect(res.chunks.join('')).not.toContain('stream.completed');
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).toHaveBeenNthCalledWith(2, ownerId, { conversationId, role: 'assistant', content: '', status: 'failed' });
    expect(h.observer.recordFailure).toHaveBeenCalledWith({ operation: 'conversation_stream', stage: 'provider_stream', errorKind: 'unknown' });
    expect(JSON.stringify(h.observer.recordFailure.mock.calls)).not.toContain('private provider detail');
  });

  it('preserves a typed provider failure category and safe incomplete reason in observations', async () => {
    const h = harness({ providerFails: true, providerFailure: new AiTextGenerationError('incomplete_response', 'private provider payload', 'max_output_tokens') });
    const res = makeResponse();
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(h.observer.recordFailure).toHaveBeenCalledWith({
      operation: 'conversation_stream', stage: 'provider_stream', errorKind: 'incomplete_response', incompleteReason: 'max_output_tokens',
    });
    expect(res.chunks.at(-1)).toContain('"code":"generation_failed"');
    expect(JSON.stringify(h.observer.recordFailure.mock.calls)).not.toContain('private provider payload');
  });

  it('cancels on a real response close and does not report a completed turn', async () => {
    const h = harness(); const res = makeResponse('close-on-delta');
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(res.chunks.join('')).not.toContain('message.completed');
    expect(res.chunks.join('')).not.toContain('stream.completed');
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).toHaveBeenNthCalledWith(2, ownerId, { conversationId, role: 'assistant', content: '', status: 'failed' });
    expect(h.observer.recordFailure).toHaveBeenCalledWith({ operation: 'conversation_stream', stage: 'cancelled', errorKind: 'cancelled' });
  });

  it('classifies SSE write failures as transport errors, not provider failures', async () => {
    const h = harness(); const res = makeResponse('throw-on-delta');
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(res.chunks.join('')).not.toContain('stream.completed');
    expect(h.observer.recordFailure).toHaveBeenCalledWith({ operation: 'conversation_stream', stage: 'delta_write', errorKind: 'transport' });
    expect(h.observer.recordFailure.mock.calls.some(([entry]) => entry.stage === 'provider_stream')).toBe(false);
  });

  it('reports persistence_failed if the completed provider result cannot be stored', async () => {
    const h = harness({ persistAssistantFails: true }); const res = makeResponse();
    await h.controller.streamConversationMessage(makeRequest(), res);
    expect(res.chunks.map(chunk => chunk.slice(0, chunk.indexOf('\n')))).toEqual([
      'event: message.started', 'event: message.delta', 'event: message.delta', 'event: stream.error',
    ]);
    expect(res.chunks.at(-1)).toContain('"code":"persistence_failed"');
    expect(res.chunks.join('')).not.toContain('message.completed');
    expect(res.chunks.join('')).not.toContain('stream.completed');
    expect(h.observer.recordFailure).toHaveBeenCalledWith({ operation: 'conversation_stream', stage: 'assistant_persistence', errorKind: 'database' });
  });

  it('logs only the sanitized observation fields', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      new ConsoleConversationStreamObserver().recordFailure({
        operation: 'conversation_stream', stage: 'provider_stream', errorKind: 'incomplete_response', incompleteReason: 'max_output_tokens',
      });
      const rendered = JSON.stringify(warn.mock.calls);
      expect(rendered).toContain('incomplete_response');
      expect(rendered).toContain('max_output_tokens');
      expect(rendered).not.toMatch(/prompt|api.?key|jwt|stack|student text|generated/i);
    } finally { warn.mockRestore(); }
  });
});
