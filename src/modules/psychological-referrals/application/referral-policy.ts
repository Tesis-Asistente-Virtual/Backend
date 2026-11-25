export const psychologicalReferralConsentPurpose = 'psychological_referral_sharing' as const;

export interface PsychologicalReferralPolicy {
  readonly enabled: boolean;
  readonly deployment: string | undefined;
  readonly allowedAccountIds: readonly string[];
  readonly selectedTestRecipient: string | undefined;
  readonly allowedTestRecipients: readonly string[];
  readonly smtpConfigured: boolean;
}

export function isPsychologicalReferralAllowed(policy: PsychologicalReferralPolicy, accountId: string): boolean {
  return policy.enabled && policy.deployment === 'synthetic_test' &&
    policy.allowedAccountIds.includes(accountId.toLowerCase()) &&
    Boolean(policy.selectedTestRecipient) && policy.allowedTestRecipients.includes(policy.selectedTestRecipient ?? '') &&
    policy.smtpConfigured;
}

export function isSafeReferralTestDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase()) &&
      parsed.pathname.replace(/^\//u, '') === 'tesis_test_db';
  } catch {
    return false;
  }
}
