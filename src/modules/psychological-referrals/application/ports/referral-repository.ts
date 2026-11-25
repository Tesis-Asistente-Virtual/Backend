import type { ConversationalSignalAnalysis } from '../../../conversational-processing/domain/model/conversational-signal-analysis.js';
import type { PsychologicalReferralReport } from '../../domain/model/psychological-referral.js';

export type ReferralRecord = {
  readonly referralId: string;
  readonly accountId: string;
  readonly recipient: string;
  readonly previewHash: string | null;
  readonly report: PsychologicalReferralReport | null;
  readonly status: 'draft' | 'sending' | 'sent' | 'failed' | 'delivery_unknown' | 'cancelled';
  readonly createdAt: Date;
  readonly sentAt: Date | null;
  readonly deliveryReference: string | null;
  readonly sendIdempotencyKey: string | null;
};

export type DraftResult = { readonly created: boolean; readonly record: ReferralRecord };
export type ReserveReferralSendResult = { readonly kind: 'reserved'; readonly record: ReferralRecord; readonly attemptId: string } | { readonly kind: 'already_sent'; readonly record: ReferralRecord };

export interface PsychologicalReferralRepository {
  createDraft(input: { accountId: string; idempotencyKey: string; recipient: string; reason: string | null; sourceAnalysisId?: string; referralId: string; previewHash: (source: ConversationalSignalAnalysis | null) => string; report: (source: ConversationalSignalAnalysis | null) => PsychologicalReferralReport; now: Date }): Promise<DraftResult>;
  getForOwner(input: { accountId: string; referralId: string; now: Date }): Promise<ReferralRecord | null>;
  reserveSend(input: { accountId: string; referralId: string; idempotencyKey: string; previewHash: string; recipient: string; attemptId: string; now: Date }): Promise<ReserveReferralSendResult | null>;
  markSent(input: { accountId: string; referralId: string; attemptId: string; messageId: string; now: Date }): Promise<void>;
  markDeliveryFailed(input: { accountId: string; referralId: string; attemptId: string; outcome: 'failed' | 'delivery_unknown' }): Promise<void>;
  cancelDraft(input: { accountId: string; referralId: string; now: Date }): Promise<boolean>;
}
