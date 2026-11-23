import { describe, expect, it, vi } from 'vitest';
import type { InstrumentCatalog } from '../../../src/modules/preliminary-assessment/domain/repositories/instrument-catalog.js';
import { isInstrumentAvailable, parseInstrumentVersion } from '../../../src/modules/preliminary-assessment/domain/model/instrument.js';
import { DASS21_SPANISH_CANDIDATE } from '../../../src/modules/preliminary-assessment/domain/model/dass21-spanish-candidate.js';
import {
  createTechnicalTestDass21Draft,
  isTechnicalTestDass21Candidate,
  technicalTestDass21QuestionId,
} from '../../../src/modules/preliminary-assessment/technical-test/dass21-candidate-fixture.js';
import { ensureDass21TechnicalTestDraft } from '../../../src/modules/preliminary-assessment/technical-test/ensure-dass21-technical-test-draft.js';
import { DrizzlePreliminaryAssessmentRepository } from '../../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-preliminary-assessment-repository.js';
import { createPreliminaryAssessment } from '../../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { TECHNICAL_TEST_DASS21_VERSION_ID } from '../../../src/modules/preliminary-assessment/technical-test/dass21-candidate-fixture.js';
import { enableTechnicalTestDraftForVersion } from '../../../src/modules/preliminary-assessment/infrastructure/persistence/technical-test-draft-authorization.js';
import { technicalTestDass21ResultResponseSchema } from '../../../src/modules/preliminary-assessment/technical-test/get-my-technical-test-dass21-result.js';

describe('isolated DASS-21 technical-test candidate', () => {
  it('projects the exact 21-item candidate as a pending, non-approved draft', () => {
    const draft = createTechnicalTestDass21Draft();
    const parsed = parseInstrumentVersion(draft);
    expect(parsed.questions).toHaveLength(21);
    expect(parsed.questions.map(question => question.displayOrder)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(parsed.questions.map(question => question.prompt)).toEqual(DASS21_SPANISH_CANDIDATE.items.map(item => item.promptOriginal));
    expect(parsed.questions.every(question => question.required && question.responseType === 'single_choice')).toBe(true);
    for (const [index, question] of parsed.questions.entries()) {
      if (question.responseType !== 'single_choice') throw new Error('Candidate question must use single_choice');
      expect(question.id).toBe(technicalTestDass21QuestionId(index));
      expect(question.options.map(option => option.scoringValue)).toEqual([0, 1, 2, 3]);
    }
    expect(parsed.status).toBe('draft');
    expect(parsed.approval).toEqual({ status: 'pending', approvedAt: null, approvalReference: null });
    expect(parsed.license).toEqual({ status: 'not_reviewed', reference: null });
  });

  it('accepts only the exact candidate in the technical-test policy, never in the normal catalog', () => {
    const now = new Date();
    const candidate = parseInstrumentVersion(createTechnicalTestDass21Draft(new Date(now.getTime() - 60_000)));
    expect(isTechnicalTestDass21Candidate(candidate, now)).toBe(true);
    expect(isInstrumentAvailable(candidate)).toBe(false);
    expect(isTechnicalTestDass21Candidate(candidate, new Date(now.getTime() - 120_000))).toBe(false);
    expect(isTechnicalTestDass21Candidate({ ...candidate, status: 'approved' }, now)).toBe(false);
    expect(isTechnicalTestDass21Candidate({ ...candidate, instrumentVersionId: '00000000-0000-4000-8000-000000008a93' }, now)).toBe(false);
    const tampered = {
      ...candidate,
      questions: candidate.questions.map((question, index) => index === 0 ? { ...question, prompt: 'tampered synthetic text' } : question),
    };
    expect(isTechnicalTestDass21Candidate(tampered, now)).toBe(false);
  });

  it('seeds an absent draft once and treats repeated preparation as idempotent', async () => {
    let stored = null as ReturnType<typeof parseInstrumentVersion> | null;
    const catalog: InstrumentCatalog = {
      createDraft: vi.fn(async draft => { stored = parseInstrumentVersion(draft); }),
      updateDraft: vi.fn(async () => false),
      publishVersion: vi.fn(async () => null),
      findVersion: vi.fn(async () => stored),
      findAvailableByVersionId: vi.fn(async () => null),
      listAvailable: vi.fn(async () => []),
    };
    await ensureDass21TechnicalTestDraft(catalog);
    await ensureDass21TechnicalTestDraft(catalog);
    expect(catalog.createDraft).toHaveBeenCalledTimes(1);
    expect(stored?.status).toBe('draft');
    expect(stored?.approval.status).toBe('pending');
  });

  it('fails closed on a conflicting version without mutating or publishing it', async () => {
    const conflicting = parseInstrumentVersion({
      ...createTechnicalTestDass21Draft(),
      status: 'approved',
      approval: { status: 'approved', approvedAt: new Date(), approvalReference: 'not a real approval' },
      license: { status: 'not_applicable', reference: 'conflicting fixture' },
    });
    const catalog: InstrumentCatalog = {
      createDraft: vi.fn(async () => undefined),
      updateDraft: vi.fn(async () => false),
      publishVersion: vi.fn(async () => null),
      findVersion: vi.fn(async () => conflicting),
      findAvailableByVersionId: vi.fn(async () => null),
      listAvailable: vi.fn(async () => []),
    };
    await expect(ensureDass21TechnicalTestDraft(catalog)).rejects.toMatchObject({ code: 'instrument_unavailable' });
    expect(catalog.createDraft).not.toHaveBeenCalled();
    expect(catalog.updateDraft).not.toHaveBeenCalled();
    expect(catalog.publishVersion).not.toHaveBeenCalled();
  });

  it('sets the database test capability only for the explicitly configured candidate version', async () => {
    const accountId = '00000000-0000-4000-8000-000000000001';
    const noticeId = '00000000-0000-4000-8000-000000000002';
    const rows = [
      [{ id: accountId }],
      [{ id: noticeId }],
      [{ action: 'granted', noticeVersionId: noticeId }],
    ];
    const execute = vi.fn(async () => ({ rows: [] }));
    const insertValues = vi.fn(async () => undefined);
    const tx = {
      execute,
      select: vi.fn(() => {
        const rowSet = rows.shift() ?? [];
        const query = {
          from: () => query,
          where: () => query,
          for: () => query,
          orderBy: () => query,
          limit: async () => rowSet,
        };
        return query;
      }),
      insert: vi.fn(() => ({ values: insertValues })),
    };
    const db = { transaction: (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
    const repository = new DrizzlePreliminaryAssessmentRepository(db as never, TECHNICAL_TEST_DASS21_VERSION_ID);
    const now = new Date();
    const assessment = createPreliminaryAssessment({
      assessmentId: '00000000-0000-4000-8000-000000000003', accountId,
      assessmentType: 'structured_instrument', mode: 'structured_instrument',
      instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID, consentNoticeVersionId: noticeId,
      createdAt: now, startedAt: now,
    });

    await repository.create(assessment);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it('does not enable the transaction-local database capability for another instrument version', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const tx = { execute };

    await enableTechnicalTestDraftForVersion(tx as never, TECHNICAL_TEST_DASS21_VERSION_ID, '00000000-0000-4000-8000-000000008a93');
    expect(execute).not.toHaveBeenCalled();
    await enableTechnicalTestDraftForVersion(tx as never, TECHNICAL_TEST_DASS21_VERSION_ID, TECHNICAL_TEST_DASS21_VERSION_ID);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('marks technical results as synthetic and never represents professional approval', () => {
    const response = technicalTestDass21ResultResponseSchema.parse({
      technicalTest: { scope: 'synthetic_only', instrumentApprovalStatus: 'not_approved' },
      result: {
        contractVersion: 'dass21-participant-result-1.0', status: 'not_available',
        assessmentId: '00000000-0000-4000-8000-000000000001', reason: 'result_not_available',
        isDiagnostic: false, limitations: ['not_a_diagnosis', 'result_not_available_until_authorized'],
      },
    });
    expect(response.technicalTest.instrumentApprovalStatus).toBe('not_approved');
    expect(() => technicalTestDass21ResultResponseSchema.parse({
      ...response, technicalTest: { scope: 'synthetic_only', instrumentApprovalStatus: 'approved' },
    })).toThrow();
  });
});
