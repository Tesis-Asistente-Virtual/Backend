import { describe, expect, it } from 'vitest';
import { createConversationSignalResult } from '../../../src/modules/conversational-processing/domain/model/conversation-signal-result.js';
import {
  createPreliminaryConversationGuidance,
  preliminaryConversationGuidanceSchema,
} from '../../../src/modules/conversational-processing/domain/model/preliminary-conversation-guidance.js';
import type { ConversationSignalExtraction } from '../../../src/modules/conversational-processing/domain/model/signal-observation.js';

const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const messageId = '550e8400-e29b-41d4-a716-446655440010';
const otherConversationId = '550e8400-e29b-41d4-a716-446655440002';
const otherMessageId = '550e8400-e29b-41d4-a716-446655440011';
const accountId = '550e8400-e29b-41d4-a716-446655440000';

function resultFor(selectedConversationId = conversationId, selectedMessageId = messageId, extraction?: ConversationSignalExtraction) {
  return createConversationSignalResult({
    id: '550e8400-e29b-41d4-a716-446655440099',
    conversationId: selectedConversationId,
    accountId,
    generatedAt: new Date('2026-11-22T12:00:00.000Z'),
    extractorVersion: '1.0.0',
    sourceMessageIds: [selectedMessageId],
    extraction: extraction ?? {
      schemaVersion: '1.0',
      observations: [{
        evidence: 'reported',
        manifestation: { status: 'reported', value: 'El estudiante expresó cansancio durante una semana ficticia de exámenes.' },
        possibleDimensions: ['stress'],
        duration: { status: 'not_reported' },
        frequency: { status: 'not_assessed' },
        intensity: { status: 'not_assessed' },
        contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Semana de exámenes ficticia.' } }],
        functionalImpact: { status: 'not_assessed' },
        sourceMessageIds: [selectedMessageId],
      }],
      missingInformation: [
        { field: 'duration', reason: 'not_reported' },
        { field: 'frequency', reason: 'not_assessed' },
      ],
      clarificationQuestions: ['¿Desde cuándo notas esta situación?'],
    },
  });
}

describe('preliminary conversational guidance contract', () => {
  it('maps reported observations, gaps, questions, and source references without rewriting evidence', () => {
    const source = resultFor();
    const guidance = createPreliminaryConversationGuidance(source);

    expect(preliminaryConversationGuidanceSchema.safeParse(guidance).success).toBe(true);
    expect(guidance).toMatchObject({
      contractVersion: '1.0',
      conversationId,
      sourceMessageIds: [messageId],
      observations: [
        {
          sourceObservationIndex: 0,
          field: 'manifestation',
          text: 'El estudiante expresó cansancio durante una semana ficticia de exámenes.',
          sourceMessageIds: [messageId],
        },
        {
          sourceObservationIndex: 0,
          field: 'context',
          contextDomain: 'academic',
          text: 'Semana de exámenes ficticia.',
          sourceMessageIds: [messageId],
        },
      ],
      informationGaps: [
        { field: 'duration', reason: 'not_reported' },
        { field: 'frequency', reason: 'not_assessed' },
      ],
      suggestedFollowUpQuestions: ['¿Desde cuándo notas esta situación?'],
    });
    expect(guidance.observations.find(item => item.field === 'manifestation')).not.toHaveProperty('contextDomain');
    expect(guidance.generalGuidance).toContain('solo si así lo deseas');
    expect(guidance.limitations.join(' ')).toMatch(/no calcula puntuaciones|no evalúa seguridad/);
  });

  it('exposes separate typed sections so a frontend need not infer categories from prose', () => {
    const guidance = createPreliminaryConversationGuidance(resultFor());

    expect(Object.keys(guidance).sort()).toEqual([
      'contractVersion', 'conversationId', 'generalGuidance', 'informationGaps',
      'limitations', 'observations', 'sourceMessageIds', 'suggestedFollowUpQuestions',
    ]);
    expect(guidance.observations.every(item => item.field && item.text && item.sourceMessageIds.length > 0)).toBe(true);
    expect(guidance.informationGaps[0]).toEqual({ field: 'duration', reason: 'not_reported' });
    expect(guidance.suggestedFollowUpQuestions).toEqual(['¿Desde cuándo notas esta situación?']);
    expect(typeof guidance.generalGuidance).toBe('string');
    expect(guidance.limitations).toHaveLength(4);
  });

  it('represents insufficient information without inventing an observation or claiming absence', () => {
    const guidance = createPreliminaryConversationGuidance(resultFor(conversationId, messageId, {
      schemaVersion: '1.0',
      observations: [],
      missingInformation: [{ field: 'manifestation', reason: 'not_assessed' }],
      clarificationQuestions: [],
    }));

    expect(guidance.observations).toEqual([]);
    expect(guidance.informationGaps).toEqual([{ field: 'manifestation', reason: 'not_assessed' }]);
    expect(guidance.suggestedFollowUpQuestions).toEqual([]);
    expect(guidance.limitations.join(' ')).toMatch(/no demuestra ausencia/);
  });

  it('keeps each result isolated to its conversation and selected messages', () => {
    const first = createPreliminaryConversationGuidance(resultFor());
    const second = createPreliminaryConversationGuidance(resultFor(otherConversationId, otherMessageId));

    expect(first.conversationId).toBe(conversationId);
    expect(first.sourceMessageIds).toEqual([messageId]);
    expect(second.conversationId).toBe(otherConversationId);
    expect(second.sourceMessageIds).toEqual([otherMessageId]);
    expect(second.observations.every(item => item.sourceMessageIds.every(id => id === otherMessageId))).toBe(true);
  });

  it('rejects invalid or foreign evidence references and unexpected clinical or score fields', () => {
    const valid = createPreliminaryConversationGuidance(resultFor());
    expect(preliminaryConversationGuidanceSchema.safeParse({
      ...valid,
      observations: [{ ...valid.observations[0]!, sourceMessageIds: [otherMessageId] }],
    }).success).toBe(false);
    expect(preliminaryConversationGuidanceSchema.safeParse({ ...valid, diagnosis: 'depression' }).success).toBe(false);
    expect(preliminaryConversationGuidanceSchema.safeParse({ ...valid, dass21Scores: { depression: 10 } }).success).toBe(false);
    expect(preliminaryConversationGuidanceSchema.safeParse({
      ...valid,
      observations: [{ ...valid.observations[0]!, confidence: 0.9 }],
    }).success).toBe(false);
  });
});
