import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ConversationsController } from '../../../src/modules/conversations/interfaces/rest/resources/conversations-controller.js';
import { ConversationNotFound, GetConversation } from '../../../src/modules/conversations/application/internal/query-services/get-conversation.js';
import { CreateConversation } from '../../../src/modules/conversations/application/internal/command-services/create-conversation.js';
import { ListConversations } from '../../../src/modules/conversations/application/internal/query-services/list-conversations.js';
import { ListConversationMessages } from '../../../src/modules/conversations/application/internal/query-services/list-conversation-messages.js';
import type { Conversation, NewConversation } from '../../../src/modules/conversations/domain/model/conversation.js';
import type { ConversationMessage } from '../../../src/modules/conversations/domain/model/conversation-message.js';
import type { Page, Pagination } from '../../../src/modules/conversations/domain/model/pagination.js';
import type { ConversationRepository } from '../../../src/modules/conversations/domain/repositories/conversation-repository.js';
import type { ConversationMessageRepository } from '../../../src/modules/conversations/domain/repositories/conversation-message-repository.js';
import type { AiTextGenerator } from '../../../src/modules/conversations/application/ports/ai-text-generator.js';
import type { ConversationTurnLock } from '../../../src/modules/conversations/application/ports/conversation-turn-lock.js';
import { SendConversationMessage } from '../../../src/modules/conversations/application/internal/command-services/send-conversation-message.js';
import { DeleteMyConversation } from '../../../src/modules/conversations/application/internal/command-services/delete-my-conversation.js';
import { errorHandler } from '../../../src/shared/infrastructure/http/error-handler.js';
import { paginationQuerySchema } from '../../../src/modules/conversations/interfaces/rest/validation/conversation-request-schemas.js';
import type { ConversationProcessingConsentAuthorizer } from '../../../src/modules/conversations/application/ports/conversation-processing-consent.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const createdAt = new Date('2026-01-01T00:00:00.000Z');
const conversation: Conversation = { id: conversationId, accountId, title: null, status: 'active', createdAt, updatedAt: createdAt };
const message: ConversationMessage = { id: '550e8400-e29b-41d4-a716-446655440002', conversationId, role: 'assistant', content: 'Hello', status: 'completed', createdAt };

function harness(foundConversation: Conversation | null = conversation, generationConfigured = true, consentGranted = true) {
  const conversations: ConversationRepository = {
    create: vi.fn(async (input: NewConversation) => ({ ...conversation, accountId: input.accountId, title: input.title ?? null })),
    findByIdForOwner: vi.fn(async (id: string, ownerId: string) => id === conversationId && ownerId === accountId ? foundConversation : null),
    listByOwner: vi.fn(async (_ownerId: string, pagination: Pagination): Promise<Page<Conversation>> => ({ items: [conversation], ...pagination, hasMore: false })),
    deleteForOwner: vi.fn(async () => true),
    archiveActiveForOwner: vi.fn(async () => 0),
  };
  const createMessage = vi.fn(async (_ownerId: string, input: Parameters<ConversationMessageRepository['createForOwner']>[1]) => ({ ...message, role: input.role, content: input.content, status: input.status ?? 'completed' }));
  const messages: ConversationMessageRepository = {
    createForOwner: createMessage,
    createForOwnerWithCurrentProcessingConsent: createMessage,
    listByConversationForOwner: vi.fn(async (_id: string, _ownerId: string, pagination: Pagination): Promise<Page<ConversationMessage>> => ({ items: [message], ...pagination, hasMore: false })),
    listRecentCompletedForOwner: vi.fn(async () => []),
  };
  const generator: AiTextGenerator = {
    generateText: vi.fn(async () => ({ text: 'Generated response' })),
    async *streamText() {},
  };
  const lock: ConversationTurnLock = { runExclusive: vi.fn(async (_id, operation) => operation()) };
  const consent: ConversationProcessingConsentAuthorizer = { isAuthorized: vi.fn(async () => consentGranted) };
  return {
    controller: new ConversationsController(
      new CreateConversation(conversations),
      new ListConversations(conversations),
      new GetConversation(conversations),
      new ListConversationMessages(conversations, messages),
      generationConfigured ? new SendConversationMessage(conversations, messages, generator, lock, 4, 250, consent) : undefined,
      undefined,
      new DeleteMyConversation(conversations, lock),
    ), conversations, messages,
  };
}

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function request(authenticated = true, body: unknown = {}, params: unknown = {}, query: unknown = {}) {
  return { auth: authenticated ? { accountId } : undefined, body, params, query } as unknown as Request;
}

describe('Conversations REST controllers', () => {
  it('creates a conversation for the authenticated account and defaults an omitted title to null', async () => {
    const h = harness(); const res = response();
    await h.controller.create(request(true, {}), res);
    expect(h.conversations.create).toHaveBeenCalledWith({ accountId, title: null });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: conversationId, title: null }));
  });

  it('lists only conversations for the authenticated account with validated default pagination', async () => {
    const h = harness(); const res = response();
    await h.controller.list(request(true, {}, {}, {}), res);
    expect(h.conversations.listByOwner).toHaveBeenCalledWith(accountId, { limit: 20, offset: 0 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('gets a conversation and its messages using the authenticated owner ID', async () => {
    const h = harness(); const res = response();
    await h.controller.get(request(true, {}, { id: conversationId }), res);
    expect(h.conversations.findByIdForOwner).toHaveBeenCalledWith(conversationId, accountId);
    await h.controller.listConversationMessages(request(true, {}, { id: conversationId }, { limit: '5', offset: '10' }), res);
    expect(h.messages.listByConversationForOwner).toHaveBeenCalledWith(conversationId, accountId, { limit: 5, offset: 10 });
  });

  it('deletes only the authenticated owner conversation and returns 204', async () => {
    const h = harness(); const res = response();
    await h.controller.delete(request(true, {}, { id: conversationId }), res);
    expect(h.conversations.deleteForOwner).toHaveBeenCalledWith(accountId, conversationId);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('does not invoke suppression without an authenticated account', async () => {
    const h = harness(); const res = response();
    await h.controller.delete(request(false, {}, { id: conversationId }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(h.conversations.deleteForOwner).not.toHaveBeenCalled();
  });

  it('sends a message using only the authenticated owner ID and returns both persisted message DTOs', async () => {
    const h = harness(); const res = response();
    await h.controller.sendConversationMessage(request(true, { content: 'Student input' }, { id: conversationId }), res);
    expect(h.conversations.findByIdForOwner).toHaveBeenCalledWith(conversationId, accountId);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      userMessage: expect.objectContaining({ role: 'user', content: 'Student input', status: 'completed' }),
      assistantMessage: expect.objectContaining({ role: 'assistant', content: 'Generated response', status: 'completed' }),
    });
  });

  it('rejects UUIDs, unknown body/query properties and invalid pagination', async () => {
    const h = harness(); const res = response();
    await expect(h.controller.get(request(true, {}, { id: 'bad-id' }), res)).rejects.toBeInstanceOf(ZodError);
    await expect(h.controller.create(request(true, { title: 'New', accountId }), res)).rejects.toBeInstanceOf(ZodError);
    await expect(h.controller.sendConversationMessage(request(true, { content: 'Hello', accountId }, { id: conversationId }), res)).rejects.toBeInstanceOf(ZodError);
    await expect(h.controller.sendConversationMessage(request(true, { content: '  ' }, { id: conversationId }), res)).rejects.toBeInstanceOf(ZodError);
    await expect(h.controller.sendConversationMessage(request(true, { content: 'x'.repeat(5_001) }, { id: conversationId }), res)).rejects.toBeInstanceOf(ZodError);
    await expect(h.controller.list(request(true, {}, {}, { limit: '101' }), res)).rejects.toBeInstanceOf(ZodError);
    await expect(h.controller.list(request(true, {}, {}, { other: '1' }), res)).rejects.toBeInstanceOf(ZodError);
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(() => paginationQuerySchema.parse({ limit: '0' })).toThrow(ZodError);
    expect(() => paginationQuerySchema.parse({ offset: '1000001' })).toThrow(ZodError);
  });

  it('returns 401 when no authenticated account context exists', async () => {
    const h = harness(); const res = response();
    await h.controller.list(request(false), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(h.conversations.listByOwner).not.toHaveBeenCalled();
  });

  it('returns a safe service-unavailable error when OpenAI is not configured', async () => {
    const h = harness(conversation, false); const res = response();
    let failure: unknown;
    try { await h.controller.sendConversationMessage(request(true, { content: 'Hello' }, { id: conversationId }), res); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ name: 'AssistantGenerationUnavailable' });
    errorHandler(failure, {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Text generation is temporarily unavailable' });
  });

  it('returns 403 and performs no message write or generation without current purpose consent', async () => {
    const h = harness(conversation, true, false); const res = response();
    let failure: unknown;
    try { await h.controller.sendConversationMessage(request(true, { content: 'Sensitive text' }, { id: conversationId }), res); } catch (error) { failure = error; }
    errorHandler(failure, {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Current ai_conversation_processing consent is required' });
    expect(h.messages.createForOwnerWithCurrentProcessingConsent).not.toHaveBeenCalled();
  });

  it('maps an absent or foreign conversation to a generic 404', async () => {
    const h = harness(null); const res = response();
    await expect(h.controller.get(request(true, {}, { id: conversationId }), res)).rejects.toBeInstanceOf(ConversationNotFound);
    errorHandler(new ConversationNotFound(), {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Conversation not found' });
  });
});
