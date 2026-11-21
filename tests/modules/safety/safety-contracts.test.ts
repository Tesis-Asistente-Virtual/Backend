import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseSafetyActionExecution,
  parseSafetyAssessment,
  parseSafetyDecision,
  parseSafetyPolicyVersion,
  SafetyDomainError,
  safetyContractVersion,
  safetyEvidenceReferenceSchema,
  safetySignalSchema,
} from '../../../src/modules/safety/domain/model/safety-contracts.js';
import { detectSafetySignalsInputSchema } from '../../../src/modules/safety/application/ports/safety-ports.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const conversationId = randomUUID();
const messageId = randomUUID();
const evidenceId = randomUUID();
const signalId = randomUUID();

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: safetyContractVersion,
    evidenceReferenceId: evidenceId,
    source: 'conversation_message',
    conversationId,
    messageId,
    assessmentResponseId: null,
    observedAt: now,
    ...overrides,
  };
}

function signal(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: safetyContractVersion,
    signalId,
    category: 'self_harm_expression',
    evidenceState: 'ambiguous',
    evidenceReferenceIds: [evidenceId],
    ...overrides,
  };
}

function assessment(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: safetyContractVersion,
    assessmentId: randomUUID(),
    accountId: randomUUID(),
    status: 'completed',
    assessedCategories: ['self_harm_expression', 'suicide_expression'],
    signals: [signal()],
    evidenceReferences: [evidence()],
    assessedAt: now,
    createdAt: now,
    ...overrides,
  };
}

function approvedPolicy(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: safetyContractVersion,
    policyVersionId: randomUUID(),
    policyCode: 'safety-review',
    version: '1.0',
    approvalStatus: 'approved',
    effectiveAt: now,
    approvedAt: now,
    approvedBy: 'professional-review-board',
    approvalReference: 'approval-record-001',
    ...overrides,
  };
}

describe('Safety domain contracts', () => {
  it('represents multiple signals from one evidence reference without scores or diagnoses', () => {
    const parsed = parseSafetyAssessment(assessment({
      signals: [signal(), signal({ signalId: randomUUID(), category: 'suicide_expression' })],
    }));
    expect(parsed.signals).toHaveLength(2);
    expect(parsed.signals.map((item) => item.category)).toEqual(['self_harm_expression', 'suicide_expression']);
  });

  it('represents not assessed explicitly and does not infer no signal from silence', () => {
    const parsed = parseSafetyAssessment(assessment({ status: 'not_assessed', assessedCategories: [], signals: [], evidenceReferences: [], assessedAt: null }));
    expect(parsed.status).toBe('not_assessed');
    expect(() => parseSafetyAssessment(assessment({ status: 'not_assessed', assessedCategories: ['suicide_expression'] }))).toThrow(SafetyDomainError);
  });

  it('represents incomplete assessment separately from completed scope', () => {
    expect(parseSafetyAssessment(assessment({ status: 'assessment_incomplete', assessedAt: null })).status).toBe('assessment_incomplete');
    expect(() => parseSafetyAssessment(assessment({ status: 'assessment_incomplete', assessedAt: now }))).toThrow(SafetyDomainError);
  });

  it('allows explicit scope-limited no-signal outcome without claiming the person is safe', () => {
    const policy = parseSafetyPolicyVersion(approvedPolicy());
    const decision = parseSafetyDecision({
      contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId: randomUUID(),
      status: 'assessed_no_signal_observed', policyVersionId: policy.policyVersionId, signalIds: [], decidedAt: now,
    }, policy, now);
    expect(decision.status).toBe('assessed_no_signal_observed');
    expect(decision).not.toHaveProperty('isSafe');
  });

  it('accepts a potential concern only with a signal reference', () => {
    const policy = parseSafetyPolicyVersion(approvedPolicy());
    expect(() => parseSafetyDecision({
      contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId: randomUUID(),
      status: 'potential_concern_identified', policyVersionId: policy.policyVersionId, signalIds: [], decidedAt: now,
    }, policy, now)).toThrow(SafetyDomainError);
  });

  it('rejects evidence references that do not identify a real source', () => {
    expect(safetyEvidenceReferenceSchema.safeParse(evidence({ messageId: null })).success).toBe(false);
    expect(safetyEvidenceReferenceSchema.safeParse(evidence({ source: 'assessment_response', assessmentResponseId: randomUUID() })).success).toBe(false);
    expect(() => parseSafetyAssessment(assessment({ signals: [signal({ evidenceReferenceIds: [randomUUID()] })] }))).toThrow(SafetyDomainError);
  });

  it('rejects categories outside the explicit assessment scope and unknown clinical fields', () => {
    expect(() => parseSafetyAssessment(assessment({ assessedCategories: ['suicide_expression'] }))).toThrow(SafetyDomainError);
    expect(safetySignalSchema.safeParse({ ...signal(), diagnosis: 'something' }).success).toBe(false);
    expect(() => parseSafetyAssessment(assessment({ score: 4, isSafe: true }))).toThrow(SafetyDomainError);
  });

  it('requires an approved, effective policy with professional approval metadata', () => {
    expect(() => parseSafetyPolicyVersion(approvedPolicy({ approvedBy: null }))).toThrow(SafetyDomainError);
    const draftPolicy = parseSafetyPolicyVersion(approvedPolicy({ approvalStatus: 'draft', effectiveAt: null, approvedAt: null, approvedBy: null, approvalReference: null }));
    expect(() => parseSafetyDecision({
      contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId: randomUUID(),
      status: 'assessed_no_signal_observed', policyVersionId: draftPolicy.policyVersionId, signalIds: [], decidedAt: now,
    }, draftPolicy, now)).toThrow(SafetyDomainError);
    const policy = parseSafetyPolicyVersion(approvedPolicy());
    expect(() => parseSafetyDecision({
      contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId: randomUUID(),
      status: 'assessed_no_signal_observed', policyVersionId: policy.policyVersionId, signalIds: [], decidedAt: now,
    }, policy, new Date('2025-12-31T23:59:59.000Z'))).toThrow(SafetyDomainError);
  });

  it('keeps decision and action execution separate; detection alone requests no action', () => {
    const noAction = parseSafetyActionExecution({
      contractVersion: safetyContractVersion, executionId: randomUUID(), decisionId: randomUUID(),
      actionKind: null, status: 'not_requested', authorizationReference: null, requestedAt: null, executedAt: null,
    });
    expect(noAction.status).toBe('not_requested');
    expect(() => parseSafetyActionExecution({ ...noAction, status: 'completed', actionKind: 'human_review_request', executedAt: now })).toThrow(SafetyDomainError);
    expect(detectSafetySignalsInputSchema.safeParse({ conversationId, messages: [{ messageId, role: 'user', content: 'Synthetic text', accountId: randomUUID() }] }).success).toBe(false);
  });

  it('rejects diagnostic, score, priority, and arbitrary detector output fields', () => {
    expect(safetySignalSchema.safeParse({ ...signal(), diagnosis: 'depression' }).success).toBe(false);
    expect(safetySignalSchema.safeParse({ ...signal(), score: 10 }).success).toBe(false);
    expect(safetySignalSchema.safeParse({ ...signal(), priority: 'high' }).success).toBe(false);
  });
});
