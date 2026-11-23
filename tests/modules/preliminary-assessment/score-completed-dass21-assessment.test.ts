import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ScoreCompletedDass21Assessment } from '../../../src/modules/preliminary-assessment/application/internal/command-services/score-completed-dass21-assessment.js';
import { PreliminaryAssessmentError } from '../../../src/modules/preliminary-assessment/domain/model/assessment-errors.js';
import { createDass21AssessmentScore } from '../../../src/modules/preliminary-assessment/domain/model/dass21-assessment-score.js';
import { completeAssessment, createPreliminaryAssessment, recordAssessmentResponse } from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { freezeDass21QuestionMapping } from '../../../src/modules/preliminary-assessment/domain/model/dass21-question-mapping.js';
import { Dass21ScoringError } from '../../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';
import { parseInstrumentVersion, type InstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';
import type { Dass21AssessmentScoreRepository } from '../../../src/modules/preliminary-assessment/domain/repositories/dass21-assessment-score-repository.js';
import type { Dass21QuestionMappingRepository } from '../../../src/modules/preliminary-assessment/domain/repositories/dass21-question-mapping-repository.js';
import type { InstrumentCatalog } from '../../../src/modules/preliminary-assessment/domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentRepository } from '../../../src/modules/preliminary-assessment/domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../../src/modules/preliminary-assessment/application/ports/preliminary-assessment-consent-authorizer.js';

function setup() {
  const accountId = randomUUID();
  const noticeId = randomUUID();
  const instrumentId = randomUUID();
  const instrumentVersionId = randomUUID();
  const questions = Array.from({ length: 21 }, (_, index) => ({ id: randomUUID(), prompt: 'Synthetic numeric item.', responseType: 'number' as const, required: true, minimum: 0, maximum: 3, displayOrder: index + 1 }));
  const instrument: InstrumentVersion = parseInstrumentVersion({
    instrumentId, instrumentVersionId, version: 'synthetic-instrument-v1', effectiveAt: new Date('2026-01-01T00:00:00Z'), status: 'approved', questions,
    approval: { status: 'approved', approvedAt: new Date('2026-01-01T00:00:00Z'), approvalReference: 'synthetic-unit-fixture' },
    license: { status: 'not_applicable', reference: 'synthetic-unit-fixture' },
  });
  const start = new Date('2026-01-02T00:00:00Z');
  let assessment = createPreliminaryAssessment({ assessmentId: randomUUID(), accountId, assessmentType: 'synthetic-only',
    mode: 'structured_instrument', instrumentVersionId, consentNoticeVersionId: noticeId, createdAt: start, startedAt: start });
  questions.forEach((question, index) => {
    const at = new Date(start.getTime() + index + 1);
    assessment = recordAssessmentResponse(assessment, { assessmentId: assessment.assessmentId, instrumentVersionId,
      questionId: question.id, status: 'answered', answer: { type: 'number', value: index % 4 }, createdAt: at, updatedAt: at }, instrument);
  });
  const completedAt = new Date(start.getTime() + 100);
  assessment = completeAssessment(assessment, completedAt, instrument);
  const draftMapping = { schemaVersion: '1.0' as const, mappingId: randomUUID(), instrumentCode: 'DASS-21' as const,
    instrumentId, instrumentVersionId, mappingVersion: 'synthetic-map-v1', status: 'draft' as const, createdAt: start, frozenAt: null,
    entries: questions.map((question, index) => ({ questionId: question.id, itemNumber: index + 1 })) };
  const mapping = freezeDass21QuestionMapping(draftMapping, completedAt);
  const clock = new Date(completedAt.getTime() + 500);
  return { accountId, noticeId, instrument, assessment, mapping, clock };
}

function makeUseCase(fixture: ReturnType<typeof setup>, overrides: {
  noticeResults?: Array<string | null>;
  assessment?: ReturnType<typeof setup>['assessment'] | null;
  instrument?: InstrumentVersion | null;
  mapping?: ReturnType<typeof setup>['mapping'] | null;
  save?: (score: ReturnType<typeof createDass21AssessmentScore>) => Promise<ReturnType<typeof createDass21AssessmentScore>>;
} = {}) {
  const order: string[] = [];
  let noticeIndex = 0;
  const consent: PreliminaryAssessmentConsentAuthorizer = { getCurrentNoticeVersionId: vi.fn(async () => {
    order.push('consent');
    const result = overrides.noticeResults && noticeIndex < overrides.noticeResults.length
      ? overrides.noticeResults[noticeIndex] ?? null
      : fixture.noticeId;
    noticeIndex += 1;
    return result;
  }) };
  const assessments = { findByIdForOwner: vi.fn(async () => { order.push('assessment'); return overrides.assessment === undefined ? fixture.assessment : overrides.assessment; }) } as unknown as PreliminaryAssessmentRepository;
  const instruments = { findAvailableByVersionId: vi.fn(async () => { order.push('instrument'); return overrides.instrument === undefined ? fixture.instrument : overrides.instrument; }) } as unknown as InstrumentCatalog;
  const mappings = { findFrozen: vi.fn(async () => { order.push('mapping'); return overrides.mapping === undefined ? fixture.mapping : overrides.mapping; }) } as unknown as Dass21QuestionMappingRepository;
  const saved: ReturnType<typeof createDass21AssessmentScore>[] = [];
  const scores = { saveForCompletedOwner: vi.fn(async (score: ReturnType<typeof createDass21AssessmentScore>) => {
    order.push('persist');
    if (overrides.save) return overrides.save(score);
    saved.push(score);
    return score;
  }) } as unknown as Dass21AssessmentScoreRepository;
  const service = new ScoreCompletedDass21Assessment(assessments, instruments, mappings, scores, consent, () => fixture.clock);
  return { service, consent, assessments, instruments, mappings, scores, saved, order };
}

describe('ScoreCompletedDass21Assessment', () => {
  it('checks consent, owner, instrument, frozen map, then rechecks authorization before calculation and persistence', async () => {
    const fixture = setup();
    const deps = makeUseCase(fixture);
    const result = await deps.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion });
    expect(deps.order).toEqual(['consent', 'assessment', 'instrument', 'mapping', 'consent', 'persist']);
    expect(deps.scores.saveForCompletedOwner).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ assessmentId: fixture.assessment.assessmentId, accountId: fixture.accountId,
      instrumentVersionId: fixture.instrument.instrumentVersionId, mappingVersion: fixture.mapping.mappingVersion,
      scoringVersion: 'dass21-score-1.0', status: 'calculated' });
    expect(result.dimensions.depression.equivalentScore).toBe(result.dimensions.depression.rawScore * 2);
    expect(result.dimensions.anxiety.equivalentScore).toBe(result.dimensions.anxiety.rawScore * 2);
    expect(result.dimensions.stress.equivalentScore).toBe(result.dimensions.stress.rawScore * 2);
    expect(result).not.toHaveProperty('diagnosis');
    expect(result).not.toHaveProperty('severity');
  });

  it('fails closed on absent, withdrawn, or failing consent and never loads the assessment or persists', async () => {
    const fixture = setup();
    for (const noticeResults of [[null], [fixture.noticeId, null]]) {
      const deps = makeUseCase(fixture, { noticeResults });
      await expect(deps.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
        .rejects.toMatchObject({ code: 'consent_required' });
      expect(deps.scores.saveForCompletedOwner).not.toHaveBeenCalled();
      if (noticeResults.length === 1) expect(deps.assessments.findByIdForOwner).not.toHaveBeenCalled();
    }
    const failed = makeUseCase(fixture);
    vi.mocked(failed.consent.getCurrentNoticeVersionId).mockRejectedValueOnce(new Error('synthetic database failure'));
    await expect(failed.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(failed.scores.saveForCompletedOwner).not.toHaveBeenCalled();
  });

  it('enforces ownership, completion, instrument availability and the explicitly selected map version', async () => {
    const fixture = setup();
    const foreign = makeUseCase(fixture, { assessment: null });
    await expect(foreign.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'assessment_not_found' });
    expect(foreign.instruments.findAvailableByVersionId).not.toHaveBeenCalled();

    const open = makeUseCase(fixture, { assessment: { ...fixture.assessment, status: 'in_progress', completedAt: null } });
    await expect(open.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'responses_incomplete' });

    const unavailable = makeUseCase(fixture, { instrument: null });
    await expect(unavailable.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'instrument_unavailable' });

    const unknownMap = makeUseCase(fixture, { mapping: null });
    await expect(unknownMap.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: 'not-the-configured-map' }))
      .rejects.toMatchObject({ code: 'mapping_not_found' });
    expect(unknownMap.scores.saveForCompletedOwner).not.toHaveBeenCalled();

    const mismatchedMap = makeUseCase(fixture, { mapping: { ...fixture.mapping, instrumentVersionId: randomUUID() } });
    await expect(mismatchedMap.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'instrument_version_mismatch' });
    expect(mismatchedMap.scores.saveForCompletedOwner).not.toHaveBeenCalled();
  });

  it('rejects incomplete, duplicated or incompatible response sets without writing a score', async () => {
    const fixture = setup();
    const incomplete = makeUseCase(fixture, { assessment: { ...fixture.assessment, responses: fixture.assessment.responses.slice(0, 20) } });
    await expect(incomplete.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toBeInstanceOf(Dass21ScoringError);
    expect(incomplete.scores.saveForCompletedOwner).not.toHaveBeenCalled();

    const duplicateResponses = [...fixture.assessment.responses];
    duplicateResponses[20] = { ...duplicateResponses[20]!, questionId: duplicateResponses[0]!.questionId };
    const duplicate = makeUseCase(fixture, { assessment: { ...fixture.assessment, responses: duplicateResponses } });
    await expect(duplicate.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'invalid_answers' });
    expect(duplicate.scores.saveForCompletedOwner).not.toHaveBeenCalled();
  });

  it('rejects malformed commands and preserves typed persistence conflicts', async () => {
    const fixture = setup();
    const invalidIdentity = makeUseCase(fixture);
    await expect(invalidIdentity.service.execute('not-an-account-id', { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'assessment_not_found' });
    await expect(invalidIdentity.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion, accountId: randomUUID() } as never))
      .rejects.toThrow();

    const persistenceFailure = makeUseCase(fixture, { save: async () => { throw new PreliminaryAssessmentError('result_conflict'); } });
    await expect(persistenceFailure.service.execute(fixture.accountId, { assessmentId: fixture.assessment.assessmentId, mappingVersion: fixture.mapping.mappingVersion }))
      .rejects.toMatchObject({ code: 'result_conflict' });
  });
});
