import type { ConsentPurpose } from '../../../consent/domain/model/consent.js';
import type { ConversationStatus } from '../../../conversations/domain/model/conversation.js';
import type { MonitoringEnrollment, MonitoringSession } from '../../domain/model/monitoring-contracts.js';

export interface OwnedOpenMonitoringConversationContext {
  readonly accountId: string;
  readonly enrollmentId: string;
  readonly sessionId: string;
  readonly conversationId: string;
  readonly enrollmentStatus: MonitoringEnrollment['status'];
  readonly sessionStatus: MonitoringSession['status'];
  readonly conversationStatus: ConversationStatus;
  /** True only when a stored, owner-checked session/conversation link is available. */
  readonly associationVerified: boolean;
}

/** Queries by authenticated owner; IDs are selectors only and never proof of ownership. */
export interface OwnedMonitoringConversationContextReader {
  findForOwner(accountId: string, sessionId: string, conversationId: string): Promise<OwnedOpenMonitoringConversationContext | null>;
}

export interface CurrentConsentGrant {
  readonly purpose: ConsentPurpose;
  readonly noticeVersionId: string;
}

export interface CurrentConsentGrantReader {
  getCurrentGrant(accountId: string, purpose: ConsentPurpose): Promise<CurrentConsentGrant | null>;
}

export interface ExactNoticeScopePolicy {
  /** Must return true only for the exact reviewed notice versions and declared reuse scope. */
  allowsDeclaration(input: readonly CurrentConsentGrant[]): Promise<boolean>;
}

export interface SourceConsentProvenance {
  readonly purpose: ConsentPurpose;
  readonly noticeVersionId: string;
}

export interface ResolvedEphemeralConversationResult {
  readonly payload: unknown;
  /** Server-side provenance captured when the result was produced; never supplied by the client. */
  readonly sourceAuthorizations: readonly SourceConsentProvenance[];
}

/** No production adapter exists: conversation results are not retained server-side today. */
export interface ExactEphemeralConversationResultResolver {
  resolveForOwner(input: {
    readonly accountId: string;
    readonly resultId: string;
    readonly conversationId: string;
  }): Promise<ResolvedEphemeralConversationResult | null>;
}
