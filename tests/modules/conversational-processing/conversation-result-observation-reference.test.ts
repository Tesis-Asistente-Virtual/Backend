import { describe, expect, it } from 'vitest';
import { createConversationSignalResult } from '../../../src/modules/conversational-processing/domain/model/conversation-signal-result.js';
import {
  ConversationResultObservationReferenceError,
  createConversationResultObservationReference,
  resolveConversationResultObservationReference,
} from '../../../src/modules/conversational-processing/domain/model/conversation-result-observation-reference.js';
import { createPreliminaryConversationGuidance } from '../../../src/modules/conversational-processing/domain/model/preliminary-conversation-guidance.js';
import type { ConversationSignalExtraction } from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';
import { conversationResultObservationReferenceSchema } from '../../../src/shared/domain/conversation-result-observation-reference.js';

const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const resultId = '550e8400-e29b-41d4-a716-446655440002';
const messageId = '550e8400-e29b-41d4-a716-446655440003';
const otherMessageId = '550e8400-e29b-41d4-a716-446655440004';
const accountId = '550e8400-e29b-41d4-a716-446655440005';

const extraction: ConversationSignalExtraction = {
  schemaVersion: '1.0',
  observations: [{
    evidence: 'reported',
    manifestation: { status: 'reported', value: 'Reporte completamente ficticio de ejemplo.' },
    possibleDimensions: [],
    duration: { status: 'not_reported' },
    frequency: { status: 'not_assessed' },
    intensity: { status: 'not_assessed' },
    contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Contexto académico ficticio.' } }],
    functionalImpact: { status: 'not_assessed' },
    sourceMessageIds: [messageId],
  }],
  missingInformation: [],
  clarificationQuestions: [],
};

function resultPayload(options: { id?: string; conversationId?: string; extraction?: ConversationSignalExtraction } = {}) {
  const result = createConversationSignalResult({
    id: options.id ?? resultId,
    accountId,
    conversationId: options.conversationId ?? conversationId,
    generatedAt: new Date('2026-11-23T12:00:00.000Z'),
    extractorVersion: '1.0.0',
    sourceMessageIds: options.extraction?.observations.length === 0 ? [messageId] : [messageId],
    extraction: options.extraction ?? extraction,
  });
  const { accountId: _privateOwner, ...publicResult } = result;
  return { ...publicResult, status: 'completed' as const, preliminaryGuidance: createPreliminaryConversationGuidance(result) };
}

describe('ephemeral conversation result observation reference', () => {
  it('builds and resolves a reference within its exact result and guidance observation', () => {
    const result = resultPayload();
    const reference = createConversationResultObservationReference(result, 0);

    expect(conversationResultObservationReferenceSchema.safeParse(reference).success).toBe(true);
    expect(reference).toMatchObject({
      contractVersion: '1.0', resultId, conversationId, observationIndex: 0,
      sourceObservationIndex: 0, field: 'manifestation', sourceMessageIds: [messageId],
    });
    expect(resolveConversationResultObservationReference(reference, result)).toEqual(result.preliminaryGuidance.observations[0]);
  });

  it('is deterministic for the same result instance and observation index', () => {
    const result = resultPayload();
    expect(createConversationResultObservationReference(result, 0)).toEqual(createConversationResultObservationReference(result, 0));
  });

  it('distinguishes guidance positions while retaining the source extractor observation index', () => {
    const result = resultPayload();
    const reference = createConversationResultObservationReference(result, 1);
    expect(reference).toMatchObject({
      observationIndex: 1,
      sourceObservationIndex: 0,
      field: 'context',
      contextDomain: 'academic',
      sourceMessageIds: [messageId],
    });
    expect(resolveConversationResultObservationReference(reference, result)).toEqual(result.preliminaryGuidance.observations[1]);
  });

  it('rejects an index outside the result observations', () => {
    expect(() => createConversationResultObservationReference(resultPayload(), 99)).toThrowError(
      expect.objectContaining({ code: 'observation_not_found' }),
    );
  });

  it('rejects a result from another conversation', () => {
    const reference = createConversationResultObservationReference(resultPayload(), 0);
    const other = resultPayload({ conversationId: '550e8400-e29b-41d4-a716-446655440006' });
    expect(() => resolveConversationResultObservationReference(reference, other)).toThrowError(
      expect.objectContaining({ code: 'result_mismatch' }),
    );
  });

  it('rejects a different result execution even when the conversation and observation index match', () => {
    const reference = createConversationResultObservationReference(resultPayload(), 0);
    const rerun = resultPayload({ id: '550e8400-e29b-41d4-a716-446655440007' });
    expect(() => resolveConversationResultObservationReference(reference, rerun)).toThrowError(
      expect.objectContaining({ code: 'result_mismatch' }),
    );
  });

  it('rejects message references crossed to another source message', () => {
    const reference = createConversationResultObservationReference(resultPayload(), 0);
    expect(() => resolveConversationResultObservationReference({ ...reference, sourceMessageIds: [otherMessageId] }, resultPayload())).toThrowError(
      expect.objectContaining({ code: 'observation_mismatch' }),
    );
  });

  it('rejects empty-result observations instead of inventing a reference', () => {
    const emptyResult = resultPayload({ extraction: {
      schemaVersion: '1.0', observations: [], missingInformation: [], clarificationQuestions: [],
    } });
    expect(() => createConversationResultObservationReference(emptyResult, 0)).toThrowError(
      expect.objectContaining({ code: 'observation_not_found' }),
    );
  });

  it('rejects a guidance index that is inconsistent with the source extraction observation', () => {
    const result = resultPayload();
    const inconsistent = {
      ...result,
      preliminaryGuidance: {
        ...result.preliminaryGuidance,
        observations: result.preliminaryGuidance.observations.map((observation, index) => index === 0
          ? { ...observation, sourceObservationIndex: 99 }
          : observation),
      },
    };
    expect(() => createConversationResultObservationReference(inconsistent, 0)).toThrowError(
      expect.objectContaining({ code: 'observation_mismatch' }),
    );
  });

  it('fails explicitly after the ephemeral result payload is lost', () => {
    const reference = createConversationResultObservationReference(resultPayload(), 0);
    expect(() => resolveConversationResultObservationReference(reference, null)).toThrowError(
      expect.objectContaining({ code: 'result_unavailable' }),
    );
  });

  it('rejects a structurally invalid reference', () => {
    const reference = createConversationResultObservationReference(resultPayload(), 0);
    expect(() => resolveConversationResultObservationReference({ ...reference, observationIndex: -1 }, resultPayload())).toThrow();
  });
});
