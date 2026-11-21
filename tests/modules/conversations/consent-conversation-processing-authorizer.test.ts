import { describe, expect, it, vi } from 'vitest';
import { CheckConsentForPurpose } from '../../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import type { ConsentPurpose, ConsentStatus } from '../../../src/modules/consent/domain/model/consent.js';
import type { ConsentRepository } from '../../../src/modules/consent/domain/repositories/consent-repository.js';
import { ConsentConversationProcessingAuthorizer } from '../../../src/modules/conversations/infrastructure/persistence/consent-conversation-processing-authorizer.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const purposes: ConsentPurpose[] = [
  'ai_conversation_processing', 'structured_signal_extraction', 'preliminary_assessment', 'longitudinal_monitoring',
];

function repository(state: ConsentStatus['state'], failure?: Error): ConsentRepository {
  return {
    listAvailableNotices: vi.fn(async () => []),
    getStatus: vi.fn(async () => {
      if (failure) throw failure;
      return purposes.map(purpose => ({ purpose, state: purpose === 'ai_conversation_processing' ? state : 'granted', currentNoticeVersion: 'v1', changedAt: new Date() }));
    }),
    recordDecision: vi.fn(async () => null),
  };
}

describe('ConsentConversationProcessingAuthorizer', () => {
  it('checks only ai_conversation_processing and allows a current explicit grant', async () => {
    const consents = repository('granted');
    const authorizer = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(consents));
    await expect(authorizer.isAuthorized(accountId)).resolves.toBe(true);
    expect(consents.getStatus).toHaveBeenCalledWith(accountId, expect.any(Date));
  });

  it.each(['not_decided', 'declined', 'withdrawn', 'renewal_required'] as const)(
    'denies purpose state %s even when other purposes are granted', async state => {
      const authorizer = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(repository(state)));
      await expect(authorizer.isAuthorized(accountId)).resolves.toBe(false);
    },
  );

  it('propagates checker failures so the application maps them to unavailable, never granted', async () => {
    const authorizer = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(repository('granted', new Error('private DB detail'))));
    await expect(authorizer.isAuthorized(accountId)).rejects.toThrow('private DB detail');
  });
});
