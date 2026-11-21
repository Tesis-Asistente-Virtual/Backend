import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import type { MonitoringEnrollmentRepository } from '../../../domain/repositories/monitoring-enrollment-repository.js';

export class GetMyMonitoringEnrollment {
  constructor(private readonly enrollments: MonitoringEnrollmentRepository) {}
  async execute(enrollmentId: string, accountId: string) {
    const enrollment = await this.enrollments.findByIdForOwner(enrollmentId, accountId);
    if (!enrollment) throw new MonitoringError('enrollment_not_found');
    return enrollment;
  }
}
