import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertDass21ScoreWriteAuthorization, createDass21AssessmentScore } from '../../../src/modules/preliminary-assessment/domain/model/dass21-assessment-score.js';
import { createPreliminaryAssessment, recordAssessmentResponse, completeAssessment } from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { freezeDass21QuestionMapping, validateDass21QuestionMapping } from '../../../src/modules/preliminary-assessment/domain/model/dass21-question-mapping.js';
import { Dass21ScoringError } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';
import { parseInstrumentVersion, type InstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';
import { createUnavailableAssessmentResult } from '../../../src/modules/preliminary-assessment/domain/model/assessment-result.js';
import { toAssessmentResultResource } from '../../../src/modules/preliminary-assessment/interfaces/rest/transformers/assessment-transformer.js';

function setup() {
  const instrumentVersionId = randomUUID();
  const instrumentId = randomUUID();
  const questions = Array.from({ length: 21 }, () => ({
    id: randomUUID(), prompt: 'Synthetic fixture question', responseType: 'number' as const,
    required: true, minimum: 0, maximum: 3,
  })).map((question, index) => ({ ...question, displayOrder: index + 1 }));
  const instrument: InstrumentVersion = parseInstrumentVersion({
    instrumentId, instrumentVersionId, version: 'synthetic-dass21-v1', effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'approved', questions,
    approval: { status: 'approved', approvedAt: new Date('2026-01-01T00:00:00.000Z'), approvalReference: 'synthetic-unit-fixture' },
    license: { status: 'authorized', reference: 'synthetic-unit-fixture' },
  });
  const mapping = {
    schemaVersion: '1.0' as const, mappingId: randomUUID(), instrumentCode: 'DASS-21' as const,
    instrumentId, instrumentVersionId, mappingVersion: 'synthetic-map-v1', status: 'draft' as const,
    createdAt: new Date('2026-01-02T00:00:00.000Z'), frozenAt: null,
    entries: questions.map((question, index) => ({ questionId: question.id, itemNumber: index + 1 })),
  };
  const startedAt = new Date('2026-01-03T00:00:00.000Z');
  let assessment = createPreliminaryAssessment({
    assessmentId: randomUUID(), accountId: randomUUID(), assessmentType: 'synthetic-dass21',
    mode: 'structured_instrument', instrumentVersionId, consentNoticeVersionId: randomUUID(),
    createdAt: startedAt, startedAt,
  });
  questions.forEach((question, index) => {
    const at = new Date(startedAt.getTime() + index + 1);
    assessment = recordAssessmentResponse(assessment, {
      assessmentId: assessment.assessmentId, instrumentVersionId, questionId: question.id,
      status: 'answered', answer: { type: 'number', value: index % 4 }, createdAt: at, updatedAt: at,
    }, instrument);
  });
  const completedAt = new Date(startedAt.getTime() + 100);
  assessment = completeAssessment(assessment, completedAt, instrument);
  return { instrument, mapping, assessment, completedAt };
}

describe('DASS-21 mapping and persistence contracts', () => {
  it('validates a complete UUID-to-item map for the exact instrument version independent of array order', () => {
    const fixture = setup();
    const reversed = { ...fixture.mapping, entries: [...fixture.mapping.entries].reverse() };
    const validated = validateDass21QuestionMapping(reversed, fixture.instrument);
    expect(validated.entries.map(entry => entry.itemNumber)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(validated.entries[0]?.questionId).toBe(fixture.mapping.entries[0]?.questionId);
  });

  it('rejects duplicate item numbers, missing items, foreign questions and incompatible instrument versions', () => {
    const fixture = setup();
    const duplicate = { ...fixture.mapping, entries: fixture.mapping.entries.map((entry, index) => index === 20 ? { ...entry, itemNumber: 1 } : entry) };
    expect(() => validateDass21QuestionMapping(duplicate, fixture.instrument)).toThrow(Dass21ScoringError);
    expect(() => validateDass21QuestionMapping({ ...fixture.mapping, entries: fixture.mapping.entries.slice(0, 20) }, fixture.instrument)).toThrow(Dass21ScoringError);
    const foreign = { ...fixture.mapping, entries: fixture.mapping.entries.map((entry, index) => index === 0 ? { ...entry, questionId: randomUUID() } : entry) };
    expect(() => validateDass21QuestionMapping(foreign, fixture.instrument)).toThrow(Dass21ScoringError);
    const otherVersion = parseInstrumentVersion({ ...fixture.instrument, instrumentVersionId: randomUUID() });
    expect(() => validateDass21QuestionMapping(fixture.mapping, otherVersion)).toThrowError(
      expect.objectContaining({ code: 'instrument_version_mismatch' }),
    );
  });

  it('freezes a valid mapping once and rejects a second transition', () => {
    const fixture = setup();
    const frozenAt = new Date('2026-01-04T00:00:00.000Z');
    const frozen = freezeDass21QuestionMapping(validateDass21QuestionMapping(fixture.mapping, fixture.instrument), frozenAt);
    expect(frozen).toMatchObject({ status: 'frozen', frozenAt });
    expect(() => freezeDass21QuestionMapping(frozen, new Date(frozenAt.getTime() + 1))).toThrow(Dass21ScoringError);
  });

  it('creates a versioned internal score record with owner, instrument, mapping and engine versions', () => {
    const fixture = setup();
    const mapping = freezeDass21QuestionMapping(validateDass21QuestionMapping(fixture.mapping, fixture.instrument), fixture.completedAt);
    const score = createDass21AssessmentScore({
      assessment: fixture.assessment, instrument: fixture.instrument, mapping,
      calculatedAt: new Date(fixture.completedAt.getTime() + 1),
    });
    expect(score).toMatchObject({
      status: 'calculated', assessmentId: fixture.assessment.assessmentId, accountId: fixture.assessment.accountId,
      instrumentVersionId: fixture.instrument.instrumentVersionId, mappingId: mapping.mappingId,
      mappingVersion: 'synthetic-map-v1', scoringVersion: 'dass21-score-1.0',
    });
    expect(score.dimensions.depression.equivalentScore).toBe(score.dimensions.depression.rawScore * 2);
    expect(score.dimensions.anxiety.equivalentScore).toBe(score.dimensions.anxiety.rawScore * 2);
    expect(score.dimensions.stress.equivalentScore).toBe(score.dimensions.stress.rawScore * 2);
    expect(score).not.toHaveProperty('diagnosis');
    expect(score).not.toHaveProperty('severity');
  });

  it('requires owner, completed assessment, current granted consent and exact frozen mapping before score persistence', () => {
    const fixture = setup();
    const mapping = freezeDass21QuestionMapping(validateDass21QuestionMapping(fixture.mapping, fixture.instrument), fixture.completedAt);
    const score = createDass21AssessmentScore({ assessment: fixture.assessment, instrument: fixture.instrument, mapping,
      calculatedAt: new Date(fixture.completedAt.getTime() + 1) });
    const authorized = {
      score, requestedAccountId: fixture.assessment.accountId, assessment: fixture.assessment,
      currentNoticeVersionId: fixture.assessment.consentNoticeVersionId,
      latestDecision: { action: 'granted', noticeVersionId: fixture.assessment.consentNoticeVersionId }, mapping,
    };
    expect(() => assertDass21ScoreWriteAuthorization(authorized)).not.toThrow();
    expect(() => assertDass21ScoreWriteAuthorization({ ...authorized, requestedAccountId: randomUUID() })).toThrowError(
      expect.objectContaining({ code: 'assessment_not_found' }),
    );
    expect(() => assertDass21ScoreWriteAuthorization({ ...authorized, latestDecision: { action: 'withdrawn', noticeVersionId: fixture.assessment.consentNoticeVersionId } })).toThrowError(
      expect.objectContaining({ code: 'consent_required' }),
    );
    expect(() => assertDass21ScoreWriteAuthorization({ ...authorized, currentNoticeVersionId: randomUUID() })).toThrowError(
      expect.objectContaining({ code: 'consent_required' }),
    );
    expect(() => assertDass21ScoreWriteAuthorization({ ...authorized, mapping: { ...mapping, status: 'draft' } })).toThrowError(
      expect.objectContaining({ code: 'mapping_not_frozen' }),
    );
  });

  it('rejects incomplete and mismatched answer sets and does not score open assessments', () => {
    const fixture = setup();
    const mapping = freezeDass21QuestionMapping(validateDass21QuestionMapping(fixture.mapping, fixture.instrument), fixture.completedAt);
    const incomplete = { ...fixture.assessment, responses: fixture.assessment.responses.slice(0, 20) };
    expect(() => createDass21AssessmentScore({ assessment: incomplete, instrument: fixture.instrument, mapping, calculatedAt: new Date(fixture.completedAt.getTime() + 1) })).toThrowError(
      expect.objectContaining({ code: 'incomplete_answers' }),
    );
    const open = { ...fixture.assessment, status: 'in_progress' as const, completedAt: null };
    expect(() => createDass21AssessmentScore({ assessment: open, instrument: fixture.instrument, mapping, calculatedAt: new Date(fixture.completedAt.getTime() + 1) })).toThrow(Dass21ScoringError);
  });

  it('keeps DASS scores out of the public legacy result resource and preserves historical shape', () => {
    const legacy = createUnavailableAssessmentResult(randomUUID(), randomUUID(), new Date('2026-01-05T00:00:00.000Z'));
    const resource = toAssessmentResultResource(legacy);
    expect(resource).toEqual({
      schemaVersion: '1.0', assessmentId: legacy.assessmentId, instrumentVersionId: legacy.instrumentVersionId,
      calculatedAt: legacy.calculatedAt.toISOString(), instrumentScores: { status: 'not_available', reason: 'no_approved_scoring_rules' },
      interpretation: { status: 'not_available', reason: 'no_approved_scoring_rules' },
      attentionPriority: { status: 'not_available', reason: 'no_approved_scoring_rules' },
      safetyState: { status: 'not_available', reason: 'not_assessed' },
    });
    expect(resource).not.toHaveProperty('dimensions');
    expect(JSON.stringify(resource)).not.toMatch(/rawScore|equivalentScore|mappingVersion|scoringVersion/);
  });
});
