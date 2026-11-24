export class ConversationProcessingConsentError extends Error {
    code;
    constructor(code) {
        super(code === 'consent_required' ? 'Current conversation processing consent is required' : 'Conversation processing consent is unavailable');
        this.code = code;
        this.name = 'ConversationProcessingConsentError';
    }
}
/** Consent gate removed by request: conversation processing is never blocked here. */
export async function requireConversationProcessingConsent(_authorizer, _accountId) {
    return;
}
