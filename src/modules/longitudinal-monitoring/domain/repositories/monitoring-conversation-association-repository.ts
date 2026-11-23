import type { MonitoringConversationAssociation } from '../model/monitoring-conversation-association.js';

export interface NewMonitoringConversationAssociation {
  readonly associationId: string;
  readonly enrollmentId: string;
  readonly monitoringSessionId: string;
  readonly conversationId: string;
  readonly accountId: string;
  readonly consentNoticeVersionId: string;
  readonly createdAt: Date;
}

export interface MonitoringConversationAssociationRepository {
  /** Locks Consent, enrollment, session and conversation in order, revalidates state/owner, then inserts metadata only. */
  createWithCurrentConsent(input: NewMonitoringConversationAssociation): Promise<MonitoringConversationAssociation>;
}
