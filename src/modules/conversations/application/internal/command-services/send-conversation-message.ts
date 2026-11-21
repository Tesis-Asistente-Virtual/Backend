import type { AiTextGenerator } from '../../ports/ai-text-generator.js';
import type { ConversationTurnLock } from '../../ports/conversation-turn-lock.js';
import type { ConversationMessage } from '../../../domain/model/conversation-message.js';
import type { ConversationRepository } from '../../../domain/repositories/conversation-repository.js';
import type { ConversationMessageRepository } from '../../../domain/repositories/conversation-message-repository.js';
import { ConversationNotFound } from '../query-services/get-conversation.js';
import { assistantInstructions } from '../../assistant-instructions.js';
import { buildConversationContext } from './build-conversation-context.js';
import { requireConversationProcessingConsent, type ConversationProcessingConsentAuthorizer } from '../../ports/conversation-processing-consent.js';

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
    private readonly consent: ConversationProcessingConsentAuthorizer,
  ) {}

  async execute(accountId: string, conversationId: string, rawContent: string): Promise<SentConversationTurn> {
    const content = rawContent.trim();
    if (!content || content.length > MAX_USER_MESSAGE_CHARACTERS) throw new InvalidConversationMessage();
    return this.turnLock.runExclusive(conversationId, async () => {
      const conversation = await this.conversations.findByIdForOwner(conversationId, accountId);
      if (!conversation) throw new ConversationNotFound();
      if (conversation.status !== 'active') throw new ConversationArchived();

      await requireConversationProcessingConsent(this.consent, accountId);
      const userMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, {
        conversationId,
        role: 'user',
        content,
        status: 'completed',
      });
      if (!userMessage) throw new ConversationNotFound();

      const context = await buildConversationContext(this.messages, conversationId, accountId, userMessage, this.maxContextMessages);

      // Revalidate immediately before disclosing the context to the provider.
      await requireConversationProcessingConsent(this.consent, accountId);
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
        try {
          await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, {
            conversationId, role: 'assistant', content: '', status: 'failed',
          });
        } catch {
          // A revocation or persistence failure must not be replaced by a secondary failure write.
        }
        throw new AssistantGenerationUnavailable();
      }

      const assistantMessage = await this.messages.createForOwnerWithCurrentProcessingConsent(accountId, {
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
