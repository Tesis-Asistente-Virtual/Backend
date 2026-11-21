import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PreliminaryAssessmentError } from '../../../src/modules/preliminary-assessment/domain/model/assessment-errors.js';
import { createPreliminaryAssessment } from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { createUnavailableAssessmentResult } from '../../../src/modules/preliminary-assessment/domain/model/assessment-result.js';
import { parseInstrumentVersion, type InstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';
import type { PreliminaryAssessmentRepository } from '../../../src/modules/preliminary-assessment/domain/repositories/preliminary-assessment-repository.js';
import type { AssessmentResponseRepository } from '../../../src/modules/preliminary-assessment/domain/repositories/assessment-response-repository.js';
import type { AssessmentResultRepository } from '../../../src/modules/preliminary-assessment/domain/repositories/assessment-result-repository.js';
import type { InstrumentCatalog } from '../../../src/modules/preliminary-assessment/domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../../src/modules/preliminary-assessment/application/ports/preliminary-assessment-consent-authorizer.js';
import { GetAssessmentInfo } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-assessment-info.js';
import { StartPreliminaryAssessment } from '../../../src/modules/preliminary-assessment/application/internal/command-services/start-preliminary-assessment.js';
import { SubmitAssessmentResponse } from '../../../src/modules/preliminary-assessment/application/internal/command-services/submit-assessment-response.js';
import { ChangeAssessmentState } from '../../../src/modules/preliminary-assessment/application/internal/command-services/change-assessment-state.js';
import { CompletePreliminaryAssessment } from '../../../src/modules/preliminary-assessment/application/internal/command-services/complete-preliminary-assessment.js';
import { GetMyAssessment } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-my-assessment.js';
import { GetMyAssessmentResult } from '../../../src/modules/preliminary-assessment/application/internal/query-services/get-my-assessment-result.js';
import { assessmentIdParamsSchema, assessmentPaginationSchema, startAssessmentBodySchema, submitAssessmentResponseBodySchema } from '../../../src/modules/preliminary-assessment/interfaces/rest/validation/assessment-request-schemas.js';
import { errorHandler } from '../../../src/shared/infrastructure/http/error-handler.js';
import type { Request, Response } from 'express';

const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const noticeId = '550e8400-e29b-41d4-a716-446655440001';
const assessmentId = '550e8400-e29b-41d4-a716-446655440002';
const versionId = '550e8400-e29b-41d4-a716-446655440003';
const questionId = '550e8400-e29b-41d4-a716-446655440004';
const at = new Date('2026-05-01T12:00:00.000Z');

function instrument(overrides: Partial<InstrumentVersion> = {}): InstrumentVersion {
  return parseInstrumentVersion({
    instrumentId: randomUUID(), instrumentVersionId: versionId, version: 'synthetic-1', effectiveAt: new Date('2026-01-01T00:00:00Z'), status: 'approved',
    questions: [{ id: questionId, prompt: 'Synthetic neutral prompt', responseType: 'text', required: true, maxLength: 200 }],
    approval: { status: 'approved', approvedAt: at, approvalReference: 'test-only approval' },
    license: { status: 'authorized', reference: 'test-only license' }, ...overrides,
  });
}

function aggregate(status: 'in_progress' | 'paused' | 'completed' = 'in_progress') {
  const assessment = createPreliminaryAssessment({
    assessmentId, accountId: ownerId, assessmentType: 'synthetic-assessment', mode: 'structured_instrument',
    instrumentVersionId: versionId, consentNoticeVersionId: noticeId, createdAt: at, startedAt: at,
  });
  if (status === 'in_progress') return assessment;
  if (status === 'paused') return { ...assessment, status: 'paused' as const, updatedAt: new Date(at.getTime() + 1000) };
  return { ...assessment, status: 'completed' as const, completedAt: new Date(at.getTime() + 2000), updatedAt: new Date(at.getTime() + 2000) };
}

function harness(options: { consentId?: string | null; selectedInstrument?: InstrumentVersion | null; assessment?: ReturnType<typeof aggregate> | null } = {}) {
  const currentAssessment = options.assessment === undefined ? aggregate() : options.assessment;
  const saved = vi.fn(async () => true);
  const completed = vi.fn(async () => true);
  const assessments: PreliminaryAssessmentRepository = {
    create: vi.fn(async () => undefined),
    findByIdForOwner: vi.fn(async (id: string, accountId: string) => id === assessmentId && accountId === ownerId ? currentAssessment : null),
    saveForOwner: saved,
    completeWithResultForOwner: completed,
    listByOwner: vi.fn(async () => []),
  };
  const responses: AssessmentResponseRepository = {
    saveForOwner: vi.fn(async () => undefined),
    listForAssessmentOwner: vi.fn(async () => []),
  };
  const results: AssessmentResultRepository = {
    saveForCompletedOwner: vi.fn(async () => undefined),
    findByAssessmentForOwner: vi.fn(async () => currentAssessment?.status === 'completed'
      ? createUnavailableAssessmentResult(assessmentId, versionId, currentAssessment.completedAt ?? at)
      : null),
  };
  const selected = options.selectedInstrument === undefined ? instrument() : options.selectedInstrument;
  const instruments: InstrumentCatalog = {
    createDraft: vi.fn(async () => undefined), updateDraft: vi.fn(async () => true),
    publishVersion: vi.fn(async () => selected), findVersion: vi.fn(async () => selected),
    findAvailableByVersionId: vi.fn(async (id: string) => id === versionId ? selected : null),
    listAvailable: vi.fn(async () => selected ? [selected] : []),
  };
  const consent: PreliminaryAssessmentConsentAuthorizer = {
    getCurrentNoticeVersionId: vi.fn(async () => options.consentId === undefined ? noticeId : options.consentId),
  };
  return { assessments, responses, results, instruments, consent, saved, completed, currentAssessment };
}

describe('PreliminaryAssessment application and REST validation', () => {
  it('reports unavailable instruments and never creates an assessment without current consent', async () => {
    const noInstrument = harness({ selectedInstrument: null });
    await expect(new GetAssessmentInfo(noInstrument.instruments, () => at).execute()).resolves.toMatchObject({ assessmentAvailable: false, instruments: [] });
    await expect(new StartPreliminaryAssessment(noInstrument.assessments, noInstrument.instruments, noInstrument.consent, () => at).execute(ownerId, versionId))
      .rejects.toMatchObject({ code: 'instrument_unavailable' });
    expect(noInstrument.assessments.create).not.toHaveBeenCalled();

    const noConsent = harness({ consentId: null });
    await expect(new StartPreliminaryAssessment(noConsent.assessments, noConsent.instruments, noConsent.consent, () => at).execute(ownerId, versionId))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(noConsent.assessments.create).not.toHaveBeenCalled();

    const lookupFailure = harness();
    vi.mocked(lookupFailure.consent.getCurrentNoticeVersionId).mockRejectedValueOnce(new Error('consent storage unavailable'));
    await expect(new StartPreliminaryAssessment(lookupFailure.assessments, lookupFailure.instruments, lookupFailure.consent, () => at).execute(ownerId, versionId)).rejects.toThrow('consent storage unavailable');
    expect(lookupFailure.assessments.create).not.toHaveBeenCalled();
  });

  it('starts with the authenticated owner and the currently authorized notice and approved instrument', async () => {
    const h = harness();
    const started = await new StartPreliminaryAssessment(h.assessments, h.instruments, h.consent, () => at).execute(ownerId, versionId);
    expect(started).toMatchObject({ accountId: ownerId, consentNoticeVersionId: noticeId, instrumentVersionId: versionId, mode: 'structured_instrument', status: 'in_progress' });
    expect(h.assessments.create).toHaveBeenCalledWith(started);
  });

  it('enforces owner-scoped reads and consent before resume or answer writes', async () => {
    const h = harness({ consentId: null, assessment: aggregate('paused') });
    await expect(new GetMyAssessment(h.assessments).execute(assessmentId, randomUUID())).rejects.toMatchObject({ code: 'assessment_not_found' });
    await expect(new ChangeAssessmentState(h.assessments, h.consent, () => at).execute(assessmentId, ownerId, 'resume'))
      .rejects.toMatchObject({ code: 'consent_required' });
    await expect(new SubmitAssessmentResponse(h.assessments, h.responses, h.instruments, h.consent, () => at)
      .execute(assessmentId, ownerId, questionId, { type: 'text', value: 'Synthetic answer' }))
      .rejects.toMatchObject({ code: 'assessment_closed' });
    expect(h.responses.saveForOwner).not.toHaveBeenCalled();

    const inProgressWithoutConsent = harness({ consentId: null });
    await expect(new SubmitAssessmentResponse(inProgressWithoutConsent.assessments, inProgressWithoutConsent.responses, inProgressWithoutConsent.instruments, inProgressWithoutConsent.consent, () => at)
      .execute(assessmentId, ownerId, questionId, { type: 'text', value: 'Synthetic answer' }))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(inProgressWithoutConsent.responses.saveForOwner).not.toHaveBeenCalled();
  });

  it('validates a response against the assigned approved version and delegates an owner-scoped save', async () => {
    const h = harness();
    const result = await new SubmitAssessmentResponse(h.assessments, h.responses, h.instruments, h.consent, () => at)
      .execute(assessmentId, ownerId, questionId, { type: 'text', value: 'Synthetic answer' });
    expect(result).toMatchObject({ assessmentId, instrumentVersionId: versionId, questionId, status: 'answered' });
    expect(h.responses.saveForOwner).toHaveBeenCalledWith(result, ownerId);
    await expect(new SubmitAssessmentResponse(h.assessments, h.responses, h.instruments, h.consent, () => at)
      .execute(assessmentId, randomUUID(), questionId, { type: 'text', value: 'Synthetic answer' }))
      .rejects.toMatchObject({ code: 'assessment_not_found' });
  });

  it('uses optimistic state changes and returns a completed result idempotently', async () => {
    const h = harness();
    const state = await new ChangeAssessmentState(h.assessments, h.consent, () => at).execute(assessmentId, ownerId, 'pause');
    expect(state.status).toBe('paused');
    expect(h.saved).toHaveBeenCalledWith(state, ownerId, at);

    const done = harness({ assessment: aggregate('completed') });
    const completion = await new CompletePreliminaryAssessment(done.assessments, done.results, done.instruments, done.consent, () => at).execute(assessmentId, ownerId);
    expect(completion.assessment.status).toBe('completed');
    expect(completion.result.instrumentScores.status).toBe('not_available');
    expect(done.completed).not.toHaveBeenCalled();
    await expect(new GetMyAssessmentResult(done.assessments, done.results).execute(assessmentId, ownerId)).resolves.toMatchObject({ schemaVersion: '1.0' });

    const incomplete = harness();
    await expect(new CompletePreliminaryAssessment(incomplete.assessments, incomplete.results, incomplete.instruments, incomplete.consent, () => at).execute(assessmentId, ownerId))
      .rejects.toMatchObject({ code: 'responses_incomplete' });
    expect(incomplete.completed).not.toHaveBeenCalled();

    const stale = harness();
    stale.saved.mockResolvedValueOnce(false);
    await expect(new ChangeAssessmentState(stale.assessments, stale.consent, () => at).execute(assessmentId, ownerId, 'pause'))
      .rejects.toMatchObject({ code: 'concurrent_modification' });
  });

  it('rejects unknown request properties, invalid UUIDs and out-of-range pagination', () => {
    expect(() => startAssessmentBodySchema.parse({ instrumentVersionId: versionId, accountId: ownerId })).toThrow();
    expect(() => submitAssessmentResponseBodySchema.parse({ questionId, answer: { type: 'text', value: 'x' }, score: 1 })).toThrow();
    expect(() => assessmentIdParamsSchema.parse({ id: 'not-a-uuid' })).toThrow();
    expect(assessmentPaginationSchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(() => assessmentPaginationSchema.parse({ limit: '100' })).toThrow();
    expect(() => assessmentPaginationSchema.parse({ offset: '1000001' })).toThrow();
    expect(() => assessmentPaginationSchema.parse({ accountId: ownerId })).toThrow();
  });

  it('maps consent and missing assessment errors to safe HTTP statuses', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
    errorHandler(new PreliminaryAssessmentError('consent_required'), {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenLastCalledWith(403);
    errorHandler(new PreliminaryAssessmentError('assessment_not_found'), {} as Request, res, vi.fn());
    expect(res.status).toHaveBeenLastCalledWith(404);
  });
});
