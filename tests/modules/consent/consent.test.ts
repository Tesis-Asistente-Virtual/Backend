import { describe, expect, it, vi } from 'vitest';
import { consentPurposes, type ConsentAction, type ConsentStatus } from '../../../src/modules/consent/domain/model/consent.js';
import type { ConsentRepository } from '../../../src/modules/consent/domain/repositories/consent-repository.js';
import { CheckConsentForPurpose } from '../../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import { GetMyConsentStatus } from '../../../src/modules/consent/application/internal/query-services/get-my-consent-status.js';
import { RecordMyConsentDecision, ConsentNoticeUnavailable } from '../../../src/modules/consent/application/internal/command-services/record-my-consent-decision.js';
import { consentDecisionSchema } from '../../../src/modules/consent/interfaces/rest/validation/consent-schemas.js';

const accountId = '2d1f07b8-2194-4cf8-99cf-3274c3ea62f5';
function repository(status: ConsentStatus[]): ConsentRepository {
  return {
    listAvailableNotices: vi.fn(async () => []),
    getStatus: vi.fn(async () => status),
    recordDecision: vi.fn(async () => null),
  };
}

describe('Consent & Privacy', () => {
  it('keeps the independent purposes supported by the notice and decision contracts', () => {
    expect(consentPurposes).toEqual([
      'ai_conversation_processing',
      'structured_signal_extraction',
      'conversational_signal_analysis',
      'wellbeing_recommendations',
      'longitudinal_monitoring',
      'preliminary_assessment',
    ]);
    const base = { noticeVersionId: '5226778f-3001-4f4a-8f80-2a8a3d409a78', action: 'granted', idempotencyKey: 'fc2e1de5-7916-4f47-bc87-80759bc22e2a' };
    for (const purpose of consentPurposes) {
      expect(consentDecisionSchema.parse({ ...base, purpose }).purpose).toBe(purpose);
    }
  });

  it('denies when no explicit current grant exists and isolates by purpose', async () => {
    const repo = repository([
      { purpose: 'ai_conversation_processing', state: 'not_decided', currentNoticeVersion: null, changedAt: null },
      { purpose: 'structured_signal_extraction', state: 'granted', currentNoticeVersion: '1.0', changedAt: new Date() },
    ]);
    const check = new CheckConsentForPurpose(repo, () => new Date('2026-01-01T00:00:00Z'));
    await expect(check.execute(accountId, 'ai_conversation_processing')).resolves.toBe(false);
    await expect(check.execute(accountId, 'structured_signal_extraction')).resolves.toBe(true);
    expect(repo.getStatus).toHaveBeenCalledWith(accountId, new Date('2026-01-01T00:00:00Z'));
  });

  it('treats a grant for a superseded version as renewal required', async () => {
    const repo = repository([{ purpose: 'preliminary_assessment', state: 'renewal_required', currentNoticeVersion: '2.0', changedAt: new Date() }]);
    await expect(new CheckConsentForPurpose(repo).execute(accountId, 'preliminary_assessment')).resolves.toBe(false);
    await expect(new GetMyConsentStatus(repo).execute(accountId)).resolves.toMatchObject([{ state: 'renewal_required' }]);
  });

  it.each(['not_decided', 'declined', 'withdrawn', 'renewal_required'] as const)('fails closed for %s status', async state => {
    const repo = repository([{ purpose: 'longitudinal_monitoring', state, currentNoticeVersion: '1.0', changedAt: new Date() }]);
    await expect(new CheckConsentForPurpose(repo).execute(accountId, 'longitudinal_monitoring')).resolves.toBe(false);
    expect(repo.getStatus).toHaveBeenCalledWith(accountId, expect.any(Date));
  });

  it('validates explicit action, purpose, notice and idempotency key strictly', () => {
    const base = { purpose: 'ai_conversation_processing', noticeVersionId: '5226778f-3001-4f4a-8f80-2a8a3d409a78', action: 'granted', idempotencyKey: 'fc2e1de5-7916-4f47-bc87-80759bc22e2a' };
    expect(consentDecisionSchema.parse(base)).toEqual(base);
    expect(consentDecisionSchema.safeParse({ ...base, accountId }).success).toBe(false);
    expect(consentDecisionSchema.safeParse({ ...base, action: 'implicit' }).success).toBe(false);
    expect(consentDecisionSchema.safeParse({ ...base, purpose: 'research' }).success).toBe(false);
  });

  it('does not record a decision against a missing or unpublished notice', async () => {
    const repo = repository([]);
    await expect(new RecordMyConsentDecision(repo).execute(accountId, {
      purpose: 'ai_conversation_processing', noticeVersionId: '5226778f-3001-4f4a-8f80-2a8a3d409a78', action: 'granted', idempotencyKey: 'fc2e1de5-7916-4f47-bc87-80759bc22e2a',
    })).rejects.toBeInstanceOf(ConsentNoticeUnavailable);
    expect(repo.recordDecision).toHaveBeenCalledOnce();
  });

  it.each(['granted', 'declined', 'withdrawn'] as const)('records explicit %s decisions with the supplied version and retry key', async (action: ConsentAction) => {
    const now = new Date('2026-01-01T00:00:00Z');
    const persisted = { id: '05d03703-d8ed-4b03-8f58-0db35851ad18', sequence: 1, accountId, purpose: 'ai_conversation_processing' as const, noticeVersionId: '5226778f-3001-4f4a-8f80-2a8a3d409a78', action, idempotencyKey: 'fc2e1de5-7916-4f47-bc87-80759bc22e2a', createdAt: now };
    const repo = repository([]);
    vi.mocked(repo.recordDecision).mockResolvedValue(persisted);
    const input = { purpose: persisted.purpose, noticeVersionId: persisted.noticeVersionId, action, idempotencyKey: persisted.idempotencyKey };
    await expect(new RecordMyConsentDecision(repo, () => now).execute(accountId, input)).resolves.toEqual(persisted);
    expect(repo.recordDecision).toHaveBeenCalledWith(accountId, input.purpose, input.noticeVersionId, action, input.idempotencyKey, now);
  });
});
