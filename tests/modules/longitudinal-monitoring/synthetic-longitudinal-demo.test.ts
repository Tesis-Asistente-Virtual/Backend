import { describe, expect, it } from 'vitest';
import { createPreliminaryConversationGuidance } from '../../../src/modules/conversational-processing/domain/model/preliminary-conversation-guidance.js';
import { createConversationResultObservationReference } from '../../../src/modules/conversational-processing/domain/model/conversation-result-observation-reference.js';
import { createConversationSignalResult, type ConversationSignalResult } from '../../../src/modules/conversational-processing/domain/model/conversation-signal-result.js';
import type { ConversationSignalExtraction } from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';
import { compareLongitudinalConversationSnapshots, type LongitudinalConversationSnapshot } from '../../../src/modules/longitudinal-monitoring/domain/model/longitudinal-conversation-comparison.js';
import { BuildStudentLongitudinalDeclaration } from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/build-student-longitudinal-declaration.js';
import type {
  CurrentConsentGrant,
  OwnedMonitoringConversationContextReader,
  SourceConsentProvenance,
} from '../../../src/modules/longitudinal-monitoring/application/ports/student-longitudinal-declaration-trust-ports.js';
import { studentLongitudinalDeclarationRequiredPurposes } from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/build-student-longitudinal-declaration.js';

const ids = {
  account: '550e8400-e29b-41d4-a716-446655440001',
  enrollment: '550e8400-e29b-41d4-a716-446655440002',
  earlySession: '550e8400-e29b-41d4-a716-446655440003',
  laterSession: '550e8400-e29b-41d4-a716-446655440004',
  earlyConversation: '550e8400-e29b-41d4-a716-446655440005',
  laterConversation: '550e8400-e29b-41d4-a716-446655440006',
  earlyMessage: '550e8400-e29b-41d4-a716-446655440007',
  laterMessage: '550e8400-e29b-41d4-a716-446655440008',
  comparisonMessage: '550e8400-e29b-41d4-a716-446655440009',
  otherMessage: '550e8400-e29b-41d4-a716-446655440010',
} as const;

const noticeVersionIds: Record<(typeof studentLongitudinalDeclarationRequiredPurposes)[number], string> = {
  longitudinal_monitoring: '550e8400-e29b-41d4-a716-446655440011',
  ai_conversation_processing: '550e8400-e29b-41d4-a716-446655440012',
  structured_signal_extraction: '550e8400-e29b-41d4-a716-446655440013',
};

function syntheticResult(input: {
  id: string;
  conversationId: string;
  messageId: string;
  generatedAt: string;
  observationText: string;
}): ConversationSignalResult {
  const extraction: ConversationSignalExtraction = {
    schemaVersion: '1.0',
    observations: [{
      evidence: 'reported',
      manifestation: { status: 'reported', value: input.observationText },
      possibleDimensions: [],
      duration: { status: 'not_reported' },
      frequency: { status: 'not_reported' },
      intensity: { status: 'not_reported' },
      contexts: [],
      functionalImpact: { status: 'not_reported' },
      sourceMessageIds: [input.messageId],
    }],
    missingInformation: [{ field: 'duration', reason: 'not_reported' }],
    clarificationQuestions: ['¿Quieres agregar algún detalle?'],
  };
  const result = createConversationSignalResult({
    id: input.id,
    conversationId: input.conversationId,
    accountId: ids.account,
    generatedAt: new Date(input.generatedAt),
    extractorVersion: 'synthetic-demo-1',
    sourceMessageIds: [input.messageId],
    extraction,
  });
  return {
    ...result,
    preliminaryGuidance: createPreliminaryConversationGuidance(result),
  } as ConversationSignalResult;
}

const results = [
  syntheticResult({
    id: '550e8400-e29b-41d4-a716-446655440014',
    conversationId: ids.earlyConversation,
    messageId: ids.earlyMessage,
    generatedAt: '2026-01-10T10:00:00.000Z',
    observationText: 'Relato completamente ficticio del periodo inicial.',
  }),
  syntheticResult({
    id: '550e8400-e29b-41d4-a716-446655440015',
    conversationId: ids.laterConversation,
    messageId: ids.laterMessage,
    generatedAt: '2026-02-10T10:00:00.000Z',
    observationText: 'Relato completamente ficticio del periodo posterior.',
  }),
];

const sourceAuthorizations: SourceConsentProvenance[] = studentLongitudinalDeclarationRequiredPurposes.map(purpose => ({
  purpose,
  noticeVersionId: noticeVersionIds[purpose],
}));

function declarationBuilder(options: {
  readonly missingPurpose?: (typeof studentLongitudinalDeclarationRequiredPurposes)[number];
  readonly unavailableResultId?: string;
  readonly contextOverride?: (typeof ids)[keyof typeof ids];
} = {}) {
  const contexts: OwnedMonitoringConversationContextReader = {
    findForOwner: async (accountId, sessionId, conversationId) => {
      const known = [
        { sessionId: ids.earlySession, conversationId: ids.earlyConversation },
        { sessionId: ids.laterSession, conversationId: ids.laterConversation },
      ].find(item => item.sessionId === sessionId && item.conversationId === conversationId);
      if (!known || accountId !== ids.account) return null;
      return {
        accountId,
        enrollmentId: ids.enrollment,
        sessionId: known.sessionId,
        conversationId: options.contextOverride ?? known.conversationId,
        enrollmentStatus: 'active',
        sessionStatus: 'in_progress',
        conversationStatus: 'active',
        associationVerified: true,
      };
    },
  };
  const currentGrants = {
    getCurrentGrant: async (accountId: string, purpose: (typeof studentLongitudinalDeclarationRequiredPurposes)[number]): Promise<CurrentConsentGrant | null> => {
      if (accountId !== ids.account || purpose === options.missingPurpose) return null;
      return { purpose, noticeVersionId: noticeVersionIds[purpose] };
    },
  };
  const exactResults = {
    resolveForOwner: async ({ accountId, resultId, conversationId }: { accountId: string; resultId: string; conversationId: string }) => {
      if (accountId !== ids.account || resultId === options.unavailableResultId) return null;
      const payload = results.find(item => item.id === resultId && item.conversationId === conversationId);
      return payload ? { payload, sourceAuthorizations } : null;
    },
  };
  return new BuildStudentLongitudinalDeclaration(
    contexts,
    currentGrants,
    { allowsDeclaration: async () => true },
    exactResults,
    () => new Date('2026-02-10T10:05:00.000Z'),
  );
}

function referenceAt(result: ConversationSignalResult) {
  return createConversationResultObservationReference(result, 0);
}

function snapshot(
  result: ConversationSignalResult,
  sessionId: string,
  observedAt: string,
  temporalContext: LongitudinalConversationSnapshot['temporalContext'],
): LongitudinalConversationSnapshot {
  const sourceMessageId = result.sourceMessageIds[0];
  if (!sourceMessageId) throw new Error('Synthetic result must have one source message');
  return {
    contractVersion: '1.1',
    sessionId,
    conversationId: result.conversationId,
    observedAt,
    selectedMessageIds: temporalContext ? [sourceMessageId, ...temporalContext.comparisonMessageIds] : [sourceMessageId],
    reportedObservations: result.summary.reportedFacts.map(fact => ({
      observationIndex: fact.observationIndex,
      evidenceStatus: 'reported',
      field: fact.field,
      ...(fact.contextDomain ? { contextDomain: fact.contextDomain } : {}),
      text: fact.value,
      sourceMessageIds: fact.sourceMessageIds,
    })),
    temporalContext,
  } as LongitudinalConversationSnapshot;
}

describe('synthetic longitudinal conversation demo composition', () => {
  it('composes two ephemeral results, voluntary declarations, and the existing descriptive comparator', async () => {
    const earlyResult = results[0]!;
    const laterResult = results[1]!;
    const builder = declarationBuilder();
    const earlyDeclaration = await builder.execute(ids.account, ids.earlySession, {
      referencedObservation: referenceAt(earlyResult),
      responseType: 'continues',
    });
    const laterDeclaration = await builder.execute(ids.account, ids.laterSession, {
      referencedObservation: referenceAt(laterResult),
      responseType: 'changed',
      optionalDescription: 'Descripción voluntaria sintética del cambio.',
    });

    const earlierSnapshot = snapshot(earlyResult, ids.earlySession, '2026-01-10T10:00:00.000Z', null);
    const laterSnapshot = snapshot(laterResult, ids.laterSession, '2026-02-10T10:00:00.000Z', {
      explicitlyReported: true,
      relation: 'change',
      earlierSessionId: ids.earlySession,
      earlierConversationId: ids.earlyConversation,
      laterSessionId: ids.laterSession,
      laterConversationId: ids.laterConversation,
      earlierObservationIndex: 0,
      laterObservationIndex: 0,
      comparisonMessageIds: [ids.comparisonMessage],
    });
    const comparison = compareLongitudinalConversationSnapshots(earlierSnapshot, laterSnapshot);

    expect(earlyDeclaration).toMatchObject({ responseType: 'continues', source: 'student_self_report', confirmationStatus: 'student_confirmed' });
    expect(laterDeclaration).toMatchObject({ responseType: 'changed', source: 'student_self_report', confirmationStatus: 'student_confirmed' });
    expect(comparison).toMatchObject({
      comparisonStatus: 'explicit_change_reported',
      sessionIds: [ids.earlySession, ids.laterSession],
      conversationIds: [ids.earlyConversation, ids.laterConversation],
    });
    expect(JSON.stringify(comparison)).not.toContain('Relato completamente ficticio');
    expect(comparison).not.toHaveProperty('score');
    expect(comparison).not.toHaveProperty('diagnosis');
    // The declaration contract records one student's response; it is not itself a comparator input.
    expect(laterDeclaration).not.toHaveProperty('comparisonStatus');
  });

  it('fails closed for missing consent, a crossed evidence reference, and an unavailable ephemeral result', async () => {
    const earlyResult = results[0]!;
    const missingConsent = declarationBuilder({ missingPurpose: 'longitudinal_monitoring' });
    await expect(missingConsent.execute(ids.account, ids.earlySession, {
      referencedObservation: referenceAt(earlyResult), responseType: 'continues',
    })).rejects.toMatchObject({ code: 'consent_required' });

    const crossedReference = { ...referenceAt(earlyResult), sourceMessageIds: [ids.otherMessage] };
    const validBuilder = declarationBuilder();
    await expect(validBuilder.execute(ids.account, ids.earlySession, {
      referencedObservation: crossedReference, responseType: 'continues',
    })).rejects.toMatchObject({ code: 'reference_invalid' });

    const lostResult = declarationBuilder({ unavailableResultId: earlyResult.id });
    await expect(lostResult.execute(ids.account, ids.earlySession, {
      referencedObservation: referenceAt(earlyResult), responseType: 'continues',
    })).rejects.toMatchObject({ code: 'result_unavailable' });
  });

  it('does not derive a temporal relation from changed, continues, unsure, or refusal responses', async () => {
    const laterResult = results[1]!;
    const earlier = snapshot(results[0]!, ids.earlySession, '2026-01-10T10:00:00.000Z', null);
    const laterWithoutLink = snapshot(laterResult, ids.laterSession, '2026-02-10T10:00:00.000Z', null);
    for (const responseType of ['changed', 'continues', 'unsure', 'prefer_not_to_answer'] as const) {
      const declaration = await declarationBuilder().execute(ids.account, ids.laterSession, {
        referencedObservation: referenceAt(laterResult),
        responseType,
        ...(responseType === 'changed' ? { optionalDescription: 'Descripción ficticia.' } : {}),
      });
      expect(declaration.responseType).toBe(responseType);
      const comparison = compareLongitudinalConversationSnapshots(earlier, laterWithoutLink);
      expect(comparison).toMatchObject({
        comparisonStatus: 'insufficient_information',
        informationGaps: ['no_explicit_temporal_link'],
      });
    }

    expect(compareLongitudinalConversationSnapshots(earlier, {
      ...laterWithoutLink,
      observedAt: earlier.observedAt,
      temporalContext: null,
    }).informationGaps).toEqual(['period_order_is_not_verifiable']);
    const earlierWithoutObservation = {
      ...earlier,
      reportedObservations: [],
    };
    expect(compareLongitudinalConversationSnapshots(earlierWithoutObservation, laterWithoutLink).informationGaps)
      .toEqual(['only_one_period_has_reported_observations']);
  });
});
