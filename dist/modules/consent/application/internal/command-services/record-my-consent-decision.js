export class ConsentNoticeUnavailable extends Error {
    constructor() { super('Consent notice is unavailable'); this.name = 'ConsentNoticeUnavailable'; }
}
export class RecordMyConsentDecision {
    repository;
    clock;
    constructor(repository, clock = () => new Date()) {
        this.repository = repository;
        this.clock = clock;
    }
    async execute(accountId, input) {
        const event = await this.repository.recordDecision(accountId, input.purpose, input.noticeVersionId, input.action, input.idempotencyKey, this.clock());
        if (!event)
            throw new ConsentNoticeUnavailable();
        return event;
    }
}
