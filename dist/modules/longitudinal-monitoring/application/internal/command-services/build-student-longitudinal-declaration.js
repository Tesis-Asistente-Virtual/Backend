import { z } from 'zod';
import { ConversationResultObservationReferenceError, resolveConversationResultObservationReference, } from '../../../../conversational-processing/domain/model/conversation-result-observation-reference.js';
import { conversationResultObservationReferenceSchema } from '../../../../../shared/domain/conversation-result-observation-reference.js';
import { studentLongitudinalDeclarationContractVersion, studentLongitudinalDeclarationSchema, } from '../../../domain/model/student-longitudinal-declaration.js';
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const trustedContextSchema = z.object({
    accountId: uuid,
    enrollmentId: uuid,
    sessionId: uuid,
    conversationId: uuid,
    enrollmentStatus: z.enum(['active', 'paused', 'withdrawn', 'completed']),
    sessionStatus: z.enum(['in_progress', 'completed', 'abandoned']),
    conversationStatus: z.enum(['active', 'archived']),
    associationVerified: z.boolean(),
}).strict();
const responseType = z.enum(['continues', 'changed', 'unsure', 'prefer_not_to_answer']);
const optionalDescription = z.string().trim().min(1).max(500).optional();
/** The complete untrusted client input. Server-owned values and extra fields are rejected. */
export const studentLongitudinalDeclarationSubmissionSchema = z.object({
    referencedObservation: conversationResultObservationReferenceSchema,
    responseType,
    optionalDescription,
}).strict().superRefine((input, context) => {
    if ((input.responseType === 'unsure' || input.responseType === 'prefer_not_to_answer') && input.optionalDescription !== undefined) {
        context.addIssue({ code: 'custom', path: ['optionalDescription'], message: 'This response type does not accept a description' });
    }
});
const requiredPurposes = [
    'longitudinal_monitoring',
    'ai_conversation_processing',
    'structured_signal_extraction',
];
export class StudentLongitudinalDeclarationBoundaryError extends Error {
    code;
    constructor(code) {
        super('Student declaration could not be safely constructed');
        this.code = code;
        this.name = 'StudentLongitudinalDeclarationBoundaryError';
    }
}
/**
 * Internal trust boundary only. It has no production registration or HTTP endpoint.
 * The caller must supply the authenticated account ID from verified server auth context.
 */
export class BuildStudentLongitudinalDeclaration {
    contexts;
    consents;
    noticeScope;
    results;
    clock;
    constructor(contexts, consents, noticeScope, results, clock = () => new Date()) {
        this.contexts = contexts;
        this.consents = consents;
        this.noticeScope = noticeScope;
        this.results = results;
        this.clock = clock;
    }
    async execute(authenticatedAccountIdValue, sessionIdValue, untrustedInput) {
        const authenticatedAccountId = uuid.safeParse(authenticatedAccountIdValue);
        const sessionId = uuid.safeParse(sessionIdValue);
        const input = studentLongitudinalDeclarationSubmissionSchema.safeParse(untrustedInput);
        if (!authenticatedAccountId.success || !sessionId.success || !input.success) {
            throw new StudentLongitudinalDeclarationBoundaryError('invalid_input');
        }
        const conversationId = input.data.referencedObservation.conversationId;
        const contextValue = await this.contexts.findForOwner(authenticatedAccountId.data, sessionId.data, conversationId)
            .catch(() => { throw new StudentLongitudinalDeclarationBoundaryError('owned_context_unavailable'); });
        if (!contextValue)
            throw new StudentLongitudinalDeclarationBoundaryError('owned_context_unavailable');
        const parsedContext = trustedContextSchema.safeParse(contextValue);
        if (!parsedContext.success)
            throw new StudentLongitudinalDeclarationBoundaryError('owned_context_unavailable');
        const context = parsedContext.data;
        if (context.accountId !== authenticatedAccountId.data ||
            context.sessionId.toLowerCase() !== sessionId.data || context.conversationId.toLowerCase() !== conversationId) {
            throw new StudentLongitudinalDeclarationBoundaryError('owned_context_unavailable');
        }
        if (!context.associationVerified || context.enrollmentStatus !== 'active' ||
            context.sessionStatus !== 'in_progress' || context.conversationStatus !== 'active') {
            throw new StudentLongitudinalDeclarationBoundaryError('context_not_active');
        }
        const currentGrants = [];
        try {
            for (const purpose of requiredPurposes) {
                const grant = await this.consents.getCurrentGrant(authenticatedAccountId.data, purpose);
                if (!grant || grant.purpose !== purpose || !z.string().uuid().safeParse(grant.noticeVersionId).success) {
                    throw new StudentLongitudinalDeclarationBoundaryError('consent_required');
                }
                currentGrants.push({ purpose, noticeVersionId: grant.noticeVersionId.toLowerCase() });
            }
        }
        catch (error) {
            if (error instanceof StudentLongitudinalDeclarationBoundaryError)
                throw error;
            throw new StudentLongitudinalDeclarationBoundaryError('consent_unavailable');
        }
        let noticeScopeAllowed;
        try {
            noticeScopeAllowed = await this.noticeScope.allowsDeclaration(currentGrants);
        }
        catch {
            throw new StudentLongitudinalDeclarationBoundaryError('consent_unavailable');
        }
        if (!noticeScopeAllowed)
            throw new StudentLongitudinalDeclarationBoundaryError('notice_scope_denied');
        let resolvedResult;
        try {
            resolvedResult = await this.results.resolveForOwner({
                accountId: authenticatedAccountId.data,
                resultId: input.data.referencedObservation.resultId,
                conversationId,
            });
        }
        catch {
            throw new StudentLongitudinalDeclarationBoundaryError('result_unavailable');
        }
        if (!resolvedResult)
            throw new StudentLongitudinalDeclarationBoundaryError('result_unavailable');
        if (!sourceAuthorizationsMatchCurrentNotices(resolvedResult.sourceAuthorizations, currentGrants)) {
            throw new StudentLongitudinalDeclarationBoundaryError('consent_required');
        }
        try {
            resolveConversationResultObservationReference(input.data.referencedObservation, resolvedResult.payload);
        }
        catch (error) {
            if (error instanceof ConversationResultObservationReferenceError || error instanceof z.ZodError) {
                throw new StudentLongitudinalDeclarationBoundaryError('reference_invalid');
            }
            throw new StudentLongitudinalDeclarationBoundaryError('result_unavailable');
        }
        const createdAt = this.clock();
        if (Number.isNaN(createdAt.getTime()))
            throw new StudentLongitudinalDeclarationBoundaryError('invalid_input');
        return studentLongitudinalDeclarationSchema.parse({
            contractVersion: studentLongitudinalDeclarationContractVersion,
            sessionId: context.sessionId,
            conversationId: context.conversationId,
            referencedObservation: input.data.referencedObservation,
            responseType: input.data.responseType,
            ...(input.data.optionalDescription !== undefined ? { optionalDescription: input.data.optionalDescription } : {}),
            source: 'student_self_report',
            confirmationStatus: 'student_confirmed',
            createdAt: createdAt.toISOString(),
        });
    }
}
function sourceAuthorizationsMatchCurrentNotices(source, current) {
    if (source.length !== requiredPurposes.length || current.length !== requiredPurposes.length)
        return false;
    return requiredPurposes.every(purpose => {
        const sourceGrant = source.find(item => item.purpose === purpose);
        const currentGrant = current.find(item => item.purpose === purpose);
        return sourceGrant !== undefined && currentGrant !== undefined &&
            z.string().uuid().safeParse(sourceGrant.noticeVersionId).success &&
            sourceGrant.noticeVersionId.toLowerCase() === currentGrant.noticeVersionId.toLowerCase();
    });
}
export const studentLongitudinalDeclarationRequiredPurposes = requiredPurposes;
