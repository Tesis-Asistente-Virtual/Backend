import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GetMyInternalDass21Result } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-my-internal-dass21-result.js';
import type { Dass21InternalResultReadSession, Dass21InternalResultReadUnitOfWork } from '../../../src/modules/preliminary-assessment/application/ports/dass21-internal-result-read-unit-of-work.js';
import { createDass21AssessmentScore } from '../../../src/modules/preliminary-assessment/domain/model/dass21-assessment-score.js';
import { createPreliminaryAssessment, completeAssessment, recordAssessmentResponse } from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { freezeDass21QuestionMapping, validateDass21QuestionMapping } from '../../../src/modules/preliminary-assessment/domain/model/dass21-question-mapping.js';
import { DASS21_INTERPRETATION_BASIS, DASS21_INTERPRETATION_VERSION } from '../../../src/modules/preliminary-assessment/domain/model/dass21-interpretation.js';
import { parseInstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';

const at = new Date('2026-03-01T12:00:00.000Z');

function setup() {
  const accountId = randomUUID();
  const assessmentId = randomUUID();
  const noticeId = randomUUID();
  const instrumentId = randomUUID();
  const instrumentVersionId = randomUUID();
  const questions = Array.from({ length: 21 }, (_, index) => ({
    id: randomUUID(), prompt: `Synthetic internal result item ${index + 1}`,
    responseType: 'number' as const, required: true, minimum: 0, maximum: 3, displayOrder: index + 1,
  }));
  const instrument = parseInstrumentVersion({
    instrumentId, instrumentVersionId, version: 'synthetic-internal-result-v1', effectiveAt: at,
    status: 'approved', questions,
    approval: { status: 'approved', approvedAt: at, approvalReference: 'synthetic only' },
    license: { status: 'authorized', reference: 'synthetic only' },
  });
  const startedAt = new Date(at.getTime() + 100);
  let assessment = createPreliminaryAssessment({
    assessmentId, accountId, assessmentType: 'synthetic-internal-result', mode: 'structured_instrument',
    instrumentVersionId, consentNoticeVersionId: noticeId, createdAt: startedAt, startedAt,
  });
  questions.forEach((question, index) => {
    const responseAt = new Date(startedAt.getTime() + index + 1);
    assessment = recordAssessmentResponse(assessment, {
      assessmentId, instrumentVersionId, questionId: question.id, status: 'answered',
      answer: { type: 'number', value: index % 4 }, createdAt: responseAt, updatedAt: responseAt,
    }, instrument);
  });
  const completedAt = new Date(startedAt.getTime() + 100);
  assessment = completeAssessment(assessment, completedAt, instrument);
  const mapping = freezeDass21QuestionMapping(validateDass21QuestionMapping({
    schemaVersion: '1.0', mappingId: randomUUID(), instrumentCode: 'DASS-21', instrumentId, instrumentVersionId,
    mappingVersion: 'synthetic-internal-map-v1', status: 'draft', createdAt: at, frozenAt: null,
    entries: questions.map((question, index) => ({ questionId: question.id, itemNumber: index + 1 })),
  }, instrument), completedAt);
  const score = createDass21AssessmentScore({ assessment, instrument, mapping, calculatedAt: new Date(completedAt.getTime() + 1) });
  const support = {
    status: 'approved' as const,
    approvalReference: 'synthetic support fixture only',
    approvedAt: at,
    support: {
      instrumentVersionId,
      scoringVersion: 'dass21-score-1.0' as const,
      interpretationVersion: DASS21_INTERPRETATION_VERSION,
      basis: DASS21_INTERPRETATION_BASIS,
    },
  };

  const session = {
    requireCurrentConsentNotice: vi.fn(async () => noticeId),
    findAssessmentForOwner: vi.fn(async (id: string, owner: string) => id === assessmentId && owner === accountId ? assessment : null),
    findAvailableInstrumentVersion: vi.fn(async () => instrument),
    findFrozenMapping: vi.fn(async () => mapping),
    findScoreForOwner: vi.fn(async () => score),
  };
  const reads: Dass21InternalResultReadUnitOfWork = {
    execute: vi.fn(async work => work(session as unknown as Dass21InternalResultReadSession)),
  };
  const supportProvider = { getApprovedSupport: vi.fn(() => support) };
  const query = () => new GetMyInternalDass21Result(reads, supportProvider, () => new Date(completedAt.getTime() + 2));
  return { accountId, assessmentId, noticeId, assessment, instrument, mapping, score, support, session, reads, supportProvider, query };
}

describe('GetMyInternalDass21Result', () => {
  it('returns a deterministic versioned result within one read unit of work', async () => {
    const fixture = setup();
    const result = await fixture.query().execute(fixture.assessmentId, fixture.accountId);
    expect(result).toMatchObject({
      status: 'available', resultVersion: 'dass21-internal-result-1.0', assessmentId: fixture.assessmentId,
      instrument: { code: 'DASS-21', instrumentVersionId: fixture.instrument.instrumentVersionId },
      scoringVersion: 'dass21-score-1.0', interpretationVersion: DASS21_INTERPRETATION_VERSION,
    });
    if (result.status !== 'available') throw new Error('Expected available synthetic internal result');
    expect(Object.keys(result.dimensions)).toEqual(['depression', 'anxiety', 'stress']);
    expect(result).not.toHaveProperty('overallCategory');
    expect(result.limitations).toContain('not_a_diagnosis');
    await expect(fixture.query().execute(fixture.assessmentId, fixture.accountId)).resolves.toEqual(result);
    expect(fixture.reads.execute).toHaveBeenCalledTimes(2);
  });

  it('checks consent before reading owner assessment and sensitive result material', async () => {
    const fixture = setup();
    await fixture.query().execute(fixture.assessmentId, fixture.accountId);
    const callOrder = [
      fixture.session.requireCurrentConsentNotice.mock.invocationCallOrder[0],
      fixture.session.findAssessmentForOwner.mock.invocationCallOrder[0],
      fixture.session.findAvailableInstrumentVersion.mock.invocationCallOrder[0],
      fixture.supportProvider.getApprovedSupport.mock.invocationCallOrder[0],
      fixture.session.findScoreForOwner.mock.invocationCallOrder[0],
      fixture.session.findFrozenMapping.mock.invocationCallOrder[0],
    ];
    expect(callOrder).toEqual([...callOrder].sort((left, right) => left - right));
  });

  it('conceals non-owner assessments and does not read score material', async () => {
    const fixture = setup();
    await expect(fixture.query().execute(fixture.assessmentId, randomUUID())).rejects.toMatchObject({ code: 'assessment_not_found' });
    expect(fixture.session.findScoreForOwner).not.toHaveBeenCalled();
  });

  it('fails closed for withdrawn or unavailable consent and assessment notice replacement', async () => {
    const withdrawn = setup();
    withdrawn.session.requireCurrentConsentNotice.mockRejectedValue(new Error('private checker detail'));
    await expect(withdrawn.query().execute(withdrawn.assessmentId, withdrawn.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'consent_required' });
    expect(withdrawn.session.findAssessmentForOwner).not.toHaveBeenCalled();

    const replaced = setup();
    replaced.session.requireCurrentConsentNotice.mockResolvedValue(randomUUID());
    await expect(replaced.query().execute(replaced.assessmentId, replaced.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'consent_required' });
    expect(replaced.session.findScoreForOwner).not.toHaveBeenCalled();
  });

  it('fails closed for incomplete, withdrawn, or changed assessments', async () => {
    const incomplete = setup();
    incomplete.session.findAssessmentForOwner.mockResolvedValueOnce({ ...incomplete.assessment, status: 'in_progress', completedAt: null });
    await expect(incomplete.query().execute(incomplete.assessmentId, incomplete.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'assessment_incomplete' });

    const reauthorized = setup();
    reauthorized.session.findAssessmentForOwner.mockResolvedValueOnce({ ...reauthorized.assessment, consentNoticeVersionId: randomUUID() });
    await expect(reauthorized.query().execute(reauthorized.assessmentId, reauthorized.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'consent_required' });

    const transactionFailure = setup();
    transactionFailure.reads.execute = vi.fn(async () => { throw new Error('private SQL detail'); });
    await expect(transactionFailure.query().execute(transactionFailure.assessmentId, transactionFailure.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'authorization_unavailable' });
  });

  it('fails closed for missing or invalid scores, instruments, mappings, and interpretation support', async () => {
    const missingScore = setup();
    missingScore.session.findScoreForOwner.mockResolvedValue(null);
    await expect(missingScore.query().execute(missingScore.assessmentId, missingScore.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'score_unavailable' });

    const wrongOwner = setup();
    wrongOwner.session.findScoreForOwner.mockResolvedValueOnce({ ...wrongOwner.score, accountId: randomUUID() });
    await expect(wrongOwner.query().execute(wrongOwner.assessmentId, wrongOwner.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'score_invalid' });

    const noInstrument = setup();
    noInstrument.session.findAvailableInstrumentVersion.mockResolvedValue(null);
    await expect(noInstrument.query().execute(noInstrument.assessmentId, noInstrument.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'instrument_unavailable' });

    const noMapping = setup();
    noMapping.session.findFrozenMapping.mockResolvedValue(null);
    await expect(noMapping.query().execute(noMapping.assessmentId, noMapping.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'mapping_unavailable' });

    const noSupport = setup();
    noSupport.supportProvider.getApprovedSupport.mockReturnValue(null);
    await expect(noSupport.query().execute(noSupport.assessmentId, noSupport.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'interpretation_support_unavailable' });
    expect(noSupport.session.findScoreForOwner).not.toHaveBeenCalled();
  });
});
