import { describe, expect, it } from 'vitest';
import { conversationStatuses, createConversation } from '../../../src/modules/conversations/domain/model/conversation.js';
import { createConversationMessage, messageRoles, messageStatuses, orderConversationMessages } from '../../../src/modules/conversations/domain/model/conversation-message.js';

const date = new Date('2026-01-01T00:00:00.000Z');
const accountId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';

function conversation(status: 'active' | 'archived' = 'active') {
  return createConversation({ id: conversationId, accountId, title: null, status, createdAt: date, updatedAt: date });
}

function message(id: string, createdAt: Date, role: 'user' | 'assistant' = 'user', status: 'generating' | 'completed' | 'failed' = 'completed', content = 'hello') {
  return createConversationMessage({ id, conversationId, role, status, content, createdAt });
}

describe('Conversation domain model', () => {
  it('accepts active and archived states', () => {
    expect(conversationStatuses).toEqual(['active', 'archived']);
    expect(conversation().status).toBe('active');
    expect(conversation('archived').status).toBe('archived');
  });

  it('rejects invalid status and overlong titles', () => {
    expect(() => createConversation({ ...conversation(), status: 'deleted' as 'active' })).toThrow('Invalid conversation status');
    expect(() => createConversation({ ...conversation(), title: 'x'.repeat(151) })).toThrow('150 characters');
  });
});

describe('ConversationMessage domain model', () => {
  it('accepts the declared roles and statuses', () => {
    expect(messageRoles).toEqual(['user', 'assistant']);
    expect(messageStatuses).toEqual(['generating', 'completed', 'failed']);
    expect(message('m1', date).role).toBe('user');
    expect(message('m2', date, 'assistant', 'generating', '')).toMatchObject({ status: 'generating', content: '' });
    expect(message('m3', date, 'assistant', 'failed', '')).toMatchObject({ status: 'failed', content: '' });
  });

  it('rejects invalid message invariants', () => {
    expect(() => createConversationMessage({ ...message('m1', date), role: 'system' as 'user' })).toThrow('role');
    expect(() => createConversationMessage({ ...message('m1', date), status: 'queued' as 'completed' })).toThrow('status');
    expect(() => message('m1', date, 'assistant', 'generating', 'partial output')).toThrow('partial response');
    expect(() => message('m1', date, 'user', 'failed', '')).toThrow('User messages must be completed');
  });

  it('orders messages by creation time and then ID for ties', () => {
    const sameTime = new Date(date);
    const later = new Date(date.getTime() + 1000);
    const ordered = orderConversationMessages([
      message('b', sameTime), message('c', later), message('a', sameTime),
    ]);
    expect(ordered.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });
});
