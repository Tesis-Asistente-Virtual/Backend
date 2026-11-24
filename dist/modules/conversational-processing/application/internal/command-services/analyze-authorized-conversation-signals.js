import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { orderConversationMessages } from '../../../../conversations/domain/model/conversation-message.js';
import { createConversationalSignalAnalysis } from '../../../domain/model/conversational-signal-analysis.js';
/** Production remains disabled until the proposed retention/purge policy and required human authorizations are supplied server-side. */
export const disabledConversationalSignalAnalysisPolicy = Object.freeze({ enabled: false, retentionDays: null, allowedAccountIds: Object.freeze([]) });
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
const requiredConsents = ['conversational_signal_analysis', 'structured_signal_extraction', 'ai_conversation_processing'];
function insufficientPayload() {
    const signal = {
        level: 'insufficient_evidence',
        evidenceCount: 0,
        indicators: [],
        summary: 'Los mensajes seleccionados no ofrecen evidencia textual suficiente para esta dimensión.',
        observedPattern: 'insufficient_evidence',
        evidence: [],
    };
    return {
        signals: { depression: { ...signal }, anxiety: { ...signal }, stress: { ...signal } },
        overallSummary: 'No hubo mensajes del estudiante para analizar; esto no demuestra ausencia de dificultades.',
    };
}
export class AnalyzeAuthorizedConversationSignals {
    conversations;
    messages;
    consent;
    analyzer;
    analyses;
    policy;
    clock;
    constructor(conversations, messages, consent, analyzer, analyses, policy, clock = () => new Date()) {
        this.conversations = conversations;
        this.messages = messages;
        this.consent = consent;
        this.analyzer = analyzer;
        this.analyses = analyses;
        this.policy = policy;
        this.clock = clock;
        if (policy.enabled && (!Number.isInteger(policy.retentionDays) || (policy.retentionDays ?? 0) <= 0)) {
            throw new Error('Enabled conversational signal analysis requires a positive configured retention period');
        }
    }
    async execute(accountIdValue, inputValue, signal) {
        if (!this.policy.enabled || !this.policy.retentionDays || !this.analyzer)
            throw new ConversationalSignalAnalysisUnavailable();
        const accountId = z.string().uuid().parse(accountIdValue).toLowerCase();
        if (!this.policy.allowedAccountIds.includes(accountId))
            throw new ConversationalSignalAnalysisUnavailable();
        const parsedInput = requestSchema.safeParse(inputValue);
        if (!parsedInput.success)
            throw new ConversationalSignalAnalysisMessagesInvalid();
        if (signal?.aborted)
            throw new ConversationalSignalAnalysisUnavailable();
        const input = parsedInput.data;
        const conversation = await this.conversations.findByIdForOwner(input.conversationId, accountId);
        if (!conversation || conversation.accountId !== accountId)
            throw new ConversationalSignalAnalysisConversationNotFound();
        await this.assertConsents(accountId);
        const selected = await this.messages.findByIdsForOwner(input.conversationId, accountId, input.messageIds);
        if (selected.length !== input.messageIds.length || selected.some(message => message.conversationId !== conversation.id || message.status !== 'completed')) {
            throw new ConversationalSignalAnalysisMessagesInvalid();
        }
        const ordered = orderConversationMessages(selected);
        const userMessages = ordered.filter(message => message.role === 'user');
        if (userMessages.length === 0)
            throw new ConversationalSignalAnalysisMessagesInvalid();
        await this.assertConsents(accountId);
        if (signal?.aborted)
            throw new ConversationalSignalAnalysisUnavailable();
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
        if (!saved)
            throw new ConversationalSignalAnalysisConversationNotFound();
        return saved;
    }
    async assertConsents(accountId) {
        try {
            for (const purpose of requiredConsents) {
                if (!await this.consent.execute(accountId, purpose))
                    throw new ConversationalSignalAnalysisConsentRequired();
            }
        }
        catch (error) {
            if (error instanceof ConversationalSignalAnalysisConsentRequired)
                throw error;
            throw new ConversationalSignalAnalysisAuthorizationUnavailable();
        }
    }
}
export class GetMyConversationalSignalAnalysis {
    analyses;
    policy;
    constructor(analyses, policy) {
        this.analyses = analyses;
        this.policy = policy;
    }
    async latest(accountId) {
        if (!this.policy.enabled)
            throw new ConversationalSignalAnalysisUnavailable();
        const ownerId = z.string().uuid().parse(accountId).toLowerCase();
        if (!this.policy.allowedAccountIds.includes(ownerId))
            throw new ConversationalSignalAnalysisUnavailable();
        const analysis = await this.analyses.findLatestForOwnerWithCurrentConsent(ownerId);
        return analysis;
    }
    async history(accountId, limit) {
        if (!this.policy.enabled)
            throw new ConversationalSignalAnalysisUnavailable();
        const safeLimit = z.number().int().min(1).max(20).parse(limit);
        const ownerId = z.string().uuid().parse(accountId).toLowerCase();
        if (!this.policy.allowedAccountIds.includes(ownerId))
            throw new ConversationalSignalAnalysisUnavailable();
        return this.analyses.listRecentForOwnerWithCurrentConsent(ownerId, safeLimit);
    }
}
