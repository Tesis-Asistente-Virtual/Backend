import { and, asc, eq } from 'drizzle-orm';
import { MonitoringError } from '../../domain/model/monitoring-errors.js';
import { parseMonitoringSession } from '../../domain/model/monitoring-contracts.js';
import { requireCurrentMonitoringConsent } from './monitoring-consent-transaction.js';
import { monitoringEnrollments, monitoringSessions } from './schema.js';
function postgresCode(error) {
    if (typeof error !== 'object' || error === null)
        return undefined;
    const value = error;
    if (typeof value.cause === 'object' && value.cause !== null) {
        const cause = value.cause;
        if (typeof cause.code === 'string')
            return cause.code;
    }
    return typeof value.code === 'string' ? value.code : undefined;
}
export function mapMonitoringSessionRow(row) {
    return parseMonitoringSession({
        contractVersion: row.contractVersion,
        sessionId: row.id,
        enrollmentId: row.enrollmentId,
        accountId: row.accountId,
        status: row.status,
        openedAt: row.openedAt,
        updatedAt: row.updatedAt,
        closedAt: row.closedAt,
        revision: row.revision,
    });
}
export class DrizzleMonitoringSessionRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(session) {
        const valid = parseMonitoringSession(session);
        if (valid.status !== 'in_progress' || valid.revision !== 1)
            throw new Error('New monitoring session must start in progress at revision 1');
        let created;
        try {
            [created] = await this.db.transaction(async (tx) => {
                const [enrollment] = await tx.select({
                    id: monitoringEnrollments.id,
                    status: monitoringEnrollments.status,
                    enrolledAt: monitoringEnrollments.enrolledAt,
                    updatedAt: monitoringEnrollments.updatedAt,
                }).from(monitoringEnrollments).where(and(eq(monitoringEnrollments.id, valid.enrollmentId), eq(monitoringEnrollments.accountId, valid.accountId))).for('update').limit(1);
                if (!enrollment || enrollment.status !== 'active' || valid.openedAt < enrollment.enrolledAt || valid.openedAt < enrollment.updatedAt) {
                    throw new MonitoringError('enrollment_inactive');
                }
                return tx.insert(monitoringSessions).values({
                    id: valid.sessionId,
                    enrollmentId: valid.enrollmentId,
                    accountId: valid.accountId,
                    status: valid.status,
                    contractVersion: valid.contractVersion,
                    openedAt: valid.openedAt,
                    updatedAt: valid.updatedAt,
                    closedAt: valid.closedAt,
                    revision: valid.revision,
                }).returning();
            });
        }
        catch (error) {
            if (postgresCode(error) === '23505')
                throw new MonitoringError('session_already_open');
            throw error;
        }
        if (!created)
            throw new Error('Monitoring session insert returned no row');
        return mapMonitoringSessionRow(created);
    }
    async createWithCurrentConsent(session, consentNoticeVersionId) {
        const valid = parseMonitoringSession(session);
        if (valid.status !== 'in_progress' || valid.revision !== 1)
            throw new Error('New monitoring session must start in progress at revision 1');
        let created;
        try {
            [created] = await this.db.transaction(async (tx) => {
                // Consent authorization is locked before the enrollment, consistently with Consent's account-first order.
                await requireCurrentMonitoringConsent(tx, valid.accountId, consentNoticeVersionId);
                const [enrollment] = await tx.select({
                    id: monitoringEnrollments.id,
                    status: monitoringEnrollments.status,
                    enrolledAt: monitoringEnrollments.enrolledAt,
                    updatedAt: monitoringEnrollments.updatedAt,
                }).from(monitoringEnrollments).where(and(eq(monitoringEnrollments.id, valid.enrollmentId), eq(monitoringEnrollments.accountId, valid.accountId))).for('update').limit(1);
                if (!enrollment || enrollment.status !== 'active' || valid.openedAt < enrollment.enrolledAt || valid.openedAt < enrollment.updatedAt) {
                    throw new MonitoringError('enrollment_inactive');
                }
                return tx.insert(monitoringSessions).values({
                    id: valid.sessionId,
                    enrollmentId: valid.enrollmentId,
                    accountId: valid.accountId,
                    status: valid.status,
                    contractVersion: valid.contractVersion,
                    openedAt: valid.openedAt,
                    updatedAt: valid.updatedAt,
                    closedAt: valid.closedAt,
                    revision: valid.revision,
                }).returning();
            });
        }
        catch (error) {
            if (postgresCode(error) === '23505')
                throw new MonitoringError('session_already_open');
            throw error;
        }
        if (!created)
            throw new Error('Monitoring session insert returned no row');
        return mapMonitoringSessionRow(created);
    }
    async findByIdForOwner(sessionId, accountId) {
        const [row] = await this.db.select().from(monitoringSessions).where(and(eq(monitoringSessions.id, sessionId), eq(monitoringSessions.accountId, accountId))).limit(1);
        return row ? mapMonitoringSessionRow(row) : null;
    }
    async listByEnrollmentForOwner(enrollmentId, accountId, pagination) {
        const limit = Math.max(1, Math.min(100, Math.floor(pagination.limit)));
        const offset = Math.max(0, Math.min(100_000, Math.floor(pagination.offset)));
        const rows = await this.db.select().from(monitoringSessions).where(and(eq(monitoringSessions.enrollmentId, enrollmentId), eq(monitoringSessions.accountId, accountId))).orderBy(asc(monitoringSessions.openedAt), asc(monitoringSessions.id)).limit(limit).offset(offset);
        return rows.map(mapMonitoringSessionRow);
    }
    async saveStatusForOwner(session, accountId, expectedRevision) {
        const valid = parseMonitoringSession(session);
        if (valid.accountId !== accountId || valid.revision !== expectedRevision + 1 || valid.status === 'in_progress')
            return false;
        const rows = await this.db.update(monitoringSessions).set({
            status: valid.status,
            updatedAt: valid.updatedAt,
            closedAt: valid.closedAt,
            revision: valid.revision,
        }).where(and(eq(monitoringSessions.id, valid.sessionId), eq(monitoringSessions.accountId, accountId), eq(monitoringSessions.revision, expectedRevision), eq(monitoringSessions.status, 'in_progress'))).returning({ id: monitoringSessions.id });
        return rows.length === 1;
    }
}
