import { describe, expect, it } from 'vitest';
import {
  parseStudentLongitudinalDeclaration,
  studentLongitudinalDeclarationContractVersion,
  studentLongitudinalDeclarationSchema,
} from '../../../src/modules/longitudinal-monitoring/domain/model/student-longitudinal-declaration.js';

const base = {
  contractVersion: studentLongitudinalDeclarationContractVersion,
  sessionId: '550e8400-e29b-41d4-a716-446655440001',
  conversationId: '550e8400-e29b-41d4-a716-446655440002',
  referencedObservation: {
    contractVersion: '1.0',
    resultId: '550e8400-e29b-41d4-a716-446655440003',
    conversationId: '550e8400-e29b-41d4-a716-446655440002',
    observationIndex: 0,
    sourceObservationIndex: 0,
    field: 'manifestation',
    sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440004'],
  },
  source: 'student_self_report',
  confirmationStatus: 'student_confirmed',
  createdAt: '2026-11-22T10:30:00.000Z',
};

describe('student longitudinal declaration contract', () => {
  it('accepts a voluntary continues response', () => {
    expect(parseStudentLongitudinalDeclaration({ ...base, responseType: 'continues' }).responseType).toBe('continues');
  });

  it('accepts changed with a short optional description', () => {
    const declaration = parseStudentLongitudinalDeclaration({
      ...base,
      responseType: 'changed',
      optionalDescription: 'Ejemplo ficticio: me he organizado de otra manera.',
    });
    expect(declaration).toMatchObject({ responseType: 'changed', source: 'student_self_report' });
  });

  it('keeps optionalDescription optional for continues and changed', () => {
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'changed' }).success).toBe(true);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'continues' }).success).toBe(true);
  });

  it('accepts unsure without treating it as change or continuity', () => {
    const declaration = parseStudentLongitudinalDeclaration({ ...base, responseType: 'unsure' });
    expect(declaration.responseType).toBe('unsure');
    expect(declaration).not.toHaveProperty('comparisonStatus');
  });

  it('accepts prefer_not_to_answer without treating it as evidence', () => {
    const declaration = parseStudentLongitudinalDeclaration({ ...base, responseType: 'prefer_not_to_answer' });
    expect(declaration.responseType).toBe('prefer_not_to_answer');
  });

  it('rejects descriptions on unsure or prefer_not_to_answer and rejects blank descriptions', () => {
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'unsure', optionalDescription: 'Ficticio' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'prefer_not_to_answer', optionalDescription: 'Ficticio' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'changed', optionalDescription: '   ' }).success).toBe(false);
  });

  it('rejects malformed IDs, response types, versions and timestamps', () => {
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, sessionId: 'not-a-uuid', responseType: 'changed' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'improved' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, contractVersion: '2.0', responseType: 'changed' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({
      ...base,
      referencedObservation: { ...base.referencedObservation, observationIndex: -1 },
      responseType: 'changed',
    }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, createdAt: 'yesterday', responseType: 'changed' }).success).toBe(false);
  });

  it('rejects a referenced result from another conversation', () => {
    expect(studentLongitudinalDeclarationSchema.safeParse({
      ...base,
      referencedObservation: { ...base.referencedObservation, conversationId: '550e8400-e29b-41d4-a716-446655440099' },
      responseType: 'changed',
    }).success).toBe(false);
  });

  it('rejects source or confirmation values not attributable to an explicit student submission', () => {
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, source: 'ai_generated', responseType: 'changed' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, confirmationStatus: 'confirmed_by_ai', responseType: 'changed' }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, confirmationStatus: 'unconfirmed', responseType: 'changed' }).success).toBe(false);
  });

  it('rejects extra fields including ownership and clinical scoring fields', () => {
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'changed', accountId: base.sessionId }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'changed', score: 12 }).success).toBe(false);
    expect(studentLongitudinalDeclarationSchema.safeParse({ ...base, responseType: 'changed', diagnosis: 'example' }).success).toBe(false);
  });

  it('parses deterministically and does not add fields', () => {
    const value = { ...base, responseType: 'changed', optionalDescription: 'Dato ficticio.' };
    const first = parseStudentLongitudinalDeclaration(value);
    const second = parseStudentLongitudinalDeclaration(value);
    expect(first).toEqual(second);
    expect(Object.keys(first).sort()).toEqual([
      'confirmationStatus', 'contractVersion', 'conversationId', 'createdAt', 'optionalDescription',
      'referencedObservation', 'responseType', 'sessionId', 'source',
    ]);
  });
});
