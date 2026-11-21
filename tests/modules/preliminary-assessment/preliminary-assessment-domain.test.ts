import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  completeAssessment,
  createPreliminaryAssessment,
  expireAssessment,
  pauseAssessment,
  recordAssessmentResponse,
  resumeAssessment,
  withdrawAssessment,
} from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../src/modules/preliminary-assessment/domain/model/assessment-errors.js';
import { createUnavailableAssessmentResult } from '../../../src/modules/preliminary-assessment/domain/model/assessment-result.js';
import { upsertAssessmentResponse } from '../../../src/modules/preliminary-assessment/domain/model/assessment-response.js';
import { isInstrumentAvailable, parseInstrumentVersion, type InstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';

function approvedInstrument(overrides: Partial<InstrumentVersion> = {}): InstrumentVersion {
  return parseInstrumentVersion({
    instrumentId: randomUUID(),
    instrumentVersionId: randomUUID(),
    version: 'fixture-1',
    effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'approved',
    questions: [{
      id: randomUUID(), prompt: 'Fictional neutral question', responseType: 'text', required: true, maxLength: 200,
    }],
    approval: { status: 'approved', approvedAt: new Date('2026-01-01T00:00:00.000Z'), approvalReference: 'fictional-test-approval' },
    license: { status: 'authorized', reference: 'fictional-test-license' },
    ...overrides,
  });
}

function newAssessment(mode: 'conversational_contextual' | 'structured_instrument' = 'conversational_contextual', instrumentVersionId: string | null = null) {
  const at = new Date('2026-04-01T00:00:00.000Z');
  return createPreliminaryAssessment({
    assessmentId: randomUUID(), accountId: randomUUID(), assessmentType: 'fictional-check-in', mode,
    instrumentVersionId, consentNoticeVersionId: randomUUID(), createdAt: at, startedAt: at,
  });
}

describe('PreliminaryAssessment domain', () => {
  it('creates an in-progress assessment without implying any diagnosis or result', () => {
    const assessment = newAssessment();
    expect(assessment).toMatchObject({ status: 'in_progress', mode: 'conversational_contextual', instrumentVersionId: null, completedAt: null, withdrawnAt: null });
    expect(assessment.responses).toEqual([]);
    expect(() => newAssessment('structured_instrument')).toThrow(PreliminaryAssessmentError);
  });

  it('supports pause and resume and rejects invalid or terminal transitions', () => {
    const initial = newAssessment();
    const paused = pauseAssessment(initial, new Date('2026-04-01T00:01:00.000Z'));
    const resumed = resumeAssessment(paused, new Date('2026-04-01T00:02:00.000Z'));
    expect(paused.status).toBe('paused');
    expect(resumed.status).toBe('in_progress');
    expect(() => pauseAssessment(paused, new Date('2026-04-01T00:03:00.000Z'))).toThrow(PreliminaryAssessmentError);
    expect(() => resumeAssessment(initial, new Date('2026-04-01T00:03:00.000Z'))).toThrow(PreliminaryAssessmentError);

    const withdrawn = withdrawAssessment(paused, new Date('2026-04-01T00:03:00.000Z'));
    expect(withdrawn).toMatchObject({ status: 'withdrawn', withdrawnAt: new Date('2026-04-01T00:03:00.000Z') });
    expect(() => resumeAssessment(withdrawn, new Date('2026-04-01T00:04:00.000Z'))).toThrow(PreliminaryAssessmentError);
    expect(expireAssessment(initial, new Date('2026-04-02T00:00:00.000Z')).status).toBe('expired');
  });

  it('completes idempotently and does not infer score, interpretation, priority, or safety', () => {
    const initial = newAssessment();
    const completed = completeAssessment(initial, new Date('2026-04-01T00:05:00.000Z'));
    expect(completed).toMatchObject({ status: 'completed', completedAt: new Date('2026-04-01T00:05:00.000Z') });
    expect(completeAssessment(completed, new Date('2026-04-02T00:00:00.000Z'))).toBe(completed);
    expect(() => withdrawAssessment(completed, new Date('2026-04-03T00:00:00.000Z'))).toThrow(PreliminaryAssessmentError);

    const result = createUnavailableAssessmentResult(completed.assessmentId, null, completed.completedAt!);
    expect(result).toMatchObject({
      instrumentScores: { status: 'not_available' },
      interpretation: { status: 'not_available' },
      attentionPriority: { status: 'not_available' },
      safetyState: { status: 'not_available', reason: 'not_assessed' },
    });
    expect(JSON.stringify(result)).not.toMatch(/diagnos|low|moderate|high|riesgo/i);
  });

  it('requires an approved, licensed, matching instrument and all required answers before completion', () => {
    const instrument = approvedInstrument();
    const question = instrument.questions[0];
    if (!question) throw new Error('Fixture question missing');
    const initial = newAssessment('structured_instrument', instrument.instrumentVersionId);

    expect(isInstrumentAvailable(instrument)).toBe(true);
    expect(() => completeAssessment(initial, new Date('2026-04-01T00:01:00.000Z'), instrument)).toThrow(PreliminaryAssessmentError);
    expect(() => recordAssessmentResponse(initial, {
      assessmentId: initial.assessmentId, instrumentVersionId: randomUUID(), questionId: question.id,
      status: 'answered', answer: { type: 'text', value: 'Fictional answer' }, createdAt: new Date('2026-04-01T00:01:00.000Z'), updatedAt: new Date('2026-04-01T00:01:00.000Z'),
    }, instrument)).toThrow(PreliminaryAssessmentError);

    const response = {
      assessmentId: initial.assessmentId, instrumentVersionId: instrument.instrumentVersionId, questionId: question.id,
      status: 'answered' as const, answer: { type: 'text' as const, value: 'Fictional answer' }, createdAt: new Date('2026-04-01T00:01:00.000Z'), updatedAt: new Date('2026-04-01T00:01:00.000Z'),
    };
    const answered = recordAssessmentResponse(initial, response, instrument);
    expect(answered.responses).toHaveLength(1);
    expect(completeAssessment(answered, new Date('2026-04-01T00:02:00.000Z'), instrument).status).toBe('completed');

    const unapproved = parseInstrumentVersion({
      ...instrument, status: 'draft', approval: { ...instrument.approval, status: 'pending', approvedAt: null, approvalReference: null },
    });
    expect(isInstrumentAvailable(unapproved)).toBe(false);
    expect(() => recordAssessmentResponse(initial, response, unapproved)).toThrow(PreliminaryAssessmentError);
  });

  it('validates answers against question options and bounds and allows pending responses only for known questions', () => {
    const instrument = approvedInstrument({ questions: [
      { id: randomUUID(), prompt: 'Fictional option question', responseType: 'single_choice', required: true, options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }] },
      { id: randomUUID(), prompt: 'Fictional numeric question', responseType: 'number', required: false, minimum: 1, maximum: 5 },
    ] });
    const first = instrument.questions[0];
    const second = instrument.questions[1];
    if (!first || !second) throw new Error('Fixture questions missing');
    const assessment = newAssessment('structured_instrument', instrument.instrumentVersionId);
    const at = new Date('2026-04-01T00:01:00.000Z');

    expect(() => recordAssessmentResponse(assessment, {
      assessmentId: assessment.assessmentId, instrumentVersionId: instrument.instrumentVersionId, questionId: first.id,
      status: 'answered', answer: { type: 'single_choice', optionId: 'unknown' }, createdAt: at, updatedAt: at,
    }, instrument)).toThrow(PreliminaryAssessmentError);
    expect(() => recordAssessmentResponse(assessment, {
      assessmentId: assessment.assessmentId, instrumentVersionId: instrument.instrumentVersionId, questionId: second.id,
      status: 'answered', answer: { type: 'number', value: 9 }, createdAt: at, updatedAt: at,
    }, instrument)).toThrow(PreliminaryAssessmentError);
    expect(() => recordAssessmentResponse(assessment, {
      assessmentId: assessment.assessmentId, instrumentVersionId: instrument.instrumentVersionId, questionId: randomUUID(),
      status: 'pending', answer: null, createdAt: at, updatedAt: at,
    }, instrument)).toThrow(PreliminaryAssessmentError);
  });

  it('edits the current response rather than duplicating it and detects corrupt duplicate state', () => {
    const at = new Date('2026-04-01T00:01:00.000Z');
    const first = {
      assessmentId: randomUUID(), instrumentVersionId: randomUUID(), questionId: randomUUID(), status: 'answered' as const,
      answer: { type: 'text' as const, value: 'Fictional first answer' }, createdAt: at, updatedAt: at,
    };
    const edited = { ...first, answer: { type: 'text' as const, value: 'Fictional edited answer' }, updatedAt: new Date('2026-04-01T00:02:00.000Z') };
    expect(upsertAssessmentResponse([first], edited)).toEqual([edited]);
    expect(() => upsertAssessmentResponse([first, edited], edited)).toThrowError(
      expect.objectContaining({ code: 'duplicate_response' }),
    );
  });
});
