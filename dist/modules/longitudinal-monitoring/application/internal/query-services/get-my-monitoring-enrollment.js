import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
export class GetMyMonitoringEnrollment {
    enrollments;
    constructor(enrollments) {
        this.enrollments = enrollments;
    }
    async execute(enrollmentId, accountId) {
        const enrollment = await this.enrollments.findByIdForOwner(enrollmentId, accountId);
        if (!enrollment)
            throw new MonitoringError('enrollment_not_found');
        return enrollment;
    }
}
