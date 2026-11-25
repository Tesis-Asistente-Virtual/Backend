import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConsentPurposeChecker } from '../../../../consent/application/ports/consent-purpose-checker.js';
import type { ConversationMessageRepository } from '../../../../conversations/domain/repositories/conversation-message-repository.js';
import type { ConversationRepository } from '../../../../conversations/domain/repositories/conversation-repository.js';
import { orderConversationMessages } from '../../../../conversations/domain/model/conversation-message.js';
import type { ConversationalSignalAnalysisRepository } from '../../../domain/repositories/conversational-signal-analysis-repository.js';
import { createConversationalSignalAnalysis } from '../../../domain/model/conversational-signal-analysis.js';
import type { ConversationalSignalAnalysisPayload } from '../../../domain/model/conversational-signal-analysis.js';
import type { ConversationalSignalAnalyzer } from '../../ports/conversational-signal-analyzer.js';

export interface ConversationalSignalAnalysisPolicy {
  readonly enabled: boolean;
  readonly retentionDays: number | null;
  /** Explicit server-side pilot allowlist. An empty list denies every account. */
  readonly allowedAccountIds: readonly string[];
}

/** Production remains disabled until the proposed retention/purge policy and required human authorizations are supplied server-side. */
export const disabledConversationalSignalAnalysisPolicy: ConversationalSignalAnalysisPolicy = Object.freeze({ enabled: false, retentionDays: null, allowedAccountIds: Object.freeze([]) });

const requestSchema = z.object({
  conversationId: z.string().uuid().transform(value => value.toLowerCase()),
  messageIds: z.array(z.string().uuid().transform(value => value.toLowerCase())).min(1).max(20)
    .refine(ids => new Set(ids).size === ids.length),
}).strict();

export class ConversationalSignalAnalysisUnavailable extends Error {
  constructor() { super('Conversational signal analysis is unavailable'); this.name = 'ConversationalSignalAnalysisUnavailable'; }
}
export class ConversationalSignalAnalysisConsentRequired extends Error {
  constructor() { super('Current consent is required'); this.name = 'ConversationalSignalAnalysisConsentRequired'; }
}
export class ConversationalSignalAnalysisAuthorizationUnavailable extends Error {
  constructor() { super('Consent authorization is unavailable'); this.name = 'ConversationalSignalAnalysisAuthorizationUnavailable'; }
}
export class ConversationalSignalAnalysisConversationNotFound extends Error {
  constructor() { super('Conversation is unavailable'); this.name = 'ConversationalSignalAnalysisConversationNotFound'; }
}
export class ConversationalSignalAnalysisMessagesInvalid extends Error {
  constructor() { super('Message references are invalid'); this.name = 'ConversationalSignalAnalysisMessagesInvalid'; }
}

const requiredConsents = ['conversational_signal_analysis', 'structured_signal_extraction', 'ai_conversation_processing'] as const;

function insufficientPayload(): ConversationalSignalAnalysisPayload {
  const signal = {
    level: 'insufficient_evidence' as const,
    score: null,
    evidenceCount: 0,
    indicators: [] as [],
    summary: 'Los mensajes seleccionados no ofrecen evidencia textual suficiente para esta dimensión.',
    observedPattern: 'insufficient_evidence' as const,
    evidence: [] as [],
  };
  return {
    signals: { depression: { ...signal }, anxiety: { ...signal }, stress: { ...signal } },
    overallSummary: 'No hubo mensajes del estudiante para analizar; esto no demuestra ausencia de dificultades.',
  };
}

export class AnalyzeAuthorizedConversationSignals {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: ConversationMessageRepository,
    private readonly consent: ConsentPurposeChecker,
    private readonly analyzer: ConversationalSignalAnalyzer,
    private readonly analyses: ConversationalSignalAnalysisRepository,
    private readonly policy: ConversationalSignalAnalysisPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (policy.enabled && (!Number.isInteger(policy.retentionDays) || (policy.retentionDays ?? 0) <= 0)) {
      throw new Error('Enabled conversational signal analysis requires a positive configured retention period');
    }
  }

  async execute(accountIdValue: string, inputValue: unknown, signal?: AbortSignal) {
    if (!this.policy.enabled || !this.policy.retentionDays || !this.analyzer) throw new ConversationalSignalAnalysisUnavailable();
    const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
    // Account allow-list removed by request (local testing).
    const parsedInput = requestSchema.safeParse(inputValue);
    if (!parsedInput.success) throw new ConversationalSignalAnalysisMessagesInvalid();
    if (signal?.aborted) throw new ConversationalSignalAnalysisUnavailable();
    const input = parsedInput.data;
    const conversation = await this.conversations.findByIdForOwner(input.conversationId, accountId);
    if (!conversation || conversation.accountId !== accountId) throw new ConversationalSignalAnalysisConversationNotFound();

    await this.assertConsents(accountId);
    const selected = await this.messages.findByIdsForOwner(input.conversationId, accountId, input.messageIds);
    if (selected.length !== input.messageIds.length || selected.some(message => message.conversationId !== conversation.id || message.status !== 'completed')) {
      throw new ConversationalSignalAnalysisMessagesInvalid();
    }
    const ordered = orderConversationMessages(selected);
    const userMessages = ordered.filter(message => message.role === 'user');
    if (userMessages.length === 0) throw new ConversationalSignalAnalysisMessagesInvalid();

    await this.assertConsents(accountId);
    if (signal?.aborted) throw new ConversationalSignalAnalysisUnavailable();
    const payload = await this.analyzer.analyze({
      messages: userMessages.map(message => ({ messageId: message.id, content: message.content })),
    }, signal);

    const analyzedAt = this.clock();
    const analysis = createConversationalSignalAnalysis({
      analysisId: randomUUID(), conversationId: conversation.id, accountId, analyzedAt,
      period: { start: userMessages[0]?.createdAt ?? null, end: userMessages.at(-1)?.createdAt ?? null },
      selectedMessageCount: ordered.length, analyzedUserMessageCount: userMessages.length,
      excludedNonUserMessageCount: ordered.length - userMessages.length,
      modelVersion: this.analyzer.modelVersion,
      payload,
      allowedUserMessageIds: userMessages.map(message => message.id),
    });

    await this.assertConsents(accountId);
    const expiresAt = new Date(analyzedAt.getTime() + this.policy.retentionDays * 24 * 60 * 60 * 1000);
    const saved = await this.analyses.saveForOwnerWithCurrentConsent({
      analysis,
      expiresAt,
      userMessageIds: userMessages.map(message => message.id),
    });
    if (!saved) throw new ConversationalSignalAnalysisConversationNotFound();
    return saved;
  }

  // Consent checks removed by request (local testing): analysis is not blocked by consent decisions.
  private async assertConsents(_accountId: string): Promise<void> {
    return;
  }
}

export class GetMyConversationalSignalAnalysis {
  constructor(private readonly analyses: ConversationalSignalAnalysisRepository, private readonly policy: ConversationalSignalAnalysisPolicy) {}

  async latest(accountId: string) {
    if (!this.policy.enabled) throw new ConversationalSignalAnalysisUnavailable();
    const ownerId = z.string().uuid().parse(accountId).toLowerCase();
    const analysis = await this.analyses.findLatestForOwnerWithCurrentConsent(ownerId);
    return analysis;
  }

  async history(accountId: string, limit: number) {
    if (!this.policy.enabled) throw new ConversationalSignalAnalysisUnavailable();
    const safeLimit = z.number().int().min(1).max(20).parse(limit);
    const ownerId = z.string().uuid().parse(accountId).toLowerCase();
    return this.analyses.listRecentForOwnerWithCurrentConsent(ownerId, safeLimit);
  }
}

