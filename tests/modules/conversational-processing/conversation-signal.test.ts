import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  conversationSignalExtractionSchema,
  signalSchemaVersion,
  type ConversationSignalExtraction,
} from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';
import {
  ConversationSignalExtractionError,
  extractConversationSignalsInputSchema,
  parseConversationSignalExtraction,
  parseExtractConversationSignalsInput,
} from '../../../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';

const sourceMessageId = '550e8400-e29b-41d4-a716-446655440000';

function reportedObservation(overrides: Record<string, unknown> = {}) {
  return {
    evidence: 'reported',
    manifestation: { status: 'reported', value: 'Me siento sobrepasado por los exámenes.' },
    possibleDimensions: ['stress', 'anxiety'],
    duration: { status: 'reported', value: 'Desde hace unas tres semanas.' },
    frequency: { status: 'not_reported' },
    intensity: { status: 'not_assessed' },
    contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Se acumularon entregas y exámenes.' } }],
    functionalImpact: { status: 'ambiguous', note: 'No queda claro si afecta el sueño o las actividades diarias.' },
    sourceMessageIds: [sourceMessageId],
    ...overrides,
  };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: signalSchemaVersion,
    observations: [reportedObservation()],
    missingInformation: [{ field: 'frequency', reason: 'not_reported' }],
    clarificationQuestions: ['¿Con qué frecuencia te sucede?'],
    ...overrides,
  };
}

describe('Conversational processing domain contract', () => {
  it('supports multiple tentative dimensions in one reported observation', () => {
    const parsed = conversationSignalExtractionSchema.parse(extraction()) as ConversationSignalExtraction;
    expect(parsed.observations[0]?.possibleDimensions).toEqual(['stress', 'anxiety']);
    expect(parsed.observations[0]?.sourceMessageIds).toEqual([sourceMessageId]);
  });

  it('represents insufficient information explicitly without defaulting to absent', () => {
    const observation = reportedObservation({
      evidence: 'not_assessed',
      manifestation: { status: 'not_assessed' },
      possibleDimensions: [],
      duration: { status: 'not_assessed' },
      frequency: { status: 'not_assessed' },
      intensity: { status: 'not_assessed' },
      contexts: [],
      functionalImpact: { status: 'not_assessed' },
    });
    const parsed = conversationSignalExtractionSchema.parse(extraction({
      observations: [observation],
      missingInformation: [{ field: 'manifestation', reason: 'not_assessed' }, { field: 'duration', reason: 'not_assessed' }],
      clarificationQuestions: ['¿Qué has notado en tu día a día?'],
    }));
    expect(parsed.observations[0]?.manifestation).toEqual({ status: 'not_assessed' });
    expect(parsed.observations[0]?.possibleDimensions).toEqual([]);
  });

  it('accepts explicitly reported duration and academic context', () => {
    const parsed = conversationSignalExtractionSchema.parse(extraction()) as ConversationSignalExtraction;
    expect(parsed.observations[0]?.duration).toEqual({ status: 'reported', value: 'Desde hace unas tres semanas.' });
    expect(parsed.observations[0]?.contexts[0]).toEqual({
      domain: 'academic', evidence: { status: 'reported', value: 'Se acumularon entregas y exámenes.' },
    });
  });

  it('preserves ambiguous evidence and does not force a conclusion', () => {
    const parsed = conversationSignalExtractionSchema.parse(extraction({ observations: [reportedObservation({
      evidence: 'ambiguous',
      manifestation: { status: 'ambiguous', note: 'El estudiante menciona cansancio, pero no queda claro cómo se presenta.' },
      possibleDimensions: [],
    })] })) as ConversationSignalExtraction;
    expect(parsed.observations[0]?.evidence).toBe('ambiguous');
    expect(parsed.observations[0]?.possibleDimensions).toEqual([]);
  });

  it('rejects unknown properties at every object level', () => {
    expect(conversationSignalExtractionSchema.safeParse(extraction({ diagnosis: 'depression' })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ score: 8 })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ manifestation: { status: 'reported', value: 'Cansancio.', confidence: 0.9 } })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Exámenes.', riskLevel: 'low' } }] })] })).success).toBe(false);
  });

  it('rejects malformed enums, inconsistent evidence, duplicate references and malformed data', () => {
    expect(conversationSignalExtractionSchema.safeParse(extraction({ schemaVersion: '2.0' })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ evidence: 'absent' })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ evidence: 'not_reported' })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ sourceMessageIds: [sourceMessageId, sourceMessageId] })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(null).success).toBe(false);
  });

  it('enforces text, observation, question, and message-reference limits', () => {
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: Array.from({ length: 21 }, () => reportedObservation()) })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ clarificationQuestions: Array.from({ length: 9 }, () => '¿Qué pasó?') })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ manifestation: { status: 'reported', value: 'x'.repeat(1001) } })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ sourceMessageIds: Array.from({ length: 11 }, () => randomUUID()) })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ clarificationQuestions: ['x'.repeat(301)] })).success).toBe(false);
  });

  it('rejects conclusive diagnostic text and unmodeled scores or risk classifications', () => {
    expect(conversationSignalExtractionSchema.safeParse(extraction({ observations: [reportedObservation({ manifestation: { status: 'reported', value: 'El diagnóstico es depresión.' } })] })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ score: 12 })).success).toBe(false);
    expect(conversationSignalExtractionSchema.safeParse(extraction({ riskLevel: 'low' })).success).toBe(false);
  });

  it('keeps not_reported distinct from absence and defines no safety outcome', () => {
    const parsed = conversationSignalExtractionSchema.parse(extraction({ observations: [reportedObservation({
      manifestation: { status: 'reported', value: 'El estudiante refiere cansancio.' },
      frequency: { status: 'not_reported' },
    })] }));
    expect(parsed.observations[0]?.frequency).toEqual({ status: 'not_reported' });
    expect(parsed).not.toHaveProperty('diagnosis');
    expect(parsed).not.toHaveProperty('score');
    expect(parsed).not.toHaveProperty('riskLevel');
    expect(parsed.observations[0]).not.toHaveProperty('priority');
  });

  it('validates minimal authorized input and maps invalid data to provider-neutral errors', () => {
    const input = { messages: [{ messageId: sourceMessageId, role: 'user', content: 'Me cuesta concentrarme.' }] };
    expect(extractConversationSignalsInputSchema.parse(input)).toEqual(input);
    expect(extractConversationSignalsInputSchema.safeParse({ ...input, accountId: '550e8400-e29b-41d4-a716-446655440001' }).success).toBe(false);
    expect(extractConversationSignalsInputSchema.safeParse({ messages: Array.from({ length: 21 }, () => input.messages[0]) }).success).toBe(false);
    expect(() => parseExtractConversationSignalsInput({ messages: [] })).toThrowError(ConversationSignalExtractionError);
    expect(() => parseConversationSignalExtraction({ schemaVersion: '1.0', observations: [], missingInformation: [], clarificationQuestions: [], providerPayload: {} })).toThrowError(ConversationSignalExtractionError);
  });
});
