import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseSafetyAssessment, parseSafetyPolicyVersion, safetyContractVersion, safetyDecisionSchema, safetyEvidenceReferenceSchema, } from '../../../domain/model/safety-contracts.js';
import { detectSafetySignalsInputSchema, safetyProcessingPurpose, safetySignalDetectionResultSchema, } from '../../ports/safety-ports.js';
const requestSchema = z.object({
    contractVersion: z.literal(safetyContractVersion),
    conversationId: z.string().uuid().transform((value) => value.toLowerCase()),
    messageIds: z.array(z.string().uuid().transform((value) => value.toLowerCase())).min(1).max(20)
        .refine((ids) => new Set(ids).size === ids.length),
}).strict();
const assessmentScope = [
    'self_harm_expression',
    'suicide_expression',
    'violence_threat',
    'immediate_danger_manifested',
];
/** Safe application error: no message text, detector payload, or provider detail is retained. */
export class EvaluateConversationSafetyError extends Error {
    kind;
    constructor(kind) {
        super('Conversation safety evaluation could not be completed');
        this.kind = kind;
        this.name = 'EvaluateConversationSafetyError';
    }
}
function orderMessages(messages) {
    return [...messages].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
}
/**
 * Internal, opt-in orchestration only. It is not composed into REST/SSE and never dispatches actions.
 * `accountId` must originate from a trusted authenticated application context, not request data.
 */
export class EvaluateConversationSafety {
    conversations;
    messages;
    authorization;
    detector;
    policies;
    evaluator;
    clock;
    constructor(conversations, messages, authorization, detector, policies, evaluator, clock = () => new Date()) {
        this.conversations = conversations;
        this.messages = messages;
        this.authorization = authorization;
        this.detector = detector;
        this.policies = policies;
        this.evaluator = evaluator;
        this.clock = clock;
    }
    async execute(accountIdValue, requestValue, signal) {
        const accountResult = z.string().uuid().safeParse(accountIdValue);
        const requestResult = requestSchema.safeParse(requestValue);
        if (!accountResult.success || !requestResult.success)
            throw new EvaluateConversationSafetyError('invalid_request');
        const accountId = accountResult.data.toLowerCase();
        const request = requestResult.data;
        if (signal?.aborted)
            throw new EvaluateConversationSafetyError('cancelled');
        let conversation;
        try {
            conversation = await this.conversations.findByIdForOwner(request.conversationId, accountId);
        }
        catch {
            throw new EvaluateConversationSafetyError('repository_unavailable');
        }
        if (!conversation || conversation.accountId.toLowerCase() !== accountId || conversation.id.toLowerCase() !== request.conversationId) {
            throw new EvaluateConversationSafetyError('conversation_unavailable');
        }
        await this.assertAuthorized(accountId);
        let messages;
        try {
            messages = await this.messages.findByIdsForOwner(request.conversationId, accountId, request.messageIds);
        }
        catch {
            throw new EvaluateConversationSafetyError('repository_unavailable');
        }
        if (messages.length !== request.messageIds.length || messages.some((message) => message.conversationId.toLowerCase() !== request.conversationId || message.status !== 'completed' || !request.messageIds.includes(message.id.toLowerCase())))
            throw new EvaluateConversationSafetyError('message_references_invalid');
        const ordered = orderMessages(messages);
        const at = this.clock();
        const references = ordered.map(({ id }) => safetyEvidenceReferenceSchema.parse({
            contractVersion: safetyContractVersion,
            evidenceReferenceId: randomUUID(),
            source: 'conversation_message',
            conversationId: request.conversationId,
            messageId: id.toLowerCase(),
            assessmentResponseId: null,
            observedAt: at,
        }));
        const referenceByMessage = new Map(references.map((reference) => [reference.messageId, reference]));
        const detectionInputResult = detectSafetySignalsInputSchema.safeParse({
            conversationId: request.conversationId,
            categoriesToAssess: [...assessmentScope],
            messages: ordered.map(({ id, role, content }) => ({
                evidenceReferenceId: referenceByMessage.get(id.toLowerCase())?.evidenceReferenceId ?? '',
                messageId: id.toLowerCase(), role, content,
            })),
        });
        if (!detectionInputResult.success)
            throw new EvaluateConversationSafetyError('message_references_invalid');
        const detectionInput = detectionInputResult.data;
        // Re-check immediately before disclosure to the detector. No content is sent if consent was withdrawn.
        await this.assertAuthorized(accountId);
        if (signal?.aborted)
            throw new EvaluateConversationSafetyError('cancelled');
        let rawDetection;
        try {
            rawDetection = await this.detector.detect(detectionInput, signal);
        }
        catch {
            if (signal?.aborted)
                throw new EvaluateConversationSafetyError('cancelled');
            throw new EvaluateConversationSafetyError('detector_unavailable');
        }
        const parsedDetection = safetySignalDetectionResultSchema.safeParse(rawDetection);
        const knownReferences = new Set(references.map((reference) => reference.evidenceReferenceId));
        if (!parsedDetection.success || parsedDetection.data.assessedCategories.some((category) => !assessmentScope.includes(category)) ||
            parsedDetection.data.signals.some((candidate) => !parsedDetection.data.assessedCategories.includes(candidate.category) ||
                candidate.evidenceReferenceIds.some((id) => !knownReferences.has(id)))) {
            throw new EvaluateConversationSafetyError('invalid_detector_response');
        }
        const detectorCompleted = parsedDetection.data.status === 'completed' && sameIds(parsedDetection.data.assessedCategories, assessmentScope);
        const assessment = parseSafetyAssessment({
            contractVersion: safetyContractVersion,
            assessmentId: randomUUID(),
            accountId,
            status: detectorCompleted ? 'completed' : 'assessment_incomplete',
            assessedCategories: parsedDetection.data.assessedCategories,
            signals: parsedDetection.data.signals,
            evidenceReferences: references,
            assessedAt: detectorCompleted ? at : null,
            createdAt: at,
        });
        if (!detectorCompleted) {
            return { status: 'assessment_incomplete', assessment, decision: this.notEvaluatedDecision(assessment) };
        }
        if (signal?.aborted)
            throw new EvaluateConversationSafetyError('cancelled');
        let rawPolicy;
        try {
            rawPolicy = await this.policies.getCurrentPolicy();
        }
        catch {
            return this.withoutDecision('policy_unavailable', assessment);
        }
        if (!rawPolicy)
            return this.withoutDecision('policy_unavailable', assessment);
        let policy;
        try {
            policy = parseSafetyPolicyVersion(rawPolicy);
        }
        catch {
            throw new EvaluateConversationSafetyError('invalid_policy');
        }
        if (policy.approvalStatus !== 'approved' || !policy.effectiveAt || policy.effectiveAt > at) {
            return this.withoutDecision('policy_not_approved', assessment);
        }
        await this.assertAuthorized(accountId);
        if (signal?.aborted)
            throw new EvaluateConversationSafetyError('cancelled');
        let rawDecision;
        try {
            rawDecision = await this.evaluator.evaluate({ assessment, policy, evaluatedAt: at });
        }
        catch {
            throw new EvaluateConversationSafetyError('evaluation_unavailable');
        }
        const decisionResult = safetyDecisionSchema.safeParse(rawDecision);
        if (!decisionResult.success || decisionResult.data.assessmentId !== assessment.assessmentId ||
            decisionResult.data.policyVersionId !== policy.policyVersionId || decisionResult.data.status === 'not_evaluated' ||
            !sameIds(decisionResult.data.signalIds, assessment.signals.map((item) => item.signalId))) {
            throw new EvaluateConversationSafetyError('invalid_decision');
        }
        if (signal?.aborted)
            throw new EvaluateConversationSafetyError('cancelled');
        return { status: 'completed', assessment, decision: decisionResult.data };
    }
    async assertAuthorized(accountId) {
        let authorized;
        try {
            authorized = await this.authorization.isAuthorized(accountId, safetyProcessingPurpose);
        }
        catch {
            throw new EvaluateConversationSafetyError('authorization_unavailable');
        }
        if (!authorized)
            throw new EvaluateConversationSafetyError('consent_denied');
    }
    withoutDecision(status, assessment) {
        return {
            status,
            assessment,
            decision: this.notEvaluatedDecision(assessment),
        };
    }
    notEvaluatedDecision(assessment) {
        return {
            contractVersion: safetyContractVersion,
            decisionId: randomUUID(),
            assessmentId: assessment.assessmentId,
            status: 'not_evaluated',
            policyVersionId: null,
            signalIds: [],
            decidedAt: null,
        };
    }
}
function sameIds(left, right) {
    return left.length === right.length && left.every((id) => right.includes(id));
}
