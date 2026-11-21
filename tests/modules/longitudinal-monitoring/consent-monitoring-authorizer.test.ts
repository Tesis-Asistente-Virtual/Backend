import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConsentRepository } from '../../../src/modules/consent/domain/repositories/consent-repository.js';
import { monitoringConsentPurpose } from '../../../src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';
import { ConsentMonitoringAuthorizer } from '../../../src/modules/longitudinal-monitoring/infrastructure/persistence/consent-monitoring-authorizer.js';

const at = new Date('2026-10-01T10:00:00.000Z');
const noticeId = randomUUID();

function consentRepository(overrides: Partial<ConsentRepository> = {}): ConsentRepository {
  return {
    getStatus: vi.fn(async () => [{ purpose: monitoringConsentPurpose, state: 'granted', currentNoticeVersion: 'v1', changedAt: at }]),
    listAvailableNotices: vi.fn(async () => [{
      id: noticeId, purpose: monitoringConsentPurpose, version: 'v1', content: 'synthetic test notice',
      contentHash: 'a'.repeat(64), effectiveAt: at, status: 'published',
    }]),
    recordDecision: vi.fn(async () => null),
    ...overrides,
  };
}

describe('ConsentMonitoringAuthorizer', () => {
  it('returns only current granted authorization for longitudinal_monitoring', async () => {
    const repository = consentRepository();
    const authorization = await new ConsentMonitoringAuthorizer(repository, () => new Date(at.getTime() + 1000)).getCurrentAuthorization(randomUUID());
    expect(authorization).toMatchObject({ purpose: monitoringConsentPurpose, state: 'granted', noticeVersionId: noticeId, grantedAt: at });
    expect(repository.getStatus).toHaveBeenCalledOnce();
    expect(repository.listAvailableNotices).toHaveBeenCalledOnce();
  });

  it.each(['declined', 'withdrawn', 'renewal_required', 'not_decided'] as const)('does not authorize state %s', async (state) => {
    const repository = consentRepository({ getStatus: vi.fn(async () => [{ purpose: monitoringConsentPurpose, state, currentNoticeVersion: 'v1', changedAt: at }]) });
    await expect(new ConsentMonitoringAuthorizer(repository, () => new Date(at.getTime() + 1000)).getCurrentAuthorization(randomUUID())).resolves.toBeNull();
  });

  it('fails closed for missing, replaced, or ambiguous current notices', async () => {
    const noVersion = consentRepository({ getStatus: vi.fn(async () => [{ purpose: monitoringConsentPurpose, state: 'granted', currentNoticeVersion: null, changedAt: at }]) });
    const replaced = consentRepository({ listAvailableNotices: vi.fn(async () => [{
      id: noticeId, purpose: monitoringConsentPurpose, version: 'v2', content: 'synthetic test notice',
      contentHash: 'b'.repeat(64), effectiveAt: at, status: 'published' as const,
    }]) });
    const ambiguous = consentRepository({ listAvailableNotices: vi.fn(async () => [
      { id: noticeId, purpose: monitoringConsentPurpose, version: 'v1', content: 'a', contentHash: 'a'.repeat(64), effectiveAt: at, status: 'published' as const },
      { id: randomUUID(), purpose: monitoringConsentPurpose, version: 'v1', content: 'b', contentHash: 'b'.repeat(64), effectiveAt: at, status: 'published' as const },
    ]) });
    const authorizer = (repository: ConsentRepository) => new ConsentMonitoringAuthorizer(repository, () => new Date(at.getTime() + 1000));
    await expect(authorizer(noVersion).getCurrentAuthorization(randomUUID())).resolves.toBeNull();
    await expect(authorizer(replaced).getCurrentAuthorization(randomUUID())).resolves.toBeNull();
    await expect(authorizer(ambiguous).getCurrentAuthorization(randomUUID())).resolves.toBeNull();
  });
});
