import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../../../src/modules/conversations/domain/model/conversation.js';
import type { ConversationMessage } from '../../../src/modules/conversations/domain/model/conversation-message.js';
import type { ConversationMessageRepository } from '../../../src/modules/conversations/domain/repositories/conversation-message-repository.js';
import type { ConversationRepository } from '../../../src/modules/conversations/domain/repositories/conversation-repository.js';
import {
  safetyContractVersion,
  type SafetyDecision,
  type SafetyPolicyVersion,
} from '../../../src/modules/safety/domain/model/safety-contracts.js';
import {
  DenyByDefaultSafetyProcessingAuthorizer,
  safetyProcessingPurpose,
} from '../../../src/modules/safety/application/ports/safety-ports.js';
import type {
  SafetyActionDispatcher,
  SafetyDecisionEvaluator,
  SafetyPolicyProvider,
  SafetyProcessingAuthorizer,
  SafetySignalDetector,
} from '../../../src/modules/safety/application/ports/safety-ports.js';
import { EvaluateConversationSafety, EvaluateConversationSafetyError } from '../../../src/modules/safety/application/internal/command-services/evaluate-conversation-safety.js';

const accountId = randomUUID();
const conversationId = randomUUID();
const messageId = randomUUID();
const now = new Date('2026-08-01T12:00:00.000Z');

const conversation: Conversation = {
  id: conversationId, accountId, title: null, status: 'active', createdAt: now, updatedAt: now,
};

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: messageId, conversationId, role: 'user', content: 'Synthetic student text', status: 'completed',
    createdAt: now, ...overrides,
  };
}

function policy(overrides: Partial<SafetyPolicyVersion> = {}): SafetyPolicyVersion {
  return {
    contractVersion: safetyContractVersion, policyVersionId: randomUUID(), policyCode: 'synthetic-policy', version: 'test-1',
    approvalStatus: 'approved', effectiveAt: now, approvedAt: now, approvedBy: 'fictional-reviewer', approvalReference: 'fictional-approval',
    ...overrides,
  };
}

function makeHarness(options: {
  authorized?: boolean;
  authorizationResults?: boolean[];
  messages?: ConversationMessage[];
  conversation?: Conversation | null;
  detection?: (input: Parameters<SafetySignalDetector['detect']>[0]) => Promise<unknown> | unknown;
  currentPolicy?: SafetyPolicyVersion | null;
  evaluator?: (assessmentId: string, signalIds: string[], policyVersionId: string) => SafetyDecision;
} = {}) {
  const validMessages = options.messages ?? [message()];
  const findByIdForOwner = vi.fn(async () => options.conversation === undefined ? conversation : options.conversation);
  const findByIdsForOwner = vi.fn(async () => validMessages);
  const conversations = { findByIdForOwner } as unknown as ConversationRepository;
  const messages = { findByIdsForOwner } as unknown as ConversationMessageRepository;
  const authorizationResults = [...(options.authorizationResults ?? [options.authorized ?? true, options.authorized ?? true, options.authorized ?? true])];
  const isAuthorized = vi.fn(async () => authorizationResults.shift() ?? false);
  const authorization: SafetyProcessingAuthorizer = { isAuthorized };
  const detect = vi.fn(async (input: Parameters<SafetySignalDetector['detect']>[0]) => {
    if (options.detection) return await options.detection(input);
    return {
      status: 'completed' as const,
      assessedCategories: ['self_harm_expression', 'suicide_expression', 'violence_threat', 'immediate_danger_manifested'] as const,
      signals: [],
    };
  });
  const detector: SafetySignalDetector = { detect: detect as SafetySignalDetector['detect'] };
  const getCurrentPolicy = vi.fn(async () => options.currentPolicy === undefined ? policy() : options.currentPolicy);
  const policies: SafetyPolicyProvider = { getCurrentPolicy };
  const evaluate = vi.fn(async ({ assessment, policy: activePolicy }: Parameters<SafetyDecisionEvaluator['evaluate']>[0]) => {
    const signals = options.evaluator
      ? options.evaluator(assessment.assessmentId, assessment.signals.map((item) => item.signalId), activePolicy.policyVersionId)
      : {
        contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId: assessment.assessmentId,
        status: 'assessed_no_signal_observed' as const, policyVersionId: activePolicy.policyVersionId, signalIds: [], decidedAt: now,
      };
    return signals;
  });
  const evaluator: SafetyDecisionEvaluator = { evaluate };
  const useCase = new EvaluateConversationSafety(conversations, messages, authorization, detector, policies, evaluator, () => now);
  return { useCase, findByIdForOwner, findByIdsForOwner, isAuthorized, detect, getCurrentPolicy, evaluate };
}

const request = { contractVersion: safetyContractVersion, conversationId, messageIds: [messageId] };

describe('EvaluateConversationSafety', () => {
  it('authorizes, checks ownership and completed message references, then returns a scoped result', async () => {
    const harness = makeHarness();
    const result = await harness.useCase.execute(accountId, request);
    expect(result.status).toBe('completed');
    expect(result.assessment.status).toBe('completed');
    expect(result.decision.status).toBe('assessed_no_signal_observed');
    expect(harness.findByIdForOwner).toHaveBeenCalledWith(conversationId, accountId);
    expect(harness.findByIdsForOwner).toHaveBeenCalledWith(conversationId, accountId, [messageId]);
    expect(harness.isAuthorized).toHaveBeenCalledTimes(3);
    expect(harness.isAuthorized).toHaveBeenNthCalledWith(1, accountId, safetyProcessingPurpose);
    expect(harness.isAuthorized).toHaveBeenNthCalledWith(2, accountId, safetyProcessingPurpose);
    expect(harness.isAuthorized).toHaveBeenNthCalledWith(3, accountId, safetyProcessingPurpose);
  });

  it('does not expose another account conversation or load message content', async () => {
    const harness = makeHarness({ conversation: { ...conversation, accountId: randomUUID() } });
    await expect(harness.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'conversation_unavailable' });
    expect(harness.findByIdsForOwner).not.toHaveBeenCalled();
    expect(harness.detect).not.toHaveBeenCalled();
  });

  it('rejects references to foreign, missing, or incomplete messages before detection', async () => {
    for (const invalid of [message({ id: randomUUID() }), message({ status: 'failed' }), message({ conversationId: randomUUID() })]) {
      const harness = makeHarness({ messages: [invalid] });
      await expect(harness.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'message_references_invalid' });
      expect(harness.detect).not.toHaveBeenCalled();
    }
  });

  it('fails closed when authorization is absent or withdrawn before detector invocation', async () => {
    const denied = makeHarness({ authorized: false });
    await expect(denied.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'consent_denied' });
    expect(denied.findByIdsForOwner).not.toHaveBeenCalled();
    expect(denied.detect).not.toHaveBeenCalled();

    const withdrawn = makeHarness({ authorizationResults: [true, false] });
    await expect(withdrawn.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'consent_denied' });
    expect(withdrawn.detect).not.toHaveBeenCalled();
  });

  it('keeps the proposed Safety purpose disabled when no approved Consent adapter is configured', async () => {
    const harness = makeHarness();
    const useCase = new EvaluateConversationSafety(
      { findByIdForOwner: harness.findByIdForOwner } as unknown as ConversationRepository,
      { findByIdsForOwner: harness.findByIdsForOwner } as unknown as ConversationMessageRepository,
      new DenyByDefaultSafetyProcessingAuthorizer(),
      { detect: harness.detect },
      { getCurrentPolicy: harness.getCurrentPolicy },
      { evaluate: harness.evaluate },
      () => now,
    );
    await expect(useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'consent_denied' });
    expect(harness.detect).not.toHaveBeenCalled();
    expect(harness.getCurrentPolicy).not.toHaveBeenCalled();
    expect(harness.evaluate).not.toHaveBeenCalled();
  });

  it.each(['absent', 'declined', 'withdrawn', 'superseded', 'renewal_required'])(
    'does not invoke the detector when Consent reports %s for Safety processing', async () => {
      const harness = makeHarness({ authorized: false });
      await expect(harness.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'consent_denied' });
      expect(harness.detect).not.toHaveBeenCalled();
      expect(harness.evaluate).not.toHaveBeenCalled();
    },
  );

  it('revalidates authorization immediately before detection and before evaluation', async () => {
    const harness = makeHarness();
    await harness.useCase.execute(accountId, request);
    expect(harness.isAuthorized.mock.invocationCallOrder[1]).toBeLessThan(harness.detect.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
    expect(harness.isAuthorized.mock.invocationCallOrder[2]).toBeLessThan(harness.evaluate.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
  });

  it('orders only the requested minimum context chronologically with evidence references', async () => {
    const later = message({ id: randomUUID(), content: 'Later synthetic message', createdAt: new Date(now.getTime() + 1000) });
    const earlier = message({ id: randomUUID(), content: 'Earlier synthetic message', createdAt: new Date(now.getTime() - 1000) });
    const harness = makeHarness({ messages: [later, earlier] });
    await harness.useCase.execute(accountId, { ...request, messageIds: [later.id, earlier.id] });
    const detectorInput = harness.detect.mock.calls[0]?.[0];
    expect(detectorInput?.messages.map((item) => item.messageId)).toEqual([earlier.id, later.id]);
    expect(detectorInput?.messages).toHaveLength(2);
    expect(detectorInput?.messages.every((item) => Boolean(item.evidenceReferenceId))).toBe(true);
  });

  it('maps authorization infrastructure failures safely without invoking detector', async () => {
    const harness = makeHarness();
    harness.isAuthorized.mockRejectedValueOnce(new Error('sensitive internal details'));
    await expect(harness.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'authorization_unavailable' });
    expect(harness.detect).not.toHaveBeenCalled();
  });

  it('distinguishes detector outage, cancellation, and malformed signal references', async () => {
    const outage = makeHarness({ detection: () => { throw new Error('hidden detector error'); } });
    await expect(outage.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'detector_unavailable' });

    const controller = new AbortController();
    const cancelled = makeHarness({ detection: () => { controller.abort(); throw new Error('cancelled'); } });
    await expect(cancelled.useCase.execute(accountId, request, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });

    const malformed = makeHarness({ detection: (input) => ({
      status: 'completed', assessedCategories: ['self_harm_expression'],
      signals: [{ contractVersion: safetyContractVersion, signalId: randomUUID(), category: 'self_harm_expression', evidenceState: 'observed', evidenceReferenceIds: [randomUUID()] }],
    }) });
    await expect(malformed.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'invalid_detector_response' });
  });

  it('preserves multiple signals and evidence provenance without returning source text', async () => {
    const signalIds = [randomUUID(), randomUUID()];
    const harness = makeHarness({ detection: (input) => ({
      status: 'completed',
      assessedCategories: ['self_harm_expression', 'suicide_expression', 'violence_threat', 'immediate_danger_manifested'],
      signals: [
        { contractVersion: safetyContractVersion, signalId: signalIds[0], category: 'self_harm_expression', evidenceState: 'ambiguous', evidenceReferenceIds: [input.messages[0]!.evidenceReferenceId] },
        { contractVersion: safetyContractVersion, signalId: signalIds[1], category: 'suicide_expression', evidenceState: 'observed', evidenceReferenceIds: [input.messages[0]!.evidenceReferenceId] },
      ],
    }), evaluator: (assessmentId, ids, policyVersionId) => ({
      contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId,
      status: 'potential_concern_identified', policyVersionId, signalIds: ids, decidedAt: now,
    }) });
    const result = await harness.useCase.execute(accountId, request);
    expect(result.assessment.signals).toHaveLength(2);
    expect(result.assessment.signals[0]?.evidenceReferenceIds).toEqual([result.assessment.evidenceReferences[0]?.evidenceReferenceId]);
    expect(JSON.stringify(result)).not.toContain('Synthetic student text');
  });

  it('returns an incomplete assessment without policy evaluation or a no-signal decision', async () => {
    const harness = makeHarness({ detection: () => ({ status: 'incomplete', assessedCategories: ['self_harm_expression'], signals: [] }) });
    const result = await harness.useCase.execute(accountId, request);
    expect(result.status).toBe('assessment_incomplete');
    expect(result.assessment.status).toBe('assessment_incomplete');
    expect(result.decision.status).toBe('not_evaluated');
    expect(harness.getCurrentPolicy).not.toHaveBeenCalled();
    expect(harness.evaluate).not.toHaveBeenCalled();
  });

  it('does not invent a decision when no approved, current policy exists', async () => {
    for (const [status, currentPolicy] of [
      ['policy_unavailable', null],
      ['policy_not_approved', policy({ approvalStatus: 'draft', effectiveAt: null, approvedAt: null, approvedBy: null, approvalReference: null })],
      ['policy_not_approved', policy({ effectiveAt: new Date('2027-01-01T00:00:00.000Z') })],
    ] as const) {
      const harness = makeHarness({ currentPolicy });
      const result = await harness.useCase.execute(accountId, request);
      expect(result.status).toBe(status);
      expect(result.decision.status).toBe('not_evaluated');
      expect(harness.evaluate).not.toHaveBeenCalled();
    }
  });

  it('rejects evaluator decisions that do not match assessment, policy, or signals', async () => {
    const harness = makeHarness({ evaluator: () => ({
      contractVersion: safetyContractVersion, decisionId: randomUUID(), assessmentId: randomUUID(),
      status: 'assessed_no_signal_observed', policyVersionId: randomUUID(), signalIds: [], decidedAt: now,
    }) });
    await expect(harness.useCase.execute(accountId, request)).rejects.toMatchObject({ kind: 'invalid_decision' });
  });

  it('does not depend on or invoke the action dispatcher', async () => {
    const dispatch = vi.fn();
    const dispatcher: SafetyActionDispatcher = { dispatch };
    const harness = makeHarness();
    await harness.useCase.execute(accountId, request);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('validates request contract and handles pre-cancelled work without repository access', async () => {
    const harness = makeHarness();
    await expect(harness.useCase.execute(accountId, { ...request, extra: true })).rejects.toBeInstanceOf(EvaluateConversationSafetyError);
    const controller = new AbortController();
    controller.abort();
    await expect(harness.useCase.execute(accountId, request, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(harness.findByIdForOwner).not.toHaveBeenCalled();
  });
});
