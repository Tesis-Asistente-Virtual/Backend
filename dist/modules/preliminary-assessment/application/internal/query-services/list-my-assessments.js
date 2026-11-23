export class ListMyAssessments {
    assessments;
    consent;
    constructor(assessments, consent) {
        this.assessments = assessments;
        this.consent = consent;
    }
    async execute(accountId, limit, offset) {
        const assessments = await this.assessments.listByOwner(accountId, limit, offset);
        return Promise.all(assessments.map(async (assessment) => {
            if (assessment.status !== 'in_progress' && assessment.status !== 'paused')
                return assessment;
            if (!this.consent)
                return { ...assessment, responses: [] };
            try {
                const currentNoticeId = await this.consent.getCurrentNoticeVersionId(accountId);
                return currentNoticeId === assessment.consentNoticeVersionId ? assessment : { ...assessment, responses: [] };
            }
            catch {
                // Metadata remains useful for recovery, but response payloads stay hidden on authorization failure.
                return { ...assessment, responses: [] };
            }
        }));
    }
}
