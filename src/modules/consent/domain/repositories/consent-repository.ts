import type { AccountConsentEvent, ConsentNoticeVersion, ConsentPurpose, ConsentStatus } from '../model/consent.js';
export interface ConsentRepository {
  listAvailableNotices(now: Date): Promise<ConsentNoticeVersion[]>;
  getStatus(accountId: string, now: Date): Promise<ConsentStatus[]>;
  recordDecision(accountId: string, purpose: ConsentPurpose, noticeVersionId: string, action: 'granted' | 'declined' | 'withdrawn', idempotencyKey: string, now: Date): Promise<AccountConsentEvent | null>;
}
