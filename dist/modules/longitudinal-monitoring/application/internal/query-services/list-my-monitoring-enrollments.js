export class ListMyMonitoringEnrollments {
    enrollments;
    constructor(enrollments) {
        this.enrollments = enrollments;
    }
    execute(accountId, limit, offset) {
        return this.enrollments.listByOwner(accountId, { limit, offset });
    }
}
