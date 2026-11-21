import { z } from 'zod';

/** Version of the provider-neutral Safety domain contracts. */
export const safetyContractVersion = '1.0' as const;

export const safetySignalCategories = [
  'self_harm_expression',
  'suicide_expression',
  'violence_threat',
  'immediate_danger_manifested',
] as const;
export type SafetySignalCategory = (typeof safetySignalCategories)[number];

export const safetyEvidenceStates = ['observed', 'ambiguous'] as const;
export const safetyAssessmentStatuses = ['not_assessed', 'assessment_incomplete', 'completed'] as const;
export const safetyDecisionStatuses = [
  'not_evaluated',
  'assessment_incomplete',
  'assessed_no_signal_observed',
  'potential_concern_identified',
  'requires_human_review',
] as const;
export const safetyPolicyApprovalStatuses = ['draft', 'pending_review', 'approved', 'rejected', 'retired'] as const;
export const safetyEvidenceSources = ['conversation_message', 'assessment_response'] as const;

const uuid = z.string().uuid();
const date = z.date();
const policyVersionText = z.string().trim().min(1).max(40);
const identifierText = z.string().trim().min(1).max(100);

export const safetyEvidenceReferenceSchema = z.object({
  contractVersion: z.literal(safetyContractVersion),
  evidenceReferenceId: uuid,
  source: z.enum(safetyEvidenceSources),
  conversationId: uuid.nullable(),
  messageId: uuid.nullable(),
  assessmentResponseId: uuid.nullable(),
  observedAt: date,
}).strict().superRefine((reference, context) => {
  if (reference.source === 'conversation_message' && (!reference.conversationId || !reference.messageId || reference.assessmentResponseId !== null)) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Conversation evidence requires only conversation and message references' });
  }
  if (reference.source === 'assessment_response' && (!reference.assessmentResponseId || reference.conversationId !== null || reference.messageId !== null)) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Assessment evidence requires only an assessment response reference' });
  }
});
export type SafetyEvidenceReference = z.infer<typeof safetyEvidenceReferenceSchema>;

export const safetySignalSchema = z.object({
  contractVersion: z.literal(safetyContractVersion),
  signalId: uuid,
  category: z.enum(safetySignalCategories),
  evidenceState: z.enum(safetyEvidenceStates),
  evidenceReferenceIds: z.array(uuid).min(1).max(10).refine((ids) => new Set(ids).size === ids.length),
}).strict();
export type SafetySignal = z.infer<typeof safetySignalSchema>;

export const safetyAssessmentSchema = z.object({
  contractVersion: z.literal(safetyContractVersion),
  assessmentId: uuid,
  accountId: uuid,
  status: z.enum(safetyAssessmentStatuses),
  assessedCategories: z.array(z.enum(safetySignalCategories)).max(safetySignalCategories.length)
    .refine((values) => new Set(values).size === values.length),
  signals: z.array(safetySignalSchema).max(50),
  evidenceReferences: z.array(safetyEvidenceReferenceSchema).max(100),
  assessedAt: date.nullable(),
  createdAt: date,
}).strict().superRefine((assessment, context) => {
  if (assessment.status === 'not_assessed' && (assessment.assessedAt !== null || assessment.assessedCategories.length > 0 || assessment.signals.length > 0 || assessment.evidenceReferences.length > 0)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'An unassessed record cannot claim scope or contain findings' });
  }
  if (assessment.status === 'assessment_incomplete' && assessment.assessedAt !== null) {
    context.addIssue({ code: 'custom', path: ['assessedAt'], message: 'An incomplete assessment has no completion timestamp' });
  }
  if (assessment.status === 'completed' && (assessment.assessedAt === null || assessment.assessedCategories.length === 0)) {
    context.addIssue({ code: 'custom', path: ['assessedAt'], message: 'A completed assessment requires an explicit scope and timestamp' });
  }

  const evidenceIds = assessment.evidenceReferences.map((reference) => reference.evidenceReferenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({ code: 'custom', path: ['evidenceReferences'], message: 'Evidence reference identifiers must be unique' });
  }
  const signalIds = assessment.signals.map((signal) => signal.signalId);
  if (new Set(signalIds).size !== signalIds.length) {
    context.addIssue({ code: 'custom', path: ['signals'], message: 'Signal identifiers must be unique' });
  }
  for (const [index, signal] of assessment.signals.entries()) {
    if (!assessment.assessedCategories.includes(signal.category)) {
      context.addIssue({ code: 'custom', path: ['signals', index, 'category'], message: 'Signal category must be included in the assessment scope' });
    }
    if (signal.evidenceReferenceIds.some((id) => !evidenceIds.includes(id))) {
      context.addIssue({ code: 'custom', path: ['signals', index, 'evidenceReferenceIds'], message: 'Signals must refer to evidence included in this assessment' });
    }
  }
});
export type SafetyAssessment = z.infer<typeof safetyAssessmentSchema>;

export const safetyPolicyVersionSchema = z.object({
  contractVersion: z.literal(safetyContractVersion),
  policyVersionId: uuid,
  policyCode: identifierText,
  version: policyVersionText,
  approvalStatus: z.enum(safetyPolicyApprovalStatuses),
  effectiveAt: date.nullable(),
  approvedAt: date.nullable(),
  approvedBy: identifierText.nullable(),
  approvalReference: identifierText.nullable(),
}).strict().superRefine((policy, context) => {
  if (policy.approvalStatus === 'approved' && (!policy.effectiveAt || !policy.approvedAt || !policy.approvedBy || !policy.approvalReference)) {
    context.addIssue({ code: 'custom', path: ['approvalStatus'], message: 'Approved policies require effective date and professional approval metadata' });
  }
});
export type SafetyPolicyVersion = z.infer<typeof safetyPolicyVersionSchema>;

export const safetyDecisionSchema = z.object({
  contractVersion: z.literal(safetyContractVersion),
  decisionId: uuid,
  assessmentId: uuid,
  status: z.enum(safetyDecisionStatuses),
  policyVersionId: uuid.nullable(),
  signalIds: z.array(uuid).max(50).refine((ids) => new Set(ids).size === ids.length),
  decidedAt: date.nullable(),
}).strict().superRefine((decision, context) => {
  if (decision.status === 'not_evaluated' && (decision.policyVersionId !== null || decision.decidedAt !== null || decision.signalIds.length > 0)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'An unevaluated decision cannot claim a policy, findings, or decision time' });
  }
  if (decision.status !== 'not_evaluated' && (decision.policyVersionId === null || decision.decidedAt === null)) {
    context.addIssue({ code: 'custom', path: ['policyVersionId'], message: 'Evaluated decisions require an approved policy reference and timestamp' });
  }
  if (decision.status === 'assessed_no_signal_observed' && decision.signalIds.length !== 0) {
    context.addIssue({ code: 'custom', path: ['signalIds'], message: 'No-signal outcome cannot include identified signals' });
  }
  if ((decision.status === 'potential_concern_identified' || decision.status === 'requires_human_review') && decision.signalIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['signalIds'], message: 'Concern outcomes require at least one referenced signal' });
  }
});
export type SafetyDecision = z.infer<typeof safetyDecisionSchema>;

/** A decision is only evaluable under an approved, currently effective policy. */
export function parseSafetyDecision(input: unknown, policy: SafetyPolicyVersion, now = new Date()): SafetyDecision {
  const parsedPolicy = safetyPolicyVersionSchema.safeParse(policy);
  if (!parsedPolicy.success || parsedPolicy.data.approvalStatus !== 'approved' || !parsedPolicy.data.effectiveAt || parsedPolicy.data.effectiveAt > now) {
    throw new SafetyDomainError('policy_not_approved');
  }
  const parsedDecision = safetyDecisionSchema.safeParse(input);
  if (!parsedDecision.success || parsedDecision.data.policyVersionId !== parsedPolicy.data.policyVersionId) {
    throw new SafetyDomainError('invalid_decision');
  }
  return parsedDecision.data;
}

export const safetyActionKinds = ['human_review_request', 'user_support_guidance'] as const;
export const safetyActionExecutionStatuses = ['not_requested', 'pending_authorization', 'authorized', 'dispatched', 'completed', 'failed', 'cancelled'] as const;

/** Kept separate from SafetyDecision: detection/evaluation never executes an action. */
export const safetyActionExecutionSchema = z.object({
  contractVersion: z.literal(safetyContractVersion),
  executionId: uuid,
  decisionId: uuid,
  actionKind: z.enum(safetyActionKinds).nullable(),
  status: z.enum(safetyActionExecutionStatuses),
  authorizationReference: identifierText.nullable(),
  requestedAt: date.nullable(),
  executedAt: date.nullable(),
}).strict().superRefine((execution, context) => {
  if (execution.status === 'not_requested' && (execution.actionKind !== null || execution.authorizationReference !== null || execution.requestedAt !== null || execution.executedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'No action requested must not imply authorization or execution' });
  }
  if (execution.status !== 'not_requested' && (!execution.actionKind || !execution.requestedAt)) {
    context.addIssue({ code: 'custom', path: ['actionKind'], message: 'Requested actions require a kind and request timestamp' });
  }
  if (['authorized', 'dispatched', 'completed'].includes(execution.status) && !execution.authorizationReference) {
    context.addIssue({ code: 'custom', path: ['authorizationReference'], message: 'Execution requires explicit authorization reference' });
  }
  if (['dispatched', 'completed'].includes(execution.status) && !execution.executedAt) {
    context.addIssue({ code: 'custom', path: ['executedAt'], message: 'Dispatched actions require an execution timestamp' });
  }
});
export type SafetyActionExecution = z.infer<typeof safetyActionExecutionSchema>;

export class SafetyDomainError extends Error {
  constructor(readonly code: 'invalid_assessment' | 'invalid_evidence' | 'invalid_policy' | 'policy_not_approved' | 'invalid_decision' | 'invalid_action_execution') {
    super('Safety domain contract validation failed');
    this.name = 'SafetyDomainError';
  }
}

export function parseSafetyAssessment(input: unknown): SafetyAssessment {
  const parsed = safetyAssessmentSchema.safeParse(input);
  if (!parsed.success) throw new SafetyDomainError('invalid_assessment');
  return parsed.data;
}

export function parseSafetyPolicyVersion(input: unknown): SafetyPolicyVersion {
  const parsed = safetyPolicyVersionSchema.safeParse(input);
  if (!parsed.success) throw new SafetyDomainError('invalid_policy');
  return parsed.data;
}

export function parseSafetyActionExecution(input: unknown): SafetyActionExecution {
  const parsed = safetyActionExecutionSchema.safeParse(input);
  if (!parsed.success) throw new SafetyDomainError('invalid_action_execution');
  return parsed.data;
}
