import { describe, expect, it, vi } from 'vitest';
import { CheckConsentForPurpose } from '../../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import type { ConsentPurpose, ConsentStatus } from '../../../src/modules/consent/domain/model/consent.js';
import type { ConsentRepository } from '../../../src/modules/consent/domain/repositories/consent-repository.js';
import { createConversation, type Conversation } from '../../../src/modules/conversations/domain/model/conversation.js';
import { createConversationMessage, type ConversationMessage } from '../../../src/modules/conversations/domain/model/conversation-message.js';
import type { ConversationMessageRepository } from '../../../src/modules/conversations/domain/repositories/conversation-message-repository.js';
import type { ConversationRepository } from '../../../src/modules/conversations/domain/repositories/conversation-repository.js';
import {
  ConversationSignalExtractionError,
  type ConversationSignalExtractor,
  type ConversationSignalExtraction,
} from '../../../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import {
  ExtractAuthorizedConversationSignals,
  SignalAuthorizationUnavailable,
  SignalConsentRequired,
  SignalConversationNotFound,
  SignalMessageReferencesInvalid,
} from '../../../src/modules/conversational-processing/application/internal/command-services/extract-authorized-conversation-signals.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const otherAccountId = '550e8400-e29b-41d4-a716-446655440099';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const messageId1 = '550e8400-e29b-41d4-a716-446655440010';
const messageId2 = '550e8400-e29b-41d4-a716-446655440011';
const at = new Date('2026-01-01T00:00:00.000Z');

function consentStatus(overrides: Partial<Record<ConsentPurpose, ConsentStatus['state']>> = {}): ConsentStatus[] {
  const purposes: ConsentPurpose[] = ['ai_conversation_processing', 'structured_signal_extraction', 'longitudinal_monitoring', 'preliminary_assessment'];
  return purposes.map(purpose => ({
    purpose,
    state: overrides[purpose] ?? 'not_decided',
    currentNoticeVersion: 'test-current',
    changedAt: at,
  }));
}

function makeConversation(ownerId = accountId): Conversation {
  return createConversation({ id: conversationId, accountId: ownerId, title: null, status: 'active', createdAt: at, updatedAt: at });
}

function makeMessage(id: string, createdAt: Date, content: string, ownerConversationId = conversationId): ConversationMessage {
  return createConversationMessage({ id, conversationId: ownerConversationId, role: 'user', status: 'completed', content, createdAt });
}

const validResult: ConversationSignalExtraction = {
  schemaVersion: '1.0',
  observations: [{
    evidence: 'reported',
    manifestation: { status: 'reported', value: 'Refiere sobrecarga por exámenes.' },
    possibleDimensions: ['stress'],
    duration: { status: 'not_reported' },
    frequency: { status: 'not_assessed' },
    intensity: { status: 'not_assessed' },
    contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Exámenes universitarios.' } }],
    functionalImpact: { status: 'ambiguous', note: null },
    sourceMessageIds: [messageId1],
  }],
  missingInformation: [{ field: 'duration', reason: 'not_reported' }],
  clarificationQuestions: ['¿Desde cuándo ocurre?'],
};

interface HarnessOptions {
  readonly conversation?: Conversation | null;
  readonly messages?: ConversationMessage[];
  readonly statusReads?: ConsentStatus[][];
  readonly consentError?: Error;
  readonly extraction?: ConversationSignalExtraction;
  readonly extractorError?: Error;
  readonly order?: string[];
}

function harness(options: HarnessOptions = {}) {
  const ownedConversation = options.conversation === undefined ? makeConversation() : options.conversation;
  const defaultMessages = [
    makeMessage(messageId1, new Date(at.getTime() + 1000), 'Segundo mensaje'),
    makeMessage(messageId2, at, 'Primer mensaje'),
  ];
  const conversationRepository: ConversationRepository = {
    create: vi.fn(async () => makeConversation()),
    findByIdForOwner: vi.fn(async (id: string, ownerId: string) => {
      options.order?.push('owner');
      return id === conversationId && ownerId === accountId ? ownedConversation ?? null : null;
    }),
    listByOwner: vi.fn(async () => ({ items: [], limit: 10, offset: 0, hasMore: false })),
  };
  const messageRepository: ConversationMessageRepository = {
    createForOwner: vi.fn(async () => null),
    createForOwnerWithCurrentProcessingConsent: vi.fn(async () => null),
    findByIdsForOwner: vi.fn(async (_conversationId: string, _ownerId: string, requestedIds: readonly string[]) => {
      options.order?.push('messages');
      const returned = options.messages ?? defaultMessages;
      return returned.filter(message => requestedIds.includes(message.id));
    }),
    listByConversationForOwner: vi.fn(async () => ({ items: [], limit: 10, offset: 0, hasMore: false })),
    listRecentCompletedForOwner: vi.fn(async () => []),
  };
  let readIndex = 0;
  const consentRepository: ConsentRepository = {
    listAvailableNotices: vi.fn(async () => []),
    getStatus: vi.fn(async () => {
      options.order?.push('consent');
      if (options.consentError) throw options.consentError;
      const statuses = options.statusReads?.[readIndex] ?? consentStatus({
        ai_conversation_processing: 'granted',
        structured_signal_extraction: 'granted',
      });
      readIndex += 1;
      return statuses;
    }),
    recordDecision: vi.fn(async () => null),
  };
  const extractor: ConversationSignalExtractor = {
    extract: vi.fn(async () => {
      options.order?.push('extractor');
      if (options.extractorError) throw options.extractorError;
      return options.extraction ?? validResult;
    }),
  };
  const useCase = new ExtractAuthorizedConversationSignals(
    conversationRepository,
    messageRepository,
    new CheckConsentForPurpose(consentRepository),
    extractor,
  );
  return { useCase, conversationRepository, messageRepository, consentRepository, extractor, order: options.order };
}

const request = { conversationId, messageIds: [messageId1, messageId2] };

describe('ExtractAuthorizedConversationSignals', () => {
  it('checks owner and both consents before loading minimal ordered messages and extracting', async () => {
    const order: string[] = [];
    const h = harness({ order });
    const result = await h.useCase.execute(accountId, request);

    expect(result).toEqual(validResult);
    expect(h.consentRepository.getStatus).toHaveBeenCalledTimes(4);
    expect(h.messageRepository.findByIdsForOwner).toHaveBeenCalledWith(conversationId, accountId, [messageId1, messageId2]);
    expect(h.extractor.extract).toHaveBeenCalledWith({ messages: [
      { messageId: messageId2, role: 'user', content: 'Primer mensaje' },
      { messageId: messageId1, role: 'user', content: 'Segundo mensaje' },
    ] }, undefined);
    expect(order).toEqual(['owner', 'consent', 'consent', 'messages', 'consent', 'consent', 'extractor']);
    expect(h.messageRepository.createForOwner).not.toHaveBeenCalled();
  });

  it('does not read messages or call the extractor when extraction consent is absent', async () => {
    const h = harness({ statusReads: [consentStatus({ ai_conversation_processing: 'granted' })] });
    await expect(h.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalConsentRequired);
    expect(h.consentRepository.getStatus).toHaveBeenCalledTimes(1);
    expect(h.messageRepository.findByIdsForOwner).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });

  it.each(['declined', 'withdrawn', 'renewal_required'] as const)('fails closed for extraction consent state %s', async state => {
    const h = harness({ statusReads: [consentStatus({ structured_signal_extraction: state })] });
    await expect(h.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalConsentRequired);
    expect(h.messageRepository.findByIdsForOwner).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });

  it('requires ai_conversation_processing consent as a separate purpose', async () => {
    const deniedProcessing = consentStatus({ structured_signal_extraction: 'granted' });
    const h = harness({ statusReads: [deniedProcessing, deniedProcessing] });
    await expect(h.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalConsentRequired);
    expect(h.consentRepository.getStatus).toHaveBeenCalledTimes(2);
    expect(h.messageRepository.findByIdsForOwner).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });

  it('propagates consent lookup failures and never treats them as a grant', async () => {
    const h = harness({ consentError: new Error('database unavailable') });
    await expect(h.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalAuthorizationUnavailable);
    expect(h.messageRepository.findByIdsForOwner).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });

  it('hides missing and non-owned conversations behind the same unavailable error', async () => {
    const missing = harness({ conversation: null });
    await expect(missing.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalConversationNotFound);
    expect(missing.consentRepository.getStatus).not.toHaveBeenCalled();
    expect(missing.extractor.extract).not.toHaveBeenCalled();

    const wrongOwner = harness({ conversation: makeConversation(otherAccountId) });
    await expect(wrongOwner.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalConversationNotFound);
    expect(wrongOwner.consentRepository.getStatus).not.toHaveBeenCalled();
  });

  it('rejects missing, foreign, incomplete, or mismatched message references before extraction', async () => {
    const missingReference = harness({ messages: [makeMessage(messageId1, at, 'Only one message')] });
    await expect(missingReference.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    expect(missingReference.extractor.extract).not.toHaveBeenCalled();

    const wrongConversation = harness({ messages: [
      makeMessage(messageId1, at, 'Different conversation', '550e8400-e29b-41d4-a716-446655440088'),
      makeMessage(messageId2, at, 'Second message'),
    ] });
    await expect(wrongConversation.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    expect(wrongConversation.extractor.extract).not.toHaveBeenCalled();
  });

  it('rejects malformed or duplicate request references without querying another account', async () => {
    const h = harness();
    await expect(h.useCase.execute(accountId, { ...request, messageIds: [messageId1, messageId1] })).rejects.toThrow();
    await expect(h.useCase.execute(accountId, { ...request, accountId: otherAccountId })).rejects.toThrow();
    await expect(h.useCase.execute(otherAccountId, request)).rejects.toBeInstanceOf(SignalConversationNotFound);
    expect(h.consentRepository.getStatus).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });

  it('rechecks both purposes immediately before extraction to notice a withdrawal during context loading', async () => {
    const order: string[] = [];
    const h = harness({
      order,
      statusReads: [
        consentStatus({ structured_signal_extraction: 'granted', ai_conversation_processing: 'granted' }),
        consentStatus({ structured_signal_extraction: 'granted', ai_conversation_processing: 'granted' }),
        consentStatus({ structured_signal_extraction: 'granted', ai_conversation_processing: 'granted' }),
        consentStatus({ structured_signal_extraction: 'granted', ai_conversation_processing: 'withdrawn' }),
      ],
    });
    await expect(h.useCase.execute(accountId, request)).rejects.toBeInstanceOf(SignalConsentRequired);
    expect(h.extractor.extract).not.toHaveBeenCalled();
    expect(order).toEqual(['owner', 'consent', 'consent', 'messages', 'consent', 'consent']);
  });

  it('returns valid insufficient-information output without persistence', async () => {
    const emptyResult: ConversationSignalExtraction = {
      schemaVersion: '1.0', observations: [],
      missingInformation: [{ field: 'manifestation', reason: 'not_assessed' }],
      clarificationQuestions: ['¿Qué te gustaría contarme?'],
    };
    const h = harness({ extraction: emptyResult });
    await expect(h.useCase.execute(accountId, request)).resolves.toEqual(emptyResult);
    expect(h.messageRepository.createForOwner).not.toHaveBeenCalled();
  });

  it('validates extractor output and propagates its safe provider failure', async () => {
    const invalid = harness({ extraction: { ...validResult, diagnosis: 'depression' } as unknown as ConversationSignalExtraction });
    await expect(invalid.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'invalid_response' });

    const failed = harness({ extractorError: new ConversationSignalExtractionError('provider_unavailable') });
    await expect(failed.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'provider_unavailable' });
  });

  it('passes caller cancellation to the extractor', async () => {
    const h = harness();
    const controller = new AbortController();
    await h.useCase.execute(accountId, request, controller.signal);
    expect(h.extractor.extract).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });
});
