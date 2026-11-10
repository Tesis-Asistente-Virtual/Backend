export const conversationStatuses = ['active', 'archived'] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

export interface Conversation {
  readonly id: string;
  readonly accountId: string;
  readonly title: string | null;
  readonly status: ConversationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewConversation {
  readonly accountId: string;
  readonly title?: string | null;
  readonly status?: ConversationStatus;
}

export function createConversation(input: Conversation): Conversation {
  if (!conversationStatuses.includes(input.status)) {
    throw new Error('Invalid conversation status');
  }
  if (input.title !== null && input.title.length > 150) {
    throw new Error('Conversation title cannot exceed 150 characters');
  }
  if (Number.isNaN(input.createdAt.getTime()) || Number.isNaN(input.updatedAt.getTime())) {
    throw new Error('Conversation timestamps must be valid dates');
  }
  return Object.freeze({ ...input });
}
