import { z } from 'zod';
import {
  safetyActionExecutionSchema,
  safetyAssessmentSchema,
  safetyDecisionSchema,
  safetyEvidenceReferenceSchema,
  safetyPolicyVersionSchema,
  safetySignalSchema,
  type SafetyActionExecution,
  type SafetyAssessment,
  type SafetyDecision,
  type SafetyPolicyVersion,
  type SafetySignal,
  safetySignalCategories,
} from '../../domain/model/safety-contracts.js';

export const detectSafetySignalsInputSchema = z.object({
  conversationId: z.string().uuid(),
  categoriesToAssess: z.array(z.enum(safetySignalCategories)).min(1).max(safetySignalCategories.length)
    .refine((categories) => new Set(categories).size === categories.length),
  messages: z.array(z.object({ evidenceReferenceId: z.string().uuid(), messageId: z.string().uuid(), role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(5000) }).strict()).min(1).max(20),
}).strict();
export type DetectSafetySignalsInput = z.infer<typeof detectSafetySignalsInputSchema>;

export const safetySignalDetectionResultSchema = z.object({
  status: z.enum(['completed', 'incomplete']),
  assessedCategories: z.array(z.enum(safetySignalCategories)).max(safetySignalCategories.length)
    .refine((categories) => new Set(categories).size === categories.length),
  signals: z.array(safetySignalSchema).max(50),
}).strict();
export type SafetySignalDetectionResult = z.infer<typeof safetySignalDetectionResultSchema>;

/** Detection reports only candidate signals. It must not decide or trigger external actions. */
export interface SafetySignalDetector {
  detect(input: DetectSafetySignalsInput, signal?: AbortSignal): Promise<SafetySignalDetectionResult>;
}

/** Returns only policy metadata. Operational criteria require separate professional approval. */
export interface SafetyPolicyProvider {
  getCurrentPolicy(): Promise<SafetyPolicyVersion | null>;
}

/**
 * Explicit authorization boundary for Safety processing. An adapter may delegate to Consent & Privacy
 * only after an approved purpose for this processing exists; unrelated consent purposes must not be
 * treated as equivalent. No production adapter is provided by this module.
 */
export interface SafetyProcessingAuthorizer {
  isAuthorized(accountId: string, purpose: typeof safetyProcessingPurpose): Promise<boolean>;
}

/** Proposed purpose identifier only. It is not currently present in Consent & Privacy. */
export const safetyProcessingPurpose = 'safety_signal_processing' as const;

/** Safe placeholder for any future composition that has no explicitly approved Safety consent adapter. */
export class DenyByDefaultSafetyProcessingAuthorizer implements SafetyProcessingAuthorizer {
  async isAuthorized(_accountId: string, _purpose: typeof safetyProcessingPurpose): Promise<boolean> {
    return false;
  }
}

export const evaluateSafetyDecisionInputSchema = z.object({
  assessment: safetyAssessmentSchema,
  policy: safetyPolicyVersionSchema,
  evaluatedAt: z.date(),
}).strict();
export type EvaluateSafetyDecisionInput = z.infer<typeof evaluateSafetyDecisionInputSchema>;

/** Evaluators must use approved, effective policy; no clinical thresholds are defined by this port. */
export interface SafetyDecisionEvaluator {
  evaluate(input: EvaluateSafetyDecisionInput): Promise<SafetyDecision>;
}

export const dispatchSafetyActionInputSchema = z.object({
  decision: safetyDecisionSchema,
  actionKind: z.enum(['human_review_request', 'user_support_guidance']),
  authorizationReference: z.string().trim().min(1).max(100),
  authorizedByAccountId: z.string().uuid(),
  authorizedAt: z.date(),
  requestedAt: z.date(),
}).strict();
export type DispatchSafetyActionInput = z.infer<typeof dispatchSafetyActionInputSchema>;

/** Dispatch requires an explicit upstream authorization; it is never invoked by detection itself. */
export interface SafetyActionDispatcher {
  dispatch(input: DispatchSafetyActionInput, signal?: AbortSignal): Promise<SafetyActionExecution>;
}

export const safetyPortOutputSchemas = {
  signal: safetySignalSchema,
  evidenceReference: safetyEvidenceReferenceSchema,
  assessment: safetyAssessmentSchema,
  decision: safetyDecisionSchema,
  policy: safetyPolicyVersionSchema,
  actionExecution: safetyActionExecutionSchema,
} as const;
