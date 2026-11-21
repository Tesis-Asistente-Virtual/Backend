import type { MonitoringEnrollmentRepository } from '../../../domain/repositories/monitoring-enrollment-repository.js';

export class ListMyMonitoringEnrollments {
  constructor(private readonly enrollments: MonitoringEnrollmentRepository) {}
  execute(accountId: string, limit: number, offset: number) {
    return this.enrollments.listByOwner(accountId, { limit, offset });
  }
}
