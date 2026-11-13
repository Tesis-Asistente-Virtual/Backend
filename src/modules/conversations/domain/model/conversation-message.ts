export const messageRoles = ['user', 'assistant'] as const;
export type MessageRole = (typeof messageRoles)[number];

export const messageStatuses = ['generating', 'completed', 'failed'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly status: MessageStatus;
  readonly createdAt: Date;
}

export interface NewConversationMessage {
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly status?: MessageStatus;
}

/** Incomplete assistant output is represented by empty content; streamed chunks are not persisted as messages. */
export function createConversationMessage(input: ConversationMessage): ConversationMessage {
  if (!messageRoles.includes(input.role)) throw new Error('Invalid conversation message role');
  if (!messageStatuses.includes(input.status)) throw new Error('Invalid conversation message status');
  if (input.role === 'user' && input.status !== 'completed') {
    throw new Error('User messages must be completed');
  }
  if (input.role === 'assistant' && input.status !== 'completed' && input.content !== '') {
    throw new Error('Incomplete assistant messages must not contain a partial response');
  }
  if (Number.isNaN(input.createdAt.getTime())) throw new Error('Message timestamp must be a valid date');
  return Object.freeze({ ...input });
}

export function orderConversationMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return [...messages].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
}
