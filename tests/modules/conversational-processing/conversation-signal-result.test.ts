import { describe, expect, it } from 'vitest';
import { createConversationSignalResult, conversationSignalResultSchema } from '../../../src/modules/conversational-processing/domain/model/conversation-signal-result.js';
import type { ConversationSignalExtraction } from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const messageId = '550e8400-e29b-41d4-a716-446655440010';
const resultId = '550e8400-e29b-41d4-a716-446655440099';
const generatedAt = new Date('2026-11-21T12:00:00.000Z');

const extraction: ConversationSignalExtraction = {
  schemaVersion: '1.0',
  observations: [{
    evidence: 'reported',
    manifestation: { status: 'reported', value: 'Refiere cansancio durante los exámenes.' },
    possibleDimensions: ['stress'],
    duration: { status: 'not_reported' },
    frequency: { status: 'not_assessed' },
    intensity: { status: 'not_assessed' },
    contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Semana de exámenes.' } }],
    functionalImpact: { status: 'ambiguous', note: null },
    sourceMessageIds: [messageId],
  }],
  missingInformation: [{ field: 'duration', reason: 'not_reported' }],
  clarificationQuestions: ['¿Desde cuándo ocurre?'],
};

function build(value = extraction) {
  return createConversationSignalResult({
    id: resultId,
    accountId,
    conversationId,
    generatedAt,
    extractorVersion: '1.0.0',
    sourceMessageIds: [messageId],
    extraction: value,
  });
}

describe('ephemeral conversation signal result', () => {
  it('creates a versioned result with deterministic reported facts and internal owner scope', () => {
    const result = build();
    expect(conversationSignalResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      id: resultId,
      accountId,
      conversationId,
      generatedAt: generatedAt.toISOString(),
      schemaVersion: '1.0',
      extractorVersion: '1.0.0',
      sourceMessageIds: [messageId],
      summary: {
        descriptiveStatus: 'observations_available',
        reportedFacts: [
          { observationIndex: 0, field: 'manifestation', value: 'Refiere cansancio durante los exámenes.', sourceMessageIds: [messageId] },
          { observationIndex: 0, field: 'context', contextDomain: 'academic', value: 'Semana de exámenes.', sourceMessageIds: [messageId] },
        ],
        emptyObservationsMeaning: 'not_evidence_of_absence',
      },
      missingInformation: [{ field: 'duration', reason: 'not_reported' }],
      clarificationQuestions: ['¿Desde cuándo ocurre?'],
    });
    expect(Object.keys(result)).not.toContain('diagnosis');
    expect(Object.keys(result.summary)).not.toContain('severity');
  });

  it('represents empty observations as no observations, never as evidence of absence', () => {
    const result = build({
      schemaVersion: '1.0', observations: [],
      missingInformation: [{ field: 'manifestation', reason: 'not_assessed' }],
      clarificationQuestions: ['¿Qué te gustaría compartir?'],
    });
    expect(result.summary.descriptiveStatus).toBe('no_observations');
    expect(result.summary.emptyObservationsMeaning).toBe('not_evidence_of_absence');
    expect(result.summary.reportedFacts).toEqual([]);
  });

  it('rejects evidence references outside the selected source messages', () => {
    expect(() => createConversationSignalResult({
      id: resultId,
      accountId,
      conversationId,
      generatedAt,
      extractorVersion: '1.0.0',
      sourceMessageIds: [messageId],
      extraction: {
        ...extraction,
        observations: [{ ...extraction.observations[0]!, sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440011'] }],
      },
    })).toThrow('invalid source reference');
  });

  it('rejects unmodeled clinical conclusions or extra result fields', () => {
    const valid = build();
    expect(conversationSignalResultSchema.safeParse({ ...valid, diagnosis: 'depression' }).success).toBe(false);
    expect(conversationSignalResultSchema.safeParse({
      ...valid,
      observations: [{ ...valid.observations[0], diagnosis: 'depression' }],
    }).success).toBe(false);
  });
});
