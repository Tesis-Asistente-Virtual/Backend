export class ListAvailableConsentNotices {
    repository;
    clock;
    constructor(repository, clock = () => new Date()) {
        this.repository = repository;
        this.clock = clock;
    }
    execute() { return this.repository.listAvailableNotices(this.clock()); }
}
