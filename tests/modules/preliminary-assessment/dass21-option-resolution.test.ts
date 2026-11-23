import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GetAssessmentInfo } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-assessment-info.js';
import { GetMyAssessmentForm } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-my-assessment-form.js';
import { createPreliminaryAssessment, completeAssessment, recordAssessmentResponse } from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { createDass21AssessmentScore } from '../../../src/modules/preliminary-assessment/domain/model/dass21-assessment-score.js';
import { freezeDass21QuestionMapping, validateDass21QuestionMapping } from '../../../src/modules/preliminary-assessment/domain/model/dass21-question-mapping.js';
import { Dass21ScoringError } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';
import { parseInstrumentVersion, publicInstrumentQuestionSchema, toPublicInstrumentQuestion, type InstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';

const at = new Date('2026-02-01T12:00:00.000Z');

function fixture(valueForEveryItem: number) {
  const instrumentId = randomUUID();
  const instrumentVersionId = randomUUID();
  const questions = Array.from({ length: 21 }, (_, index) => ({
    id: randomUUID(),
    prompt: `Synthetic item ${index + 1}`,
    responseType: 'single_choice' as const,
    required: true,
    displayOrder: index + 1,
    options: [0, 1, 2, 3].map(value => ({
      id: `item-${index + 1}-value-${value}`,
      label: `Synthetic choice ${value}`,
      scoringValue: value,
    })),
  }));
  const instrument: InstrumentVersion = parseInstrumentVersion({
    instrumentId,
    instrumentVersionId,
    version: 'synthetic-option-score-1',
    effectiveAt: at,
    status: 'approved',
    questions,
    approval: { status: 'approved', approvedAt: at, approvalReference: 'synthetic unit fixture' },
    license: { status: 'authorized', reference: 'synthetic unit fixture' },
  });
  const assessmentId = randomUUID();
  const accountId = randomUUID();
  let assessment = createPreliminaryAssessment({
    assessmentId,
    accountId,
    assessmentType: 'synthetic-dass21-option-resolution',
    mode: 'structured_instrument',
    instrumentVersionId,
    consentNoticeVersionId: randomUUID(),
    createdAt: at,
    startedAt: at,
  });
  questions.forEach((question, index) => {
    const responseAt = new Date(at.getTime() + index + 1);
    assessment = recordAssessmentResponse(assessment, {
      assessmentId,
      instrumentVersionId,
      questionId: question.id,
      status: 'answered',
      answer: { type: 'single_choice', optionId: `item-${index + 1}-value-${valueForEveryItem}` },
      createdAt: responseAt,
      updatedAt: responseAt,
    }, instrument);
  });
  const completedAt = new Date(at.getTime() + 100);
  assessment = completeAssessment(assessment, completedAt, instrument);
  const mapping = freezeDass21QuestionMapping(validateDass21QuestionMapping({
    schemaVersion: '1.0', mappingId: randomUUID(), instrumentCode: 'DASS-21', instrumentId, instrumentVersionId,
    mappingVersion: 'synthetic-map-1', status: 'draft', createdAt: at, frozenAt: null,
    entries: questions.map((question, index) => ({ questionId: question.id, itemNumber: index + 1 })),
  }, instrument), completedAt);
  return { assessment, instrument, mapping, completedAt };
}

function score(fixtureValue: ReturnType<typeof fixture>) {
  return createDass21AssessmentScore({
    assessment: fixtureValue.assessment,
    instrument: fixtureValue.instrument,
    mapping: fixtureValue.mapping,
    calculatedAt: new Date(fixtureValue.completedAt.getTime() + 1),
  });
}

describe('DASS-21 optionId resolution', () => {
  it.each([0, 1, 2, 3])('resolves server-defined option value %i for all 21 responses', value => {
    const testFixture = fixture(value);
    const result = score(testFixture);
    for (const dimension of ['depression', 'anxiety', 'stress'] as const) {
      expect(result.dimensions[dimension]).toEqual({ rawScore: 7 * value, equivalentScore: 14 * value });
    }
  });

  it('rejects an option belonging to a different question', () => {
    const testFixture = fixture(1);
    const [first, second] = testFixture.assessment.responses;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const foreignOptionId = `item-2-value-1`;
    const corrupted = {
      ...testFixture.assessment,
      responses: testFixture.assessment.responses.map((response, index) => index === 0
        ? { ...response, answer: { type: 'single_choice' as const, optionId: foreignOptionId } }
        : response),
    };
    expect(() => createDass21AssessmentScore({
      assessment: corrupted,
      instrument: testFixture.instrument,
      mapping: testFixture.mapping,
      calculatedAt: new Date(testFixture.completedAt.getTime() + 1),
    })).toThrowError(expect.objectContaining({ code: 'invalid_answers' }));
  });

  it('rejects a client-supplied numeric score instead of trusting it', () => {
    const testFixture = fixture(2);
    const corrupted = {
      ...testFixture.assessment,
      responses: testFixture.assessment.responses.map((response, index) => index === 0
        ? { ...response, answer: { type: 'single_choice' as const, optionId: 'item-1-value-2', scoringValue: 0 } }
        : response),
    };
    expect(() => createDass21AssessmentScore({
      assessment: corrupted,
      instrument: testFixture.instrument,
      mapping: testFixture.mapping,
      calculatedAt: new Date(testFixture.completedAt.getTime() + 1),
    })).toThrow(Dass21ScoringError);
  });

  it('rejects incomplete, duplicate, wrongly ordered, or unscored mappings', () => {
    const testFixture = fixture(0);
    const mapping = testFixture.mapping;
    expect(() => validateDass21QuestionMapping({ ...mapping, entries: mapping.entries.slice(0, 20) }, testFixture.instrument)).toThrow(Dass21ScoringError);
    expect(() => validateDass21QuestionMapping({ ...mapping, entries: mapping.entries.map((entry, index) => index === 20 ? { ...entry, questionId: mapping.entries[0]!.questionId } : entry) }, testFixture.instrument)).toThrow(Dass21ScoringError);
    expect(() => validateDass21QuestionMapping({ ...mapping, entries: mapping.entries.map((entry, index) => index === 0 ? { ...entry, itemNumber: 2 } : entry) }, testFixture.instrument)).toThrow(Dass21ScoringError);

    const unscoredInstrument = parseInstrumentVersion({
      ...testFixture.instrument,
      questions: testFixture.instrument.questions.map((question, index) => index === 0 && question.responseType === 'single_choice'
        ? { ...question, options: question.options.map(({ id, label }) => ({ id, label })) }
        : question),
    });
    expect(() => validateDass21QuestionMapping(mapping, unscoredInstrument)).toThrow(Dass21ScoringError);

    const duplicateOptionValues = parseInstrumentVersion({
      ...testFixture.instrument,
      questions: testFixture.instrument.questions.map((question, index) => index === 0 && question.responseType === 'single_choice'
        ? { ...question, options: question.options.map(option => ({ ...option, scoringValue: 0 })) }
        : question),
    });
    expect(() => validateDass21QuestionMapping(mapping, duplicateOptionValues)).toThrow(Dass21ScoringError);
    expect(() => parseInstrumentVersion({
      ...testFixture.instrument,
      questions: testFixture.instrument.questions.map((question, index) => index === 0 && question.responseType === 'single_choice'
        ? { ...question, options: question.options.map((option, optionIndex) => optionIndex === 0 ? { ...option, scoringValue: 4 } : option) }
        : question),
    })).toThrow();
  });

  it('rejects duplicate persisted responses for the same question', () => {
    const testFixture = fixture(3);
    const corrupted = { ...testFixture.assessment, responses: [...testFixture.assessment.responses, testFixture.assessment.responses[0]!] };
    expect(() => createDass21AssessmentScore({
      assessment: corrupted,
      instrument: testFixture.instrument,
      mapping: testFixture.mapping,
      calculatedAt: new Date(testFixture.completedAt.getTime() + 1),
    })).toThrowError(expect.objectContaining({ code: 'invalid_answers' }));
  });

  it('keeps the server scoring map out of instrument-info and form responses', async () => {
    const testFixture = fixture(0);
    const firstQuestion = testFixture.instrument.questions[0]!;
    expect(firstQuestion.responseType).toBe('single_choice');
    if (firstQuestion.responseType !== 'single_choice') throw new Error('synthetic fixture mismatch');
    expect(toPublicInstrumentQuestion(firstQuestion).options[0]).not.toHaveProperty('scoringValue');
    expect(() => publicInstrumentQuestionSchema.parse(firstQuestion)).toThrow();

    const info = await new GetAssessmentInfo({ listAvailable: async () => [testFixture.instrument] } as never, () => at).execute();
    const infoQuestion = info.instruments[0]?.questions[0];
    expect(infoQuestion).toBeDefined();
    if (infoQuestion?.responseType === 'single_choice') expect(infoQuestion.options[0]).not.toHaveProperty('scoringValue');

    const noticeVersionId = randomUUID();
    const assessment = createPreliminaryAssessment({
      assessmentId: randomUUID(), accountId: randomUUID(), assessmentType: 'synthetic-form',
      mode: 'structured_instrument', instrumentVersionId: testFixture.instrument.instrumentVersionId,
      consentNoticeVersionId: noticeVersionId, createdAt: at, startedAt: at,
    });
    const form = await new GetMyAssessmentForm(
      { findByIdForOwner: async () => assessment } as never,
      { findAvailableByVersionId: async () => testFixture.instrument } as never,
      { getCurrentNoticeVersionId: async () => noticeVersionId } as never,
      () => at,
    ).execute(assessment.assessmentId, assessment.accountId);
    const formQuestion = form.instrument.questions[0];
    expect(formQuestion).toBeDefined();
    if (formQuestion?.responseType === 'single_choice') expect(formQuestion.options[0]).not.toHaveProperty('scoringValue');
  });
});
