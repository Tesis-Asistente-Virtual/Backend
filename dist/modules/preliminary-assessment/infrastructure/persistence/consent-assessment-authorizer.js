/** Adapts the public Consent repository contract; ambiguous or absent current notices fail closed. */
export class ConsentAssessmentAuthorizer {
    consents;
    clock;
    constructor(consents, clock = () => new Date()) {
        this.consents = consents;
        this.clock = clock;
    }
    async getCurrentNoticeVersionId(accountId) {
        const now = this.clock();
        const [status, notices] = await Promise.all([
            this.consents.getStatus(accountId, now),
            this.consents.listAvailableNotices(now),
        ]);
        const currentStatus = status.find(item => item.purpose === 'preliminary_assessment');
        if (currentStatus?.state !== 'granted' || !currentStatus.currentNoticeVersion)
            return null;
        const matching = notices.filter(notice => notice.purpose === 'preliminary_assessment' && notice.version === currentStatus.currentNoticeVersion);
        return matching.length === 1 ? matching[0]?.id ?? null : null;
    }
}
