import type { ConsentPurposeChecker } from '../../../consent/application/ports/consent-purpose-checker.js';
import type { ConversationProcessingConsentAuthorizer } from '../../application/ports/conversation-processing-consent.js';

/** Uses only the dedicated AI conversation processing purpose. */
export class ConsentConversationProcessingAuthorizer implements ConversationProcessingConsentAuthorizer {
  constructor(private readonly checker: ConsentPurposeChecker) {}

  isAuthorized(accountId: string): Promise<boolean> {
    return this.checker.execute(accountId, 'ai_conversation_processing');
  }
}
