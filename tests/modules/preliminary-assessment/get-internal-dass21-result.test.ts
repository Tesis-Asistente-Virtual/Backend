import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GetMyInternalDass21Result } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-my-internal-dass21-result.js';
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

  const assessments = { findByIdForOwner: vi.fn(async (id: string, owner: string) => id === assessmentId && owner === accountId ? assessment : null) };
  const instruments = { findAvailableByVersionId: vi.fn(async () => instrument) };
  const mappings = { findFrozen: vi.fn(async () => mapping) };
  const scores = { findByAssessmentForOwner: vi.fn(async () => score) };
  const consent = { getCurrentNoticeVersionId: vi.fn(async () => noticeId) };
  const supportProvider = { getApprovedSupport: vi.fn(async () => support) };
  const query = () => new GetMyInternalDass21Result(assessments as never, instruments as never, mappings as never, scores as never, consent, supportProvider, () => new Date(completedAt.getTime() + 2));
  return { accountId, assessmentId, noticeId, assessment, instrument, mapping, score, support, assessments, instruments, mappings, scores, consent, supportProvider, query };
}

describe('GetMyInternalDass21Result', () => {
  it('returns a deterministic versioned internal result with three separate dimensions and limitations', async () => {
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
  });

  it('conceals non-owner assessments', async () => {
    const fixture = setup();
    await expect(fixture.query().execute(fixture.assessmentId, randomUUID())).rejects.toMatchObject({ code: 'assessment_not_found' });
    expect(fixture.scores.findByAssessmentForOwner).not.toHaveBeenCalled();
  });

  it('returns not_available for incomplete assessments, withdrawn consent, and checker failure', async () => {
    const incomplete = setup();
    incomplete.assessments.findByIdForOwner.mockResolvedValueOnce({ ...incomplete.assessment, status: 'in_progress', completedAt: null });
    await expect(incomplete.query().execute(incomplete.assessmentId, incomplete.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'assessment_incomplete' });

    const withdrawn = setup();
    withdrawn.consent.getCurrentNoticeVersionId.mockResolvedValue(null);
    await expect(withdrawn.query().execute(withdrawn.assessmentId, withdrawn.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'consent_required' });
    expect(withdrawn.scores.findByAssessmentForOwner).not.toHaveBeenCalled();

    const checkerFailure = setup();
    checkerFailure.consent.getCurrentNoticeVersionId.mockRejectedValue(new Error('private adapter detail'));
    await expect(checkerFailure.query().execute(checkerFailure.assessmentId, checkerFailure.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'consent_required' });
  });

  it('fails closed for a missing score, unsupported instrument version, mapping, or support', async () => {
    const missingScore = setup();
    missingScore.scores.findByAssessmentForOwner.mockResolvedValue(null);
    await expect(missingScore.query().execute(missingScore.assessmentId, missingScore.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'score_unavailable' });

    const incompatibleInstrument = setup();
    incompatibleInstrument.instruments.findAvailableByVersionId.mockResolvedValue(null);
    await expect(incompatibleInstrument.query().execute(incompatibleInstrument.assessmentId, incompatibleInstrument.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'instrument_unavailable' });

    const missingMapping = setup();
    missingMapping.mappings.findFrozen.mockResolvedValue(null);
    await expect(missingMapping.query().execute(missingMapping.assessmentId, missingMapping.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'mapping_unavailable' });

    const noSupport = setup();
    noSupport.supportProvider.getApprovedSupport.mockResolvedValue(null);
    await expect(noSupport.query().execute(noSupport.assessmentId, noSupport.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'interpretation_support_unavailable' });
    expect(noSupport.scores.findByAssessmentForOwner).not.toHaveBeenCalled();

    const unapprovedInstrument = setup();
    unapprovedInstrument.instruments.findAvailableByVersionId.mockResolvedValueOnce({
      ...unapprovedInstrument.instrument,
      status: 'draft',
    });
    await expect(unapprovedInstrument.query().execute(unapprovedInstrument.assessmentId, unapprovedInstrument.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'instrument_unavailable' });
    expect(unapprovedInstrument.supportProvider.getApprovedSupport).not.toHaveBeenCalled();

    const unapprovedSupport = setup();
    unapprovedSupport.supportProvider.getApprovedSupport.mockResolvedValueOnce({ status: 'pending' } as never);
    await expect(unapprovedSupport.query().execute(unapprovedSupport.assessmentId, unapprovedSupport.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'interpretation_support_unavailable' });
    expect(unapprovedSupport.scores.findByAssessmentForOwner).not.toHaveBeenCalled();

    const mismatchedSupport = setup();
    mismatchedSupport.supportProvider.getApprovedSupport.mockResolvedValueOnce({
      ...mismatchedSupport.support,
      support: { ...mismatchedSupport.support.support, instrumentVersionId: randomUUID() },
    });
    await expect(mismatchedSupport.query().execute(mismatchedSupport.assessmentId, mismatchedSupport.accountId))
      .resolves.toMatchObject({ status: 'not_available', reason: 'interpretation_support_unavailable' });
    expect(mismatchedSupport.scores.findByAssessmentForOwner).not.toHaveBeenCalled();
  });

  it('revalidates consent after loading score material and rejects mismatched score ownership/version', async () => {
    const revokedDuringRead = setup();
    revokedDuringRead.consent.getCurrentNoticeVersionId.mockResolvedValueOnce(revokedDuringRead.noticeId).mockResolvedValueOnce(null);
    await expect(revokedDuringRead.query().execute(revokedDuringRead.assessmentId, revokedDuringRead.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'consent_required' });

    const wrongVersion = setup();
    wrongVersion.scores.findByAssessmentForOwner.mockResolvedValueOnce({ ...wrongVersion.score, instrumentVersionId: randomUUID() });
    await expect(wrongVersion.query().execute(wrongVersion.assessmentId, wrongVersion.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'score_invalid' });

    const wrongOwner = setup();
    wrongOwner.scores.findByAssessmentForOwner.mockResolvedValueOnce({ ...wrongOwner.score, accountId: randomUUID() });
    await expect(wrongOwner.query().execute(wrongOwner.assessmentId, wrongOwner.accountId)).resolves.toMatchObject({ status: 'not_available', reason: 'score_invalid' });
  });
});
