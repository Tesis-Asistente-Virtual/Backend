import type { MonitoringEnrollment, MonitoringSession } from '../../../domain/model/monitoring-contracts.js';

export function toMonitoringEnrollmentResource(value: MonitoringEnrollment) {
  return {
    id: value.enrollmentId,
    status: value.status,
    contractVersion: value.contractVersion,
    consentedAt: value.consentedAt.toISOString(),
    enrolledAt: value.enrolledAt.toISOString(),
    statusChangedAt: value.statusChangedAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    revision: value.revision,
  };
}

export function toMonitoringSessionResource(value: MonitoringSession) {
  return {
    id: value.sessionId,
    enrollmentId: value.enrollmentId,
    status: value.status,
    openedAt: value.openedAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    closedAt: value.closedAt?.toISOString() ?? null,
    revision: value.revision,
  };
}

export function toMonitoringPageResource<T>(items: readonly T[], toResource: (item: T) => unknown, limit: number, offset: number) {
  return { items: items.slice(0, limit).map(toResource), pagination: { limit, offset, hasMore: items.length > limit } };
}
