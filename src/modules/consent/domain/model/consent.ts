export const consentPurposes = [
  'ai_conversation_processing',
  'structured_signal_extraction',
  'conversational_signal_analysis',
  'wellbeing_recommendations',
  'longitudinal_monitoring',
  'preliminary_assessment',
] as const;
export type ConsentPurpose = (typeof consentPurposes)[number];
export const consentActions = ['granted', 'declined', 'withdrawn'] as const;
export type ConsentAction = (typeof consentActions)[number];
export type ConsentNoticeStatus = 'draft' | 'published' | 'superseded';

export interface ConsentNoticeVersion {
  readonly id: string;
  readonly purpose: ConsentPurpose;
  readonly version: string;
  readonly content: string;
  readonly contentHash: string;
  readonly effectiveAt: Date;
  readonly status: ConsentNoticeStatus;
}
export interface AccountConsentEvent {
  readonly id: string;
  readonly sequence: number;
  readonly accountId: string;
  readonly purpose: ConsentPurpose;
  readonly noticeVersionId: string;
  readonly action: ConsentAction;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
}
export interface ConsentStatus {
  readonly purpose: ConsentPurpose;
  readonly state: 'granted' | 'declined' | 'withdrawn' | 'not_decided' | 'renewal_required';
  readonly currentNoticeVersion: string | null;
  readonly changedAt: Date | null;
}
