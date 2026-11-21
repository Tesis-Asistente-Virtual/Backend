import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { MonitoringError } from '../../domain/model/monitoring-errors.js';
import { parseMonitoringEnrollment, type MonitoringEnrollment } from '../../domain/model/monitoring-contracts.js';
import type { MonitoringEnrollmentRepository } from '../../domain/repositories/monitoring-enrollment-repository.js';
import { requireCurrentMonitoringConsent } from './monitoring-consent-transaction.js';
import { monitoringEnrollments } from './schema.js';

type EnrollmentRow = typeof monitoringEnrollments.$inferSelect;

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.cause === 'object' && value.cause !== null) {
    const cause = value.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return typeof value.code === 'string' ? value.code : undefined;
}

export function mapMonitoringEnrollmentRow(row: EnrollmentRow): MonitoringEnrollment {
  return parseMonitoringEnrollment({
    contractVersion: row.contractVersion,
    enrollmentId: row.id,
    accountId: row.accountId,
    status: row.status,
    consentPurpose: row.consentPurpose,
    consentNoticeVersionId: row.consentNoticeVersionId,
    consentedAt: row.consentedAt,
    enrolledAt: row.enrolledAt,
    statusChangedAt: row.statusChangedAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  });
}

export class DrizzleMonitoringEnrollmentRepository implements MonitoringEnrollmentRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(enrollment: MonitoringEnrollment): Promise<MonitoringEnrollment> {
    const valid = parseMonitoringEnrollment(enrollment);
    if (valid.status !== 'active' || valid.revision !== 1) throw new Error('New monitoring enrollment must start active at revision 1');
    let row: EnrollmentRow | undefined;
    try {
      [row] = await this.db.insert(monitoringEnrollments).values({
        id: valid.enrollmentId,
        accountId: valid.accountId,
        status: valid.status,
        consentPurpose: valid.consentPurpose,
        consentNoticeVersionId: valid.consentNoticeVersionId,
        contractVersion: valid.contractVersion,
        consentedAt: valid.consentedAt,
        enrolledAt: valid.enrolledAt,
        statusChangedAt: valid.statusChangedAt,
        updatedAt: valid.updatedAt,
        revision: valid.revision,
      }).returning();
    } catch (error) {
      if (postgresCode(error) === '23505') throw new MonitoringError('enrollment_already_open');
      throw error;
    }
    if (!row) throw new Error('Monitoring enrollment insert returned no row');
    return mapMonitoringEnrollmentRow(row);
  }

  async createWithCurrentConsent(enrollment: MonitoringEnrollment): Promise<MonitoringEnrollment> {
    const valid = parseMonitoringEnrollment(enrollment);
    if (valid.status !== 'active' || valid.revision !== 1) throw new Error('New monitoring enrollment must start active at revision 1');
    let row: EnrollmentRow | undefined;
    try {
      [row] = await this.db.transaction(async (tx) => {
        const consentedAt = await requireCurrentMonitoringConsent(tx, valid.accountId, valid.consentNoticeVersionId);
        const enrolledAt = new Date(Math.max(valid.enrolledAt.getTime(), consentedAt.getTime()));
        return tx.insert(monitoringEnrollments).values({
          id: valid.enrollmentId,
          accountId: valid.accountId,
          status: valid.status,
          consentPurpose: valid.consentPurpose,
          consentNoticeVersionId: valid.consentNoticeVersionId,
          contractVersion: valid.contractVersion,
          consentedAt,
          enrolledAt,
          statusChangedAt: enrolledAt,
          updatedAt: enrolledAt,
          revision: valid.revision,
        }).returning();
      });
    } catch (error) {
      if (postgresCode(error) === '23505') throw new MonitoringError('enrollment_already_open');
      throw error;
    }
    if (!row) throw new Error('Monitoring enrollment insert returned no row');
    return mapMonitoringEnrollmentRow(row);
  }

  async findByIdForOwner(enrollmentId: string, accountId: string): Promise<MonitoringEnrollment | null> {
    const [row] = await this.db.select().from(monitoringEnrollments).where(and(
      eq(monitoringEnrollments.id, enrollmentId), eq(monitoringEnrollments.accountId, accountId),
    )).limit(1);
    return row ? mapMonitoringEnrollmentRow(row) : null;
  }

  async listByOwner(accountId: string, pagination: { limit: number; offset: number }): Promise<readonly MonitoringEnrollment[]> {
    const limit = Math.max(1, Math.min(100, Math.floor(pagination.limit)));
    const offset = Math.max(0, Math.min(100_000, Math.floor(pagination.offset)));
    const rows = await this.db.select().from(monitoringEnrollments)
      .where(eq(monitoringEnrollments.accountId, accountId))
      .orderBy(desc(monitoringEnrollments.enrolledAt), desc(monitoringEnrollments.id))
      .limit(limit).offset(offset);
    return rows.map(mapMonitoringEnrollmentRow);
  }

  async saveStatusForOwner(enrollment: MonitoringEnrollment, accountId: string, expectedRevision: number): Promise<boolean> {
    const valid = parseMonitoringEnrollment(enrollment);
    if (valid.accountId !== accountId || valid.revision !== expectedRevision + 1) return false;
    const allowedPreviousStatuses = valid.status === 'active' ? ['paused'] : ['active', 'paused'];
    const rows = await this.db.update(monitoringEnrollments).set({
      status: valid.status,
      statusChangedAt: valid.statusChangedAt,
      updatedAt: valid.updatedAt,
      revision: valid.revision,
    }).where(and(
      eq(monitoringEnrollments.id, valid.enrollmentId),
      eq(monitoringEnrollments.accountId, accountId),
      eq(monitoringEnrollments.revision, expectedRevision),
      inArray(monitoringEnrollments.status, allowedPreviousStatuses),
    )).returning({ id: monitoringEnrollments.id });
    return rows.length === 1;
  }

  async saveStatusForOwnerWithCurrentConsent(enrollment: MonitoringEnrollment, accountId: string, expectedRevision: number, consentNoticeVersionId: string): Promise<boolean> {
    const valid = parseMonitoringEnrollment(enrollment);
    if (valid.accountId !== accountId || valid.revision !== expectedRevision + 1 || valid.consentNoticeVersionId !== consentNoticeVersionId) return false;
    const allowedPreviousStatuses = valid.status === 'active' ? ['paused'] : ['active', 'paused'];
    return this.db.transaction(async (tx) => {
      // Keep lock order account -> notice -> enrollment, matching Consent decisions.
      await requireCurrentMonitoringConsent(tx, accountId, consentNoticeVersionId);
      const rows = await tx.update(monitoringEnrollments).set({
        status: valid.status,
        statusChangedAt: valid.statusChangedAt,
        updatedAt: valid.updatedAt,
        revision: valid.revision,
      }).where(and(
        eq(monitoringEnrollments.id, valid.enrollmentId),
        eq(monitoringEnrollments.accountId, accountId),
        eq(monitoringEnrollments.revision, expectedRevision),
        inArray(monitoringEnrollments.status, allowedPreviousStatuses),
      )).returning({ id: monitoringEnrollments.id });
      return rows.length === 1;
    });
  }
}
