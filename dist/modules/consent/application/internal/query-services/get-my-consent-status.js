export class GetMyConsentStatus {
    repository;
    clock;
    constructor(repository, clock = () => new Date()) {
        this.repository = repository;
        this.clock = clock;
    }
    execute(accountId) { return this.repository.getStatus(accountId, this.clock()); }
}
