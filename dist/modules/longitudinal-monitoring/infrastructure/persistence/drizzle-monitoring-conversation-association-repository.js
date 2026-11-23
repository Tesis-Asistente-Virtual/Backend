import { and, eq } from 'drizzle-orm';
import { conversations } from '../../../conversations/infrastructure/persistence/schema.js';
import { MonitoringError } from '../../domain/model/monitoring-errors.js';
import { monitoringConversationAssociationContractVersion, parseMonitoringConversationAssociation, } from '../../domain/model/monitoring-conversation-association.js';
import { requireCurrentMonitoringConsent } from './monitoring-consent-transaction.js';
import { monitoringEnrollments, monitoringSessionConversations, monitoringSessions } from './schema.js';
function postgresCode(error) {
    if (typeof error !== 'object' || error === null)
        return undefined;
    const candidate = error;
    if (typeof candidate.cause === 'object' && candidate.cause !== null) {
        const cause = candidate.cause;
        if (typeof cause.code === 'string')
            return cause.code;
    }
    return typeof candidate.code === 'string' ? candidate.code : undefined;
}
function mapRow(row) {
    return parseMonitoringConversationAssociation({
        contractVersion: monitoringConversationAssociationContractVersion,
        associationId: row.id,
        enrollmentId: row.enrollmentId,
        monitoringSessionId: row.monitoringSessionId,
        conversationId: row.conversationId,
        accountId: row.accountId,
        createdAt: row.createdAt,
    });
}
export class DrizzleMonitoringConversationAssociationRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async createWithCurrentConsent(input) {
        let inserted;
        try {
            [inserted] = await this.db.transaction(async (tx) => this.insertAuthorized(tx, input));
        }
        catch (error) {
            if (error instanceof MonitoringError)
                throw error;
            if (postgresCode(error) === '23505')
                throw new MonitoringError('conversation_already_associated');
            throw error;
        }
        if (!inserted)
            throw new Error('Monitoring conversation association insert returned no row');
        return mapRow(inserted);
    }
    async insertAuthorized(tx, input) {
        // Same global order as Consent: account -> notice -> enrollment -> session -> conversation.
        await requireCurrentMonitoringConsent(tx, input.accountId, input.consentNoticeVersionId);
        const [enrollment] = await tx.select({
            id: monitoringEnrollments.id,
            status: monitoringEnrollments.status,
            consentNoticeVersionId: monitoringEnrollments.consentNoticeVersionId,
        }).from(monitoringEnrollments).where(and(eq(monitoringEnrollments.id, input.enrollmentId), eq(monitoringEnrollments.accountId, input.accountId))).for('update').limit(1);
        if (!enrollment)
            throw new MonitoringError('enrollment_not_found');
        if (enrollment.status !== 'active')
            throw new MonitoringError('enrollment_inactive');
        if (enrollment.consentNoticeVersionId !== input.consentNoticeVersionId)
            throw new MonitoringError('consent_required');
        const [session] = await tx.select({
            id: monitoringSessions.id,
            status: monitoringSessions.status,
        }).from(monitoringSessions).where(and(eq(monitoringSessions.id, input.monitoringSessionId), eq(monitoringSessions.enrollmentId, input.enrollmentId), eq(monitoringSessions.accountId, input.accountId))).for('update').limit(1);
        if (!session)
            throw new MonitoringError('session_not_found');
        if (session.status !== 'in_progress')
            throw new MonitoringError('session_inactive');
        const [conversation] = await tx.select({
            id: conversations.id,
            status: conversations.status,
        }).from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.accountId, input.accountId))).for('share').limit(1);
        if (!conversation)
            throw new MonitoringError('conversation_not_found');
        if (conversation.status !== 'active')
            throw new MonitoringError('conversation_inactive');
        return tx.insert(monitoringSessionConversations).values({
            id: input.associationId,
            enrollmentId: input.enrollmentId,
            monitoringSessionId: input.monitoringSessionId,
            conversationId: input.conversationId,
            accountId: input.accountId,
            createdAt: input.createdAt,
        }).returning();
    }
}
