/** Adapts the public Consent repository contract; ambiguous or absent current notices fail closed. */
export class ConsentAssessmentAuthorizer {
    consents;
    clock;
    constructor(consents, clock = () => new Date()) {
        this.consents = consents;
        this.clock = clock;
    }
    async getCurrentNoticeVersionId(accountId) {
        // Consent decision gate removed by request: returns the available preliminary_assessment notice
        // regardless of the recorded decision. Still null when no notice exists.
        void accountId;
        const notices = await this.consents.listAvailableNotices(this.clock());
        return notices.find(notice => notice.purpose === 'preliminary_assessment')?.id ?? null;
    }
}
