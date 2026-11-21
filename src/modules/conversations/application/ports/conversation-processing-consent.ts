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

export async function requireConversationProcessingConsent(
  authorizer: ConversationProcessingConsentAuthorizer,
  accountId: string,
): Promise<void> {
  let authorized: boolean;
  try {
    authorized = await authorizer.isAuthorized(accountId);
  } catch {
    throw new ConversationProcessingConsentError('consent_unavailable');
  }
  if (!authorized) throw new ConversationProcessingConsentError('consent_required');
}
