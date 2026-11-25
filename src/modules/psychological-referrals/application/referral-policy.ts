export const psychologicalReferralConsentPurpose = 'psychological_referral_sharing' as const;

export interface PsychologicalReferralPolicy {
  readonly selectedTestRecipient: string | undefined;
}
