import { z } from 'zod';
import type { ConsentPurposeChecker } from '../../../../consent/application/ports/consent-purpose-checker.js';
import type { ConversationMessage } from '../../../../conversations/domain/model/conversation-message.js';
import type { ConversationMessageRepository } from '../../../../conversations/domain/repositories/conversation-message-repository.js';
import type { ConversationRepository } from '../../../../conversations/domain/repositories/conversation-repository.js';
import {
  ConversationSignalExtractionError,
  parseConversationSignalExtraction,
  type ConversationSignalExtractor,
  type ExtractConversationSignalsInput,
} from '../../ports/conversation-signal-extractor.js';

const requestSchema = z.object({
  conversationId: z.string().uuid().transform(value => value.toLowerCase()),
  messageIds: z.array(z.string().uuid().transform(value => value.toLowerCase())).min(1).max(20).refine(
    values => new Set(values).size === values.length,
    'Message references must be unique',
  ),
}).strict();

export class SignalConversationNotFound extends Error {
  constructor() { super('Conversation is unavailable'); this.name = 'SignalConversationNotFound'; }
}

export class SignalConsentRequired extends Error {
  constructor() { super('Required consent is not granted'); this.name = 'SignalConsentRequired'; }
}

export class SignalMessageReferencesInvalid extends Error {
  constructor() { super('Conversation message references are invalid'); this.name = 'SignalMessageReferencesInvalid'; }
}

function chronologically(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return [...messages].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
}

/** Internal orchestration; callers must pass the account identity from a verified auth context. */
export class ExtractAuthorizedConversationSignals {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: ConversationMessageRepository,
    private readonly consent: ConsentPurposeChecker,
    private readonly extractor: ConversationSignalExtractor,
  ) {}

  async execute(accountIdValue: string, inputValue: unknown, signal?: AbortSignal) {
    const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
    const input = requestSchema.parse(inputValue);
    if (signal?.aborted) throw new ConversationSignalExtractionError('cancelled');

    const conversation = await this.conversations.findByIdForOwner(input.conversationId, accountId);
    if (!conversation || conversation.accountId !== accountId) throw new SignalConversationNotFound();

    await this.assertRequiredConsents(accountId);

    const ownedMessages = await this.messages.findByIdsForOwner(input.conversationId, accountId, input.messageIds);
    if (ownedMessages.length !== input.messageIds.length || ownedMessages.some(message =>
      message.conversationId !== conversation.id || message.status !== 'completed',
    )) throw new SignalMessageReferencesInvalid();

    const orderedMessages = chronologically(ownedMessages);
    const requestedIds = new Set(input.messageIds);
    if (orderedMessages.some(message => !requestedIds.has(message.id))) throw new SignalMessageReferencesInvalid();

    const extractionInput: ExtractConversationSignalsInput = {
      messages: orderedMessages.map(({ id: messageId, role, content }) => ({ messageId, role, content })),
    };

    // Re-check immediately before sending content to the provider to narrow the revocation race.
    await this.assertRequiredConsents(accountId);
    if (signal?.aborted) throw new ConversationSignalExtractionError('cancelled');

    const result = await this.extractor.extract(extractionInput, signal);
    const validated = parseConversationSignalExtraction(result);
    const suppliedIds = new Set(extractionInput.messages.map(message => message.messageId));
    if (validated.observations.some(observation => observation.sourceMessageIds.some(id => !suppliedIds.has(id)))) {
      throw new ConversationSignalExtractionError('invalid_response');
    }
    return validated;
  }

  private async assertRequiredConsents(accountId: string): Promise<void> {
    const structuredExtractionGranted = await this.consent.execute(accountId, 'structured_signal_extraction');
    if (!structuredExtractionGranted) throw new SignalConsentRequired();
    const aiProcessingGranted = await this.consent.execute(accountId, 'ai_conversation_processing');
    if (!aiProcessingGranted) throw new SignalConsentRequired();
  }
}
