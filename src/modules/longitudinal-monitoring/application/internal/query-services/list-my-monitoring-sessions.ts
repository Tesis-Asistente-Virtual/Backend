import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import type { MonitoringEnrollmentRepository } from '../../../domain/repositories/monitoring-enrollment-repository.js';
import type { MonitoringSessionRepository } from '../../../domain/repositories/monitoring-session-repository.js';

export class ListMyMonitoringSessions {
  constructor(private readonly enrollments: MonitoringEnrollmentRepository, private readonly sessions: MonitoringSessionRepository) {}
  async execute(enrollmentId: string, accountId: string, limit: number, offset: number) {
    if (!await this.enrollments.findByIdForOwner(enrollmentId, accountId)) throw new MonitoringError('enrollment_not_found');
    return this.sessions.listByEnrollmentForOwner(enrollmentId, accountId, { limit, offset });
  }
}
