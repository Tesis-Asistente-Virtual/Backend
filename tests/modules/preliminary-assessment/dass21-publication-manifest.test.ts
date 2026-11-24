import { describe, expect, it } from 'vitest';
import {
  dass21PublicationManifestSchema,
  hashDass21QuestionSnapshot,
  toDass21QuestionSnapshot,
  toDass21RuntimeAuthorization,
} from '../../../src/modules/preliminary-assessment/application/internal/services/dass21-publication-manifest.js';
import { DASS21_INSTRUMENT_ID } from '../../../src/modules/preliminary-assessment/application/internal/services/dass21-version-authorization-registry.js';

const baseDecision = {
  evidenceReference: 'SYNTHETIC TEST ONLY; not approval evidence',
  scope: 'unit-test only',
  responsible: 'synthetic fixture',
  responsibleRole: 'automated test',
  authorizedAt: '2025-01-01T00:00:00.000Z',
  documents: [{ reference: 'synthetic fixture', file: 'fixture.txt', sha256: 'a'.repeat(64) }],
};

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0', targetDatabase: 'tesis_test_db',
    operator: { name: 'synthetic test operator', role: 'automated test' },
    instrument: {
      instrumentCode: 'DASS-21', instrumentId: DASS21_INSTRUMENT_ID,
      instrumentVersionId: '00000000-0000-4000-8000-000000008a92',
      instrumentVersion: 'dass21-spanish-candidate-1.1', questionSetSha256: 'b'.repeat(64),
    },
    administration: baseDecision,
    license: { status: 'not_applicable', reference: 'synthetic test fixture', evidence: baseDecision },
    scoring: null, interpretation: null, participantDisclosure: null,
    effectiveAt: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('DASS-21 local publication manifest', () => {
  it('requires exact version identity, operator, scope, decision dates and hashed evidence references', () => {
    expect(dass21PublicationManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(dass21PublicationManifestSchema.safeParse(manifest({ administration: { ...baseDecision, documents: [] } })).success).toBe(false);
    expect(dass21PublicationManifestSchema.safeParse(manifest({ operator: { name: '', role: '' } })).success).toBe(false);
    expect(dass21PublicationManifestSchema.safeParse(manifest({ instrument: { ...manifest().instrument, instrumentId: '00000000-0000-4000-8000-000000000001' } })).success).toBe(false);
  });

  it('rejects participant disclosure without separately authorized scoring and interpretation', () => {
    expect(dass21PublicationManifestSchema.safeParse(manifest({ participantDisclosure: baseDecision })).success).toBe(false);
    expect(dass21PublicationManifestSchema.safeParse(manifest({ interpretation: {
      ...baseDecision, scoringVersion: 'dass21-score-1.0', interpretationVersion: 'dass21-conventional-cutoffs-1.0',
    } })).success).toBe(false);
  });

  it('keeps scoring, interpretation and participant disclosure independently optional', () => {
    const parsed = dass21PublicationManifestSchema.parse(manifest());
    const entry = toDass21RuntimeAuthorization(parsed);
    expect(entry).toMatchObject({
      instrumentVersionId: parsed.instrument.instrumentVersionId,
      administration: { evidenceReference: baseDecision.evidenceReference },
      scoring: null, interpretation: null, participantDisclosure: null,
    });
  });

  it('hashes the exact ordered question snapshot deterministically regardless of object key order', () => {
    const left = [
      { questionId: 'q2', displayOrder: 2, definition: { prompt: 'b', required: true } },
      { questionId: 'q1', displayOrder: 1, definition: { required: true, prompt: 'a' } },
    ] as const;
    const right = [
      { questionId: 'q1', displayOrder: 1, definition: { prompt: 'a', required: true } },
      { questionId: 'q2', displayOrder: 2, definition: { required: true, prompt: 'b' } },
    ] as const;
    expect(hashDass21QuestionSnapshot(left)).toBe(hashDass21QuestionSnapshot(right));
    expect(hashDass21QuestionSnapshot(left)).not.toBe(hashDass21QuestionSnapshot([{ ...left[0], displayOrder: 1 }, left[1]]));
  });

  it('maps PostgreSQL snake_case rows to the same canonical hash and detects content changes', () => {
    const databaseRows = [
      { question_id: 'q2', display_order: 2, definition: { prompt: 'b', required: true } },
      { question_id: 'q1', display_order: 1, definition: { required: true, prompt: 'a' } },
    ] as const;
    const expected = [
      { questionId: 'q2', displayOrder: 2, definition: { prompt: 'b', required: true } },
      { questionId: 'q1', displayOrder: 1, definition: { required: true, prompt: 'a' } },
    ] as const;
    expect(hashDass21QuestionSnapshot(toDass21QuestionSnapshot(databaseRows))).toBe(hashDass21QuestionSnapshot(expected));
    expect(hashDass21QuestionSnapshot(toDass21QuestionSnapshot([
      { ...databaseRows[0], definition: { prompt: 'tampered', required: true } },
      databaseRows[1],
    ]))).not.toBe(hashDass21QuestionSnapshot(expected));
  });
});
