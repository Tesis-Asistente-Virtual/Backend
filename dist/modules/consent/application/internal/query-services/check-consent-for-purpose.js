export class CheckConsentForPurpose {
    repository;
    clock;
    constructor(repository, clock = () => new Date()) {
        this.repository = repository;
        this.clock = clock;
    }
    async execute(accountId, purpose) {
        const status = await this.repository.getStatus(accountId, this.clock());
        return status.some(item => item.purpose === purpose && item.state === 'granted');
    }
}
