import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
export class ListMyMonitoringSessions {
    enrollments;
    sessions;
    constructor(enrollments, sessions) {
        this.enrollments = enrollments;
        this.sessions = sessions;
    }
    async execute(enrollmentId, accountId, limit, offset) {
        if (!await this.enrollments.findByIdForOwner(enrollmentId, accountId))
            throw new MonitoringError('enrollment_not_found');
        return this.sessions.listByEnrollmentForOwner(enrollmentId, accountId, { limit, offset });
    }
}
