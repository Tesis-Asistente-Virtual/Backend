import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MonitoringError } from '../../../domain/model/monitoring-errors.js';
import type { MonitoringConversationAssociationRepository } from '../../../domain/repositories/monitoring-conversation-association-repository.js';
import type { MonitoringEnrollmentRepository } from '../../../domain/repositories/monitoring-enrollment-repository.js';
import type { MonitoringConsentAuthorizer } from '../../ports/monitoring-consent-authorizer.js';
import type { MonitoringConversationAssociationScope } from '../../ports/monitoring-conversation-association-scope.js';
import { monitoringConsentPurpose } from '../../../domain/model/monitoring-contracts.js';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const inputSchema = z.object({
  enrollmentId: uuid,
  monitoringSessionId: uuid,
  conversationId: uuid,
  explicitAssociation: z.literal(true),
}).strict();

export class AssociateConversationWithMonitoringSession {
  constructor(
    private readonly enrollments: MonitoringEnrollmentRepository,
    private readonly associations: MonitoringConversationAssociationRepository,
    private readonly consent: MonitoringConsentAuthorizer,
    private readonly associationScope: MonitoringConversationAssociationScope,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async execute(accountIdValue: string, inputValue: unknown) {
    const accountId = uuid.parse(accountIdValue);
    const input = inputSchema.parse(inputValue);
    const enrollment = await this.enrollments.findByIdForOwner(input.enrollmentId, accountId);
    if (!enrollment) throw new MonitoringError('enrollment_not_found');
    if (enrollment.status !== 'active') throw new MonitoringError('enrollment_inactive');

    let authorization;
    try { authorization = await this.consent.getCurrentAuthorization(accountId); }
    catch { throw new MonitoringError('consent_unavailable'); }
    if (!authorization || authorization.purpose !== monitoringConsentPurpose || authorization.state !== 'granted' ||
      authorization.noticeVersionId !== enrollment.consentNoticeVersionId || !authorization.grantedAt) {
      throw new MonitoringError('consent_required');
    }
    let noticeScopeApproved: boolean;
    try { noticeScopeApproved = await this.associationScope.isNoticeApprovedForAssociation(authorization.noticeVersionId); }
    catch { throw new MonitoringError('consent_unavailable'); }
    if (!noticeScopeApproved) throw new MonitoringError('conversation_association_not_authorized');

    const createdAt = new Date(Math.max(this.clock().getTime(), authorization.checkedAt.getTime(), enrollment.updatedAt.getTime()));
    return this.associations.createWithCurrentConsent({
      associationId: this.newId(),
      enrollmentId: enrollment.enrollmentId,
      monitoringSessionId: input.monitoringSessionId,
      conversationId: input.conversationId,
      accountId,
      consentNoticeVersionId: enrollment.consentNoticeVersionId,
      createdAt,
    });
  }
}
