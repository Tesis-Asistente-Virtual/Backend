import { z } from 'zod';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';

/** Cierra todas las conversaciones activas del titular antes de empezar una nueva. Devuelve cuántas cerró. */
export class ArchiveActiveConversations {
  constructor(private readonly conversations: ConversationRepository) {}

  async execute(accountIdValue: string): Promise<number> {
    const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
    return this.conversations.archiveActiveForOwner(accountId);
  }
}
