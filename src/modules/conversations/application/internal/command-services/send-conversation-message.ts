import type { AiTextGenerator } from '../../ports/ai-text-generator.js';
import type { ConversationTurnLock } from '../../ports/conversation-turn-lock.js';
import type { ConversationMessage } from '../../../domain/model/conversation-message.js';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import type { ConversationMessageRepository } from '../../../domain/repositories/conversation-message-repository.js';
import { ConversationNotFound } from '../query-services/get-conversation.js';
import { assistantInstructions } from '../../assistant-instructions.js';

export const MAX_USER_MESSAGE_CHARACTERS = 5_000;

export class ConversationArchived extends Error {
  constructor() { super('Conversation is archived'); this.name = 'ConversationArchived'; }
}

export class InvalidConversationMessage extends Error {
  constructor() { super('Conversation message is invalid'); this.name = 'InvalidConversationMessage'; }
}

export class AssistantGenerationUnavailable extends Error {
  constructor() { super('Assistant generation is temporarily unavailable'); this.name = 'AssistantGenerationUnavailable'; }
}

export interface SentConversationTurn {
  readonly userMessage: ConversationMessage;
  readonly assistantMessage: ConversationMessage;
}

export class SendConversationMessage {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: ConversationMessageRepository,
    private readonly generator: AiTextGenerator,
    private readonly turnLock: ConversationTurnLock,
    private readonly maxContextMessages: number,
    private readonly maxOutputTokens: number,
  ) {}

  async execute(accountId: string, conversationId: string, rawContent: string): Promise<SentConversationTurn> {
    const content = rawContent.trim();
    if (!content || content.length > MAX_USER_MESSAGE_CHARACTERS) throw new InvalidConversationMessage();
    return this.turnLock.runExclusive(conversationId, async () => {
      const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
      if (!conversation) throw new ConversationNotFound();
      if (conversation.status !== 'active') throw new ConversationArchived();

      const userMessage = await this.messages.createForOwner(accountId, {
        conversationId,
        role: 'user',
        content,
        status: 'completed',
      });
      if (!userMessage) throw new ConversationNotFound();

      const recentMessages = await this.messages.listRecentCompletedForOwner(
        conversationId,
        accountId,
        this.maxContextMessages,
      );
      const previousLimit = Math.max(0, this.maxContextMessages - 1);
      const completedPreviousMessages = recentMessages
        .filter(message => message.status === 'completed' && message.id !== userMessage.id);
      const previousContext = previousLimit > 0 ? completedPreviousMessages.slice(-previousLimit) : [];
      const context = [...previousContext, userMessage]
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        .map(({ role, content: messageContent }) => ({ role, content: messageContent }));

      let generatedText: string;
      try {
        const result = await this.generator.generateText({
          instructions: assistantInstructions,
          messages: context,
          maxOutputTokens: this.maxOutputTokens,
        });
        generatedText = result.text.trim();
        if (!generatedText) throw new Error('Provider returned empty text');
      } catch {
        const failedMessage = await this.messages.createForOwner(accountId, {
          conversationId,
          role: 'assistant',
          content: '',
          status: 'failed',
        });
        if (!failedMessage) throw new ConversationNotFound();
        throw new AssistantGenerationUnavailable();
      }

      const assistantMessage = await this.messages.createForOwner(accountId, {
        conversationId,
        role: 'assistant',
        content: generatedText,
        status: 'completed',
      });
      if (!assistantMessage) throw new ConversationNotFound();
      return { userMessage, assistantMessage };
    });
  }
}
