import { z } from 'zod';
import { safetyActionExecutionSchema, safetyAssessmentSchema, safetyDecisionSchema, safetyEvidenceReferenceSchema, safetyPolicyVersionSchema, safetySignalSchema, safetySignalCategories, } from '../../domain/model/safety-contracts.js';
export const detectSafetySignalsInputSchema = z.object({
    conversationId: z.string().uuid(),
    categoriesToAssess: z.array(z.enum(safetySignalCategories)).min(1).max(safetySignalCategories.length)
        .refine((categories) => new Set(categories).size === categories.length),
    messages: z.array(z.object({ evidenceReferenceId: z.string().uuid(), messageId: z.string().uuid(), role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(5000) }).strict()).min(1).max(20),
}).strict();
export const safetySignalDetectionResultSchema = z.object({
    status: z.enum(['completed', 'incomplete']),
    assessedCategories: z.array(z.enum(safetySignalCategories)).max(safetySignalCategories.length)
        .refine((categories) => new Set(categories).size === categories.length),
    signals: z.array(safetySignalSchema).max(50),
}).strict();
/** Proposed purpose identifier only. It is not currently present in Consent & Privacy. */
export const safetyProcessingPurpose = 'safety_signal_processing';
/** Safe placeholder for any future composition that has no explicitly approved Safety consent adapter. */
export class DenyByDefaultSafetyProcessingAuthorizer {
    async isAuthorized(_accountId, _purpose) {
        return false;
    }
}
export const evaluateSafetyDecisionInputSchema = z.object({
    assessment: safetyAssessmentSchema,
    policy: safetyPolicyVersionSchema,
    evaluatedAt: z.date(),
}).strict();
export const dispatchSafetyActionInputSchema = z.object({
    decision: safetyDecisionSchema,
    actionKind: z.enum(['human_review_request', 'user_support_guidance']),
    authorizationReference: z.string().trim().min(1).max(100),
    authorizedByAccountId: z.string().uuid(),
    authorizedAt: z.date(),
    requestedAt: z.date(),
}).strict();
export const safetyPortOutputSchemas = {
    signal: safetySignalSchema,
    evidenceReference: safetyEvidenceReferenceSchema,
    assessment: safetyAssessmentSchema,
    decision: safetyDecisionSchema,
    policy: safetyPolicyVersionSchema,
    actionExecution: safetyActionExecutionSchema,
};
