export class ConversationProcessingConsentError extends Error {
    code;
    constructor(code) {
        super(code === 'consent_required' ? 'Current conversation processing consent is required' : 'Conversation processing consent is unavailable');
        this.code = code;
        this.name = 'ConversationProcessingConsentError';
    }
}
export async function requireConversationProcessingConsent(authorizer, accountId) {
    let authorized;
    try {
        authorized = await authorizer.isAuthorized(accountId);
    }
    catch {
        throw new ConversationProcessingConsentError('consent_unavailable');
    }
    if (!authorized)
        throw new ConversationProcessingConsentError('consent_required');
}
