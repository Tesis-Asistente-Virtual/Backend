import { z } from 'zod';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import type { ConversationTurnLock } from '../../ports/conversation-turn-lock.js';
import { ConversationNotFound } from '../query-services/get-conversation.js';

/** Explicit owner-initiated suppression of one conversation and its database-cascaded content. */
export class DeleteMyConversation {
  constructor(private readonly conversations: ConversationRepository, private readonly turnLock: ConversationTurnLock) {}

  async execute(accountIdValue: string, conversationIdValue: string): Promise<void> {
    const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
    const conversationId = z.string().uuid().parse(conversationIdValue).toLowerCase();
    await this.turnLock.runExclusive(conversationId, async () => {
      const deleted = await this.conversations.deleteForOwner(accountId, conversationId);
      if (!deleted) throw new ConversationNotFound();
    });
  }
}
