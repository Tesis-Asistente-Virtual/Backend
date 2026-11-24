export const recommendationConsentPurposes = [
    'ai_conversation_processing',
    'structured_signal_extraction',
    'conversational_signal_analysis',
    'wellbeing_recommendations',
];
/** Requires a grant for the exact currently published notice for every processing purpose. */
export function resolveCurrentRecommendationConsentNotice(statuses) {
    for (const purpose of recommendationConsentPurposes) {
        const status = statuses.find(item => item.purpose === purpose);
        if (!status?.currentNoticeId || status.latestAction !== 'granted' || status.latestNoticeId !== status.currentNoticeId)
            return null;
    }
    return statuses.find(item => item.purpose === 'wellbeing_recommendations')?.currentNoticeId ?? null;
}
