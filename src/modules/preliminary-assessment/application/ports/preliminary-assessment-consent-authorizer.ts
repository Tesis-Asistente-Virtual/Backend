/** Application boundary for the existing Consent BC; callers must fail closed before assessment work. */
export interface PreliminaryAssessmentConsentAuthorizer {
  getCurrentNoticeVersionId(accountId: string): Promise<string | null>;
}
