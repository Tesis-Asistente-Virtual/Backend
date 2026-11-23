import { describe, expect, it } from 'vitest';
import { createConversationSignalResult } from '../../../src/modules/conversational-processing/domain/model/conversation-signal-result.js';
import { createConversationResultObservationReference } from '../../../src/modules/conversational-processing/domain/model/conversation-result-observation-reference.js';
import { createPreliminaryConversationGuidance } from '../../../src/modules/conversational-processing/domain/model/preliminary-conversation-guidance.js';
import type { ConversationSignalExtraction } from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';
import {
  BuildStudentLongitudinalDeclaration,
  StudentLongitudinalDeclarationBoundaryError,
  studentLongitudinalDeclarationRequiredPurposes,
} from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/build-student-longitudinal-declaration.js';
import { studentLongitudinalDeclarationSchema } from '../../../src/modules/longitudinal-monitoring/domain/model/student-longitudinal-declaration.js';
import type {
  CurrentConsentGrant,
  OwnedOpenMonitoringConversationContext,
  SourceConsentProvenance,
} from '../../../src/modules/longitudinal-monitoring/application/ports/student-longitudinal-declaration-trust-ports.js';
import type { ConsentPurpose } from '../../../src/modules/consent/domain/model/consent.js';

const ids = {
  account: '550e8400-e29b-41d4-a716-446655440000',
  enrollment: '550e8400-e29b-41d4-a716-446655440001',
  session: '550e8400-e29b-41d4-a716-446655440002',
  conversation: '550e8400-e29b-41d4-a716-446655440003',
  result: '550e8400-e29b-41d4-a716-446655440004',
  message: '550e8400-e29b-41d4-a716-446655440005',
  otherConversation: '550e8400-e29b-41d4-a716-446655440006',
  stranger: '550e8400-e29b-41d4-a716-446655440007',
};

const extraction: ConversationSignalExtraction = {
  schemaVersion: '1.0',
  observations: [{
    evidence: 'reported',
    manifestation: { status: 'reported', value: 'Reporte totalmente ficticio para probar el contrato.' },
    possibleDimensions: [],
    duration: { status: 'not_reported' },
    frequency: { status: 'not_assessed' },
    intensity: { status: 'not_assessed' },
    contexts: [],
    functionalImpact: { status: 'not_assessed' },
    sourceMessageIds: [ids.message],
  }],
  missingInformation: [],
  clarificationQuestions: [],
};

function sourceResult(resultId = ids.result, conversationId = ids.conversation) {
  const result = createConversationSignalResult({
    id: resultId,
    conversationId,
    accountId: ids.account,
    generatedAt: new Date('2026-11-23T10:00:00.000Z'),
    extractorVersion: '1.0.0',
    sourceMessageIds: [ids.message],
    extraction,
  });
  const { accountId: _owner, ...publicResult } = result;
  return { ...publicResult, status: 'completed' as const, preliminaryGuidance: createPreliminaryConversationGuidance(result) };
}

const payload = sourceResult();
const reference = createConversationResultObservationReference(payload, 0);
const versionIds: Record<ConsentPurpose, string> = {
  ai_conversation_processing: '550e8400-e29b-41d4-a716-446655440010',
  structured_signal_extraction: '550e8400-e29b-41d4-a716-446655440011',
  longitudinal_monitoring: '550e8400-e29b-41d4-a716-446655440012',
  preliminary_assessment: '550e8400-e29b-41d4-a716-446655440013',
};

function sourceAuthorizations(): SourceConsentProvenance[] {
  return studentLongitudinalDeclarationRequiredPurposes.map(purpose => ({ purpose, noticeVersionId: versionIds[purpose] }));
}

function currentGrant(purpose: ConsentPurpose): CurrentConsentGrant {
  return { purpose, noticeVersionId: versionIds[purpose] };
}

function context(overrides: Partial<OwnedOpenMonitoringConversationContext> = {}): OwnedOpenMonitoringConversationContext {
  return {
    accountId: ids.account,
    enrollmentId: ids.enrollment,
    sessionId: ids.session,
    conversationId: ids.conversation,
    enrollmentStatus: 'active',
    sessionStatus: 'in_progress',
    conversationStatus: 'active',
    associationVerified: true,
    ...overrides,
  };
}

function setup(options: {
  readonly context?: OwnedOpenMonitoringConversationContext | null;
  readonly grants?: Partial<Record<ConsentPurpose, CurrentConsentGrant | null>>;
  readonly source?: readonly SourceConsentProvenance[];
  readonly scopeAllowed?: boolean;
  readonly result?: unknown | null;
} = {}) {
  const calls = { context: 0, consent: 0, scope: 0, result: 0 };
  const boundary = new BuildStudentLongitudinalDeclaration(
    { findForOwner: async () => { calls.context++; return options.context === undefined ? context() : options.context; } },
    { getCurrentGrant: async (_accountId, purpose) => {
      calls.consent++;
      return options.grants?.[purpose] === undefined ? currentGrant(purpose) : options.grants[purpose] ?? null;
    } },
    { allowsDeclaration: async () => { calls.scope++; return options.scopeAllowed ?? true; } },
    { resolveForOwner: async () => {
      calls.result++;
      return options.result === null ? null : {
        payload: options.result ?? payload,
        sourceAuthorizations: options.source ?? sourceAuthorizations(),
      };
    } },
    () => new Date('2026-11-23T11:30:00.000Z'),
  );
  return { boundary, calls };
}

async function expectError(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code });
}

describe('BuildStudentLongitudinalDeclaration trust boundary', () => {
  it('builds a declaration from authenticated owner context and exact authorized ephemeral evidence', async () => {
    const { boundary, calls } = setup();
    const result = await boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'changed', optionalDescription: 'Descripción ficticia.' });

    expect(studentLongitudinalDeclarationSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      contractVersion: '1.1',
      sessionId: ids.session,
      conversationId: ids.conversation,
      referencedObservation: reference,
      responseType: 'changed',
      source: 'student_self_report',
      confirmationStatus: 'student_confirmed',
      createdAt: '2026-11-23T11:30:00.000Z',
    });
    expect(result).not.toHaveProperty('accountId');
    expect(calls).toEqual({ context: 1, consent: 3, scope: 1, result: 1 });
  });

  it('rejects client-supplied owner, source, confirmation, timestamp, consent, and extra fields', async () => {
    const { boundary, calls } = setup();
    await expectError(boundary.execute(ids.account, ids.session, {
      referencedObservation: reference,
      responseType: 'changed',
      accountId: ids.account,
      source: 'student_self_report',
      confirmationStatus: 'student_confirmed',
      createdAt: '2026-11-23T11:30:00.000Z',
      consentGranted: true,
    }), 'invalid_input');
    expect(calls.context).toBe(0);
  });

  it('fails closed when owner lookup returns no matching session/conversation', async () => {
    const { boundary, calls } = setup({ context: null });
    await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'owned_context_unavailable');
    expect(calls.consent).toBe(0);
    expect(calls.result).toBe(0);
  });

  it('rejects a context belonging to a different account', async () => {
    const { boundary } = setup({ context: context({ accountId: ids.stranger }) });
    await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'owned_context_unavailable');
  });

  it('rejects closed sessions, inactive enrollments, and unverified associations', async () => {
    for (const inactive of [
      context({ sessionStatus: 'completed' }),
      context({ enrollmentStatus: 'withdrawn' }),
      context({ associationVerified: false }),
    ]) {
      const { boundary, calls } = setup({ context: inactive });
      await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'context_not_active');
      expect(calls.consent).toBe(0);
    }
  });

  it('denies a missing purpose grant before resolving the ephemeral result', async () => {
    const { boundary, calls } = setup({ grants: { structured_signal_extraction: null } });
    await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'consent_required');
    expect(calls.result).toBe(0);
  });

  it('fails closed when consent infrastructure is unavailable', async () => {
    const broken = new BuildStudentLongitudinalDeclaration(
      { findForOwner: async () => context() },
      { getCurrentGrant: async () => { throw new Error('synthetic checker failure'); } },
      { allowsDeclaration: async () => true },
      { resolveForOwner: async () => ({ payload, sourceAuthorizations: sourceAuthorizations() }) },
      () => new Date('2026-11-23T11:30:00.000Z'),
    );
    await expectError(broken.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'consent_unavailable');
  });

  it('rejects a superseded notice scope or source result authorized under another notice version', async () => {
    const { boundary } = setup({ scopeAllowed: false });
    await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'notice_scope_denied');

    const staleSource = sourceAuthorizations().map(item => item.purpose === 'ai_conversation_processing'
      ? { ...item, noticeVersionId: '550e8400-e29b-41d4-a716-446655440099' }
      : item);
    const stale = setup({ source: staleSource });
    await expectError(stale.boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'continues' }), 'consent_required');
  });

  it('denies when the exact result payload is no longer available', async () => {
    const { boundary } = setup({ result: null });
    await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType: 'changed' }), 'result_unavailable');
  });

  it('rejects a cross-conversation reference even when the owner context lookup succeeds', async () => {
    const crossed = { ...reference, conversationId: ids.otherConversation };
    const { boundary } = setup({
      context: context({ conversationId: ids.otherConversation }),
    });
    await expectError(boundary.execute(ids.account, ids.session, { referencedObservation: crossed, responseType: 'continues' }), 'reference_invalid');
  });

  it('accepts unsure and prefer_not_to_answer as self-submitted, non-comparative responses', async () => {
    for (const responseType of ['unsure', 'prefer_not_to_answer'] as const) {
      const { boundary } = setup();
      const declaration = await boundary.execute(ids.account, ids.session, { referencedObservation: reference, responseType });
      expect(declaration.responseType).toBe(responseType);
      expect(declaration.source).toBe('student_self_report');
      expect(declaration.confirmationStatus).toBe('student_confirmed');
      expect(declaration).not.toHaveProperty('comparisonStatus');
    }
  });

  it('is deterministic for the same verified context and server clock', async () => {
    const first = setup();
    const second = setup();
    const input = { referencedObservation: reference, responseType: 'continues' };
    expect(await first.boundary.execute(ids.account, ids.session, input)).toEqual(await second.boundary.execute(ids.account, ids.session, input));
  });

  it('uses only the three separately authorized purposes', () => {
    expect(studentLongitudinalDeclarationRequiredPurposes).toEqual([
      'longitudinal_monitoring', 'ai_conversation_processing', 'structured_signal_extraction',
    ]);
  });

  it('exposes only stable, non-sensitive boundary errors', () => {
    const error = new StudentLongitudinalDeclarationBoundaryError('reference_invalid');
    expect(error.message).not.toContain(ids.message);
  });
});
