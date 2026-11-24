const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const conversationalSignalAnalysisPilotRetentionDays = 90;
/** Resolves a server-controlled pilot policy. Partial activation settings fail closed. */
export function resolveConversationalSignalAnalysisPilotPolicy(settings) {
    if (!settings.enabled)
        return Object.freeze({ enabled: false, retentionDays: null, allowedAccountIds: Object.freeze([]) });
    if (settings.deployment !== 'authorized_pilot') {
        throw new Error('Conversational signal pilot requires the authorized_pilot deployment environment');
    }
    if (settings.retentionDays !== conversationalSignalAnalysisPilotRetentionDays) {
        throw new Error('Conversational signal pilot retention must match the proposed 90-day period');
    }
    const authorizationReference = settings.authorizationReference?.trim();
    if (!authorizationReference || authorizationReference.length > 200) {
        throw new Error('Conversational signal pilot requires a documented authorization reference');
    }
    const rawIds = settings.allowedAccountIds?.split(',').map(id => id.trim().toLowerCase()).filter(Boolean) ?? [];
    if (rawIds.length === 0 || rawIds.some(id => !uuidPattern.test(id)) || new Set(rawIds).size !== rawIds.length) {
        throw new Error('Conversational signal pilot requires a non-empty unique UUID account allowlist');
    }
    return Object.freeze({ enabled: true, retentionDays: settings.retentionDays, allowedAccountIds: Object.freeze(rawIds) });
}
export function parseOptionalFeatureFlag(name, value) {
    if (value === undefined || value === 'false')
        return false;
    if (value === 'true')
        return true;
    throw new Error(`${name} must be exactly true or false`);
}
export function parseOptionalPositiveInteger(name, value) {
    if (value === undefined || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error(`${name} must be a positive integer`);
    return parsed;
}
