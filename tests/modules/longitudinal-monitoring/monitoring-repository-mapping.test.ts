import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapMonitoringEnrollmentRow } from '../../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-enrollment-repository.js';
import { mapMonitoringSessionRow } from '../../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-session-repository.js';
import { monitoringEnrollments, monitoringSessions } from '../../../src/modules/longitudinal-monitoring/infrastructure/persistence/schema.js';

const at = new Date('2026-01-01T00:00:00.000Z');

describe('LongitudinalMonitoring persistence mapping', () => {
  it('maps an enrollment row into its versioned domain contract', () => {
    const row = {
      id: randomUUID(), accountId: randomUUID(), status: 'active', consentPurpose: 'longitudinal_monitoring',
      consentNoticeVersionId: randomUUID(), contractVersion: '1.0', consentedAt: at, enrolledAt: at,
      statusChangedAt: at, createdAt: at, updatedAt: at, revision: 1,
    } satisfies typeof monitoringEnrollments.$inferSelect;

    expect(mapMonitoringEnrollmentRow(row)).toMatchObject({
      enrollmentId: row.id, accountId: row.accountId, status: 'active', revision: 1,
      consentPurpose: 'longitudinal_monitoring', consentNoticeVersionId: row.consentNoticeVersionId,
    });
  });

  it('rejects persisted invalid statuses and maps owner-bound sessions', () => {
    const sessionRow = {
      id: randomUUID(), enrollmentId: randomUUID(), accountId: randomUUID(), status: 'in_progress',
      contractVersion: '1.0', openedAt: at, updatedAt: at, closedAt: null, revision: 1,
    } satisfies typeof monitoringSessions.$inferSelect;
    expect(mapMonitoringSessionRow(sessionRow)).toMatchObject({ sessionId: sessionRow.id, enrollmentId: sessionRow.enrollmentId, accountId: sessionRow.accountId, revision: 1 });
    expect(() => mapMonitoringSessionRow({ ...sessionRow, status: 'unknown' } as typeof monitoringSessions.$inferSelect)).toThrow();
    expect(() => mapMonitoringEnrollmentRow({
      id: randomUUID(), accountId: randomUUID(), status: 'unknown', consentPurpose: 'longitudinal_monitoring',
      consentNoticeVersionId: randomUUID(), contractVersion: '1.0', consentedAt: at, enrolledAt: at,
      statusChangedAt: at, createdAt: at, updatedAt: at, revision: 1,
    } as typeof monitoringEnrollments.$inferSelect)).toThrow();
  });
});
