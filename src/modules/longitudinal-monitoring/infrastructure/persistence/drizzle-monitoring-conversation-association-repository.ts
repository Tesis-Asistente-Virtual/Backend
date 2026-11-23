import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../../shared/infrastructure/database/schema.js';
import { conversations } from '../../../conversations/infrastructure/persistence/schema.js';
import { MonitoringError } from '../../domain/model/monitoring-errors.js';
import {
  monitoringConversationAssociationContractVersion,
  parseMonitoringConversationAssociation,
  type MonitoringConversationAssociation,
} from '../../domain/model/monitoring-conversation-association.js';
import type { MonitoringConversationAssociationRepository, NewMonitoringConversationAssociation } from '../../domain/repositories/monitoring-conversation-association-repository.js';
import { requireCurrentMonitoringConsent } from './monitoring-consent-transaction.js';
import { monitoringEnrollments, monitoringSessionConversations, monitoringSessions } from './schema.js';

type DrizzleTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
type AssociationRow = typeof monitoringSessionConversations.$inferSelect;

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.cause === 'object' && candidate.cause !== null) {
    const cause = candidate.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return typeof candidate.code === 'string' ? candidate.code : undefined;
}

function mapRow(row: AssociationRow): MonitoringConversationAssociation {
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

export class DrizzleMonitoringConversationAssociationRepository implements MonitoringConversationAssociationRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async createWithCurrentConsent(input: NewMonitoringConversationAssociation): Promise<MonitoringConversationAssociation> {
    let inserted: AssociationRow | undefined;
    try {
      [inserted] = await this.db.transaction(async (tx) => this.insertAuthorized(tx, input));
    } catch (error) {
      if (error instanceof MonitoringError) throw error;
      if (postgresCode(error) === '23505') throw new MonitoringError('conversation_already_associated');
      throw error;
    }
    if (!inserted) throw new Error('Monitoring conversation association insert returned no row');
    return mapRow(inserted);
  }

  private async insertAuthorized(tx: DrizzleTransaction, input: NewMonitoringConversationAssociation) {
    // Same global order as Consent: account -> notice -> enrollment -> session -> conversation.
    await requireCurrentMonitoringConsent(tx, input.accountId, input.consentNoticeVersionId);
    const [enrollment] = await tx.select({
      id: monitoringEnrollments.id,
      status: monitoringEnrollments.status,
      consentNoticeVersionId: monitoringEnrollments.consentNoticeVersionId,
    }).from(monitoringEnrollments).where(and(
      eq(monitoringEnrollments.id, input.enrollmentId),
      eq(monitoringEnrollments.accountId, input.accountId),
    )).for('update').limit(1);
    if (!enrollment) throw new MonitoringError('enrollment_not_found');
    if (enrollment.status !== 'active') throw new MonitoringError('enrollment_inactive');
    if (enrollment.consentNoticeVersionId !== input.consentNoticeVersionId) throw new MonitoringError('consent_required');

    const [session] = await tx.select({
      id: monitoringSessions.id,
      status: monitoringSessions.status,
    }).from(monitoringSessions).where(and(
      eq(monitoringSessions.id, input.monitoringSessionId),
      eq(monitoringSessions.enrollmentId, input.enrollmentId),
      eq(monitoringSessions.accountId, input.accountId),
    )).for('update').limit(1);
    if (!session) throw new MonitoringError('session_not_found');
    if (session.status !== 'in_progress') throw new MonitoringError('session_inactive');

    const [conversation] = await tx.select({
      id: conversations.id,
      status: conversations.status,
    }).from(conversations).where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.accountId, input.accountId),
    )).for('share').limit(1);
    if (!conversation) throw new MonitoringError('conversation_not_found');
    if (conversation.status !== 'active') throw new MonitoringError('conversation_inactive');

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
