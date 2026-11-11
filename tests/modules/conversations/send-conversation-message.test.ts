import { describe, expect, it, vi } from 'vitest';
import type { AiTextGenerationRequest, AiTextGenerator } from '../../../src/modules/conversations/application/ports/ai-text-generator.js';
import { ConversationTurnInProgress, type ConversationTurnLock } from '../../../src/modules/conversations/application/ports/conversation-turn-lock.js';
import { AssistantGenerationUnavailable, ConversationArchived, InvalidConversationMessage, SendConversationMessage } from '../../../src/modules/conversations/application/internal/command-services/send-conversation-message.js';
import { ConversationNotFound } from '../../../src/modules/conversations/application/internal/query-services/get-conversation.js';
import type { Conversation } from '../../../src/modules/conversations/domain/model/conversation.js';
import type { ConversationMessage, NewConversationMessage } from '../../../src/modules/conversations/domain/model/conversation-message.js';
import type { Page, Pagination } from '../../../src/modules/conversations/domain/model/pagination.js';
import type { ConversationRepository } from '../../../src/modules/conversations/domain/repositories/conversation-repository.js';
import type { ConversationMessageRepository } from '../../../src/modules/conversations/domain/repositories/conversation-message-repository.js';
import { assistantInstructions } from '../../../src/modules/conversations/application/assistant-instructions.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const now = new Date('2026-05-01T12:00:00.000Z');

function message(id: string, role: 'user' | 'assistant', content: string, status: 'completed' | 'failed' = 'completed', offset = 0): ConversationMessage {
  return { id, conversationId, role, content, status, createdAt: new Date(now.getTime() + offset) };
}

function harness(options: { status?: 'active' | 'archived' | null; providerError?: Error; providerText?: string; recent?: ConversationMessage[]; lockError?: Error } = {}) {
  const conversation: Conversation = { id: conversationId, accountId, title: null, status: options.status ?? 'active', createdAt: now, updatedAt: now };
  const created: ConversationMessage[] = [];
  const conversations: ConversationRepository = {
    create: vi.fn(),
    findByIdForOwner: vi.fn(async (id: string, ownerId: string) => id === conversationId && ownerId === accountId && options.status !== null ? conversation : null),
    listByOwner: vi.fn(async (_ownerId: string, pagination: Pagination): Promise<Page<Conversation>> => ({ items: [], ...pagination, hasMore: false })),
  };
  const messages: ConversationMessageRepository = {
    createForOwner: vi.fn(async (ownerId: string, input: NewConversationMessage) => {
      if (ownerId !== accountId) return null;
      const row = message(`message-${created.length + 1}`, input.role, input.content, input.status === 'failed' ? 'failed' : 'completed', created.length);
      created.push(row);
      return row;
    }),
    listByConversationForOwner: vi.fn(async (_id: string, _ownerId: string, pagination: Pagination): Promise<Page<ConversationMessage>> => ({ items: [], ...pagination, hasMore: false })),
    listRecentCompletedForOwner: vi.fn(async (id: string, ownerId: string, _limit: number) => id === conversationId && ownerId === accountId ? options.recent ?? [] : []),
  };
  let capturedRequest: AiTextGenerationRequest | undefined;
  const generator: AiTextGenerator = {
    generateText: vi.fn(async (request: AiTextGenerationRequest) => {
      capturedRequest = request;
      if (options.providerError) throw options.providerError;
      return { text: options.providerText ?? 'Respuesta de apoyo.' };
    }),
  };
  const lockCalls: string[] = [];
  const lock: ConversationTurnLock = {
    async runExclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
      lockCalls.push(id);
      if (options.lockError) throw options.lockError;
      return operation();
    },
  };
  return {
    service: new SendConversationMessage(conversations, messages, generator, lock, 4, 250),
    conversations, messages, generator, lock, lockCalls, created, getCapturedRequest: () => capturedRequest,
  };
}

describe('SendConversationMessage', () => {
  it('persists the user and assistant messages and sends ordered completed context with the current turn once', async () => {
    const oldUser = message('old-user', 'user', 'Earlier user message', 'completed', -300);
    const oldAssistant = message('old-assistant', 'assistant', 'Earlier response', 'completed', -200);
    const failed = message('failed-assistant', 'assistant', '', 'failed', -100);
    const h = harness({ recent: [oldUser, oldAssistant, failed] });
    const result = await h.service.execute(accountId, conversationId, '  Current question  ');
    const sentContext = h.getCapturedRequest()?.messages ?? [];

    expect(h.lockCalls).toEqual([conversationId]);
    expect(h.messages.createForOwner).toHaveBeenNthCalledWith(1, accountId, expect.objectContaining({ role: 'user', content: 'Current question', status: 'completed' }));
    expect(h.messages.createForOwner).toHaveBeenNthCalledWith(2, accountId, expect.objectContaining({ role: 'assistant', content: 'Respuesta de apoyo.', status: 'completed' }));
    expect(h.messages.listRecentCompletedForOwner).toHaveBeenCalledWith(conversationId, accountId, 4);
    expect(sentContext.map(item => item.content)).toEqual(['Earlier user message', 'Earlier response', 'Current question']);
    expect(sentContext.filter(item => item.content === 'Current question')).toHaveLength(1);
    expect(h.getCapturedRequest()?.instructions).toBe(assistantInstructions);
    expect(h.getCapturedRequest()?.maxOutputTokens).toBe(250);
    expect(result.userMessage.role).toBe('user');
    expect(result.assistantMessage).toMatchObject({ role: 'assistant', status: 'completed', content: 'Respuesta de apoyo.' });
    expect(h.created).toHaveLength(2);
  });

  it('does not write or call the provider for missing, foreign or archived conversations', async () => {
    const missing = harness({ status: null });
    await expect(missing.service.execute(accountId, conversationId, 'Hello')).rejects.toBeInstanceOf(ConversationNotFound);
    expect(missing.messages.createForOwner).not.toHaveBeenCalled();
    const archived = harness({ status: 'archived' });
    await expect(archived.service.execute(accountId, conversationId, 'Hello')).rejects.toBeInstanceOf(ConversationArchived);
    expect(archived.messages.createForOwner).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized user messages before acquiring a lock or writing', async () => {
    const h = harness();
    await expect(h.service.execute(accountId, conversationId, '   ')).rejects.toBeInstanceOf(InvalidConversationMessage);
    await expect(h.service.execute(accountId, conversationId, 'x'.repeat(5_001))).rejects.toBeInstanceOf(InvalidConversationMessage);
    expect(h.lockCalls).toEqual([]);
    expect(h.messages.createForOwner).not.toHaveBeenCalled();
  });

  it('records an empty failed assistant turn and returns a safe error for provider failures and timeouts', async () => {
    for (const providerError of [new Error('provider secret'), new Error('timeout private detail')]) {
      const h = harness({ providerError });
      await expect(h.service.execute(accountId, conversationId, 'Help')).rejects.toBeInstanceOf(AssistantGenerationUnavailable);
      expect(h.messages.createForOwner).toHaveBeenNthCalledWith(2, accountId, expect.objectContaining({ role: 'assistant', content: '', status: 'failed' }));
      expect(h.created).toHaveLength(2);
    }
  });

  it('never persists a blank provider response as a completed assistant message', async () => {
    const h = harness({ providerText: '  ' });
    await expect(h.service.execute(accountId, conversationId, 'Help')).rejects.toBeInstanceOf(AssistantGenerationUnavailable);
    expect(h.messages.createForOwner).toHaveBeenNthCalledWith(2, accountId, expect.objectContaining({ role: 'assistant', content: '', status: 'failed' }));
  });

  it('propagates a distributed lock conflict without inserting another turn', async () => {
    const h = harness({ lockError: new ConversationTurnInProgress() });
    await expect(h.service.execute(accountId, conversationId, 'Retry')).rejects.toBeInstanceOf(ConversationTurnInProgress);
    expect(h.messages.createForOwner).not.toHaveBeenCalled();
    expect(h.generator.generateText).not.toHaveBeenCalled();
  });
});
