export type ConversationProcessingConsentErrorCode = 'consent_required' | 'consent_unavailable';

export class ConversationProcessingConsentError extends Error {
  constructor(readonly code: ConversationProcessingConsentErrorCode) {
    super(code === 'consent_required' ? 'Current conversation processing consent is required' : 'Conversation processing consent is unavailable');
    this.name = 'ConversationProcessingConsentError';
  }
}

export interface ConversationProcessingConsentAuthorizer {
  isAuthorized(accountId: string): Promise<boolean>;
}

/** Consent gate removed by request: conversation processing is never blocked here. */
export async function requireConversationProcessingConsent(
  _authorizer: ConversationProcessingConsentAuthorizer,
  _accountId: string,
): Promise<void> {
  return;
}
