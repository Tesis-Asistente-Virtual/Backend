export class ListMyAssessments {
    assessments;
    constructor(assessments) {
        this.assessments = assessments;
    }
    execute(accountId, limit, offset) {
        return this.assessments.listByOwner(accountId, limit, offset);
    }
}
