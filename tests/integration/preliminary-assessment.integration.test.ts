import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, lte } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { assessmentAnswers, assessmentInstrumentQuestions, assessmentInstrumentVersions, assessmentResults, preliminaryAssessments } from '../../src/modules/preliminary-assessment/infrastructure/persistence/schema.js';
import { DrizzlePreliminaryAssessmentRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-preliminary-assessment-repository.js';
import { DrizzleInstrumentCatalog } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-instrument-catalog.js';
import { DrizzleAssessmentResponseRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-assessment-response-repository.js';
import { DrizzleAssessmentResultRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-assessment-result-repository.js';
import { completeAssessment, createPreliminaryAssessment, pauseAssessment } from '../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import { createUnavailableAssessmentResult } from '../../src/modules/preliminary-assessment/domain/model/assessment-result.js';
import type { InstrumentVersion } from '../../src/modules/preliminary-assessment/domain/model/instrument.js';
import type { NewInstrumentDraft } from '../../src/modules/preliminary-assessment/domain/repositories/instrument-catalog.js';
import { connectTestDatabase } from './test-database.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { createPreliminaryAssessmentRouter } from '../../src/modules/preliminary-assessment/interfaces/rest/create-preliminary-assessment-router.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';

type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const fixtureInstrumentId = '00000000-0000-4000-8000-00000000a531';
const fixtureQuestions = [
  { id: '00000000-0000-4000-8000-00000000a533', prompt: 'Synthetic neutral integration question.', responseType: 'text' as const, required: true, maxLength: 200 },
  { id: '00000000-0000-4000-8000-00000000a535', prompt: 'Synthetic optional integration question.', responseType: 'boolean' as const, required: false },
];
const testJwt = new JwtAccessTokenService('preliminary-assessment-integration-only-secret-with-sufficient-entropy', 'assessment-integration', 'assessment-test-client', 300);

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error && typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause && typeof error.cause.code === 'string') return error.cause.code;
  return undefined;
}

async function expectPostgresCode(operation: Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(postgresCode(error)).toBe(expectedCode);
    return;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expectedCode}`);
}

describe('PreliminaryAssessment PostgreSQL integration', () => {
  let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
  let db: TestDb;
  let server: Server | undefined;
  let baseUrl: string;
  const accountIds = new Set<string>();
  const draftNoticeIds = new Set<string>();
  const instrumentIds = new Set<string>();

  async function account(): Promise<string> {
    const id = randomUUID();
    await db.insert(authAccounts).values({ id, email: `assessment-it-${randomUUID()}@example.test`, passwordHash: 'integration-test-only-hash' });
    accountIds.add(id);
    return id;
  }

  async function consentNotice(): Promise<string> {
    const now = new Date();
    const [existing] = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, 'preliminary_assessment'),
      eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, now),
    )).limit(1);
    if (existing) return existing.id;
    const id = randomUUID();
    const content = 'Integration-only synthetic notice; not legal text and not valid for production.';
    const [draft] = await db.insert(consentNoticeVersions).values({
      id, purpose: 'preliminary_assessment', version: `test-${randomUUID().slice(0, 16)}`, content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    }).returning({ id: consentNoticeVersions.id });
    if (!draft) throw new Error('Could not create test consent notice');
    draftNoticeIds.add(id);
    await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
    draftNoticeIds.delete(id);
    return id;
  }

  async function grantConsent(accountId: string): Promise<string> {
    const noticeId = await consentNotice();
    const event = await new DrizzleConsentRepository(db).recordDecision(
      accountId, 'preliminary_assessment', noticeId, 'granted', randomUUID(), new Date(),
    );
    if (!event) throw new Error('Could not record test consent');
    return noticeId;
  }

  async function instrument(versionNumber: 1 | 2 = 1): Promise<InstrumentVersion> {
    const versionId = versionNumber === 1 ? '00000000-0000-4000-8000-00000000a532' : '00000000-0000-4000-8000-00000000a534';
    const version = `integration-v${versionNumber}`;
    const catalog = new DrizzleInstrumentCatalog(db);
    const existing = await catalog.findVersion(fixtureInstrumentId, versionId);
    if (existing?.status === 'approved') return existing;
    if (existing?.status === 'retired') throw new Error('Synthetic integration instrument fixture has been retired');
    const draft: NewInstrumentDraft = {
      instrumentId: fixtureInstrumentId,
      instrumentVersionId: versionId,
      version,
      effectiveAt: new Date(Date.now() - 60_000),
      status: 'draft' as const,
      questions: fixtureQuestions,
      approval: { status: 'pending', approvedAt: null, approvalReference: null },
      license: { status: 'not_reviewed', reference: null },
    };
    if (existing) await catalog.updateDraft(draft);
    else {
      await catalog.createDraft(draft);
      instrumentIds.add(versionId);
    }
    const published = await catalog.publishVersion(versionId, {
      approval: { status: 'approved', approvedAt: new Date(), approvalReference: 'integration-test-only-approval' },
      license: { status: 'not_applicable', reference: 'synthetic fixture only' },
      effectiveAt: new Date(Date.now() - 60_000),
    });
    if (!published) throw new Error('Could not publish synthetic test instrument');
    return published;
  }

  async function isolatedInstrument(): Promise<InstrumentVersion> {
    const instrumentId = randomUUID();
    const instrumentVersionId = randomUUID();
    const questionId = randomUUID();
    const catalog = new DrizzleInstrumentCatalog(db);
    const draft: NewInstrumentDraft = {
      instrumentId,
      instrumentVersionId,
      version: `it-${randomUUID().slice(0, 16)}`,
      effectiveAt: new Date(Date.now() - 60_000),
      status: 'draft',
      questions: [{ id: questionId, prompt: 'Synthetic isolated integration question.', responseType: 'text', required: true, maxLength: 200 }],
      approval: { status: 'pending', approvedAt: null, approvalReference: null },
      license: { status: 'not_reviewed', reference: null },
    };
    await catalog.createDraft(draft);
    instrumentIds.add(instrumentVersionId);
    const published = await catalog.publishVersion(instrumentVersionId, {
      approval: { status: 'approved', approvedAt: new Date(), approvalReference: 'integration-test-only-approval' },
      license: { status: 'not_applicable', reference: 'synthetic fixture only' },
      effectiveAt: draft.effectiveAt,
    });
    if (!published) throw new Error('Could not publish isolated synthetic test instrument');
    return published;
  }

  async function createAssessment(ownerId: string, consentNoticeVersionId: string, selectedInstrument?: InstrumentVersion) {
    const now = new Date();
    const aggregate = createPreliminaryAssessment({
      assessmentId: randomUUID(), accountId: ownerId, assessmentType: 'synthetic-integration-check',
      mode: selectedInstrument ? 'structured_instrument' : 'conversational_contextual',
      instrumentVersionId: selectedInstrument?.instrumentVersionId ?? null,
      consentNoticeVersionId, createdAt: now, startedAt: now,
    });
    await new DrizzlePreliminaryAssessmentRepository(db).create(aggregate);
    return aggregate;
  }

  async function request(path: string, token?: string, method = 'GET', body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    // This guarded helper is the only connection path; it accepts only local tesis_test_db.
    ({ pool, db } = await connectTestDatabase());
    const app = express();
    app.use(express.json());
    app.use('/api/v1/preliminary-assessments', createPreliminaryAssessmentRouter(db, testJwt));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server?.once('listening', resolve);
      server?.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 15_000);

  afterEach(async () => {
    const ids = [...accountIds];
    accountIds.clear();
    if (ids.length > 0) await pool.query('DELETE FROM auth_accounts WHERE id = ANY($1::uuid[])', [ids]);
    const drafts = [...draftNoticeIds];
    draftNoticeIds.clear();
    if (drafts.length > 0) await pool.query("DELETE FROM consent_notice_versions WHERE id = ANY($1::uuid[]) AND status = 'draft'", [drafts]);
    // Approved synthetic instruments are immutable and intentionally retained for reuse in tesis_test_db.
    instrumentIds.clear();
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await pool?.end();
  });

  it('persists an assessment and enforces owner-scoped retrieval and listing', async () => {
    const ownerId = await account();
    const strangerId = await account();
    const noticeId = await grantConsent(ownerId);
    const assessment = await createAssessment(ownerId, noticeId);
    const repository = new DrizzlePreliminaryAssessmentRepository(db);

    await expect(repository.findByIdForOwner(assessment.assessmentId, ownerId)).resolves.toMatchObject({
      assessmentId: assessment.assessmentId, accountId: ownerId, status: 'in_progress', consentNoticeVersionId: noticeId,
    });
    await expect(repository.findByIdForOwner(assessment.assessmentId, strangerId)).resolves.toBeNull();
    expect((await repository.listByOwner(strangerId, 10, 0)).map(item => item.assessmentId)).not.toContain(assessment.assessmentId);
    const [stored] = await db.select().from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, assessment.assessmentId));
    expect(stored).toMatchObject({ accountId: ownerId, status: 'in_progress', mode: 'conversational_contextual', instrumentVersionId: null });
  });

  it('stores and edits one validated answer against its exact approved instrument version', async () => {
    const ownerId = await account();
    const noticeId = await grantConsent(ownerId);
    const selectedInstrument = await instrument();
    const assessment = await createAssessment(ownerId, noticeId, selectedInstrument);
    const question = selectedInstrument.questions[0];
    if (!question) throw new Error('Synthetic fixture question missing');
    const createdAt = new Date();
    const first = {
      assessmentId: assessment.assessmentId, instrumentVersionId: selectedInstrument.instrumentVersionId,
      questionId: question.id, status: 'answered' as const,
      answer: { type: 'text' as const, value: 'Synthetic answer one' }, createdAt, updatedAt: createdAt,
    };
    const repository = new DrizzleAssessmentResponseRepository(db);
    await repository.saveForOwner(first, ownerId);
    const edited = { ...first, answer: { type: 'text' as const, value: 'Synthetic answer edited' }, updatedAt: new Date(createdAt.getTime() + 1000) };
    await repository.saveForOwner(edited, ownerId);

    const rows = await repository.listForAssessmentOwner(assessment.assessmentId, ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'answered', answer: edited.answer, createdAt, updatedAt: edited.updatedAt });
    expect(await repository.listForAssessmentOwner(assessment.assessmentId, randomUUID())).toEqual([]);
    const [persisted] = await db.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessment.assessmentId));
    expect(persisted?.instrumentVersionId).toBe(selectedInstrument.instrumentVersionId);
  });

  it('finalizes status and creates exactly one unavailable result atomically under concurrent requests', async () => {
    const ownerId = await account();
    const noticeId = await grantConsent(ownerId);
    const assessment = await createAssessment(ownerId, noticeId);
    const finishedAt = new Date(Date.now() + 1000);
    const completed = completeAssessment(assessment, finishedAt);
    const result = createUnavailableAssessmentResult(assessment.assessmentId, null, finishedAt);
    const repository = new DrizzlePreliminaryAssessmentRepository(db);
    const expectedUpdatedAt = assessment.updatedAt;

    const outcomes = await Promise.all([
      repository.completeWithResultForOwner(completed, result, ownerId, expectedUpdatedAt),
      repository.completeWithResultForOwner(completed, result, ownerId, expectedUpdatedAt),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const [storedAssessment] = await db.select().from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, assessment.assessmentId));
    const storedResults = await db.select().from(assessmentResults).where(eq(assessmentResults.assessmentId, assessment.assessmentId));
    expect(storedAssessment?.status).toBe('completed');
    expect(storedResults).toHaveLength(1);
    expect(storedResults[0]).toMatchObject({
      instrumentScores: { status: 'not_available' }, interpretation: { status: 'not_available' },
      attentionPriority: { status: 'not_available' }, safetyState: { status: 'not_available', reason: 'not_assessed' },
    });
    const resultsRepository = new DrizzleAssessmentResultRepository(db);
    await expect(resultsRepository.findByAssessmentForOwner(assessment.assessmentId, ownerId)).resolves.toMatchObject({ assessmentId: assessment.assessmentId });
    await expect(resultsRepository.findByAssessmentForOwner(assessment.assessmentId, randomUUID())).resolves.toBeNull();
    await expect(resultsRepository.saveForCompletedOwner(result, ownerId)).resolves.toBeUndefined();
  });

  it('uses optimistic concurrency so only one concurrent state change wins', async () => {
    const ownerId = await account();
    const noticeId = await grantConsent(ownerId);
    const assessment = await createAssessment(ownerId, noticeId);
    const repository = new DrizzlePreliminaryAssessmentRepository(db);
    const paused = pauseAssessment(assessment, new Date(Date.now() + 1000));
    const expected = assessment.updatedAt;
    const results = await Promise.all([
      repository.saveForOwner(paused, ownerId, expected),
      repository.saveForOwner(paused, ownerId, expected),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repository.findByIdForOwner(assessment.assessmentId, ownerId)).toMatchObject({ status: 'paused' });
  });

  it('enforces unique answers/results, question-version integrity, and immutable approved instruments', async () => {
    const ownerId = await account();
    const noticeId = await grantConsent(ownerId);
    const firstInstrument = await instrument(1);
    const secondInstrument = await isolatedInstrument();
    await expectPostgresCode(pool.query(
      `INSERT INTO assessment_instrument_versions (instrument_version_id, instrument_id, version, effective_at)
       VALUES ($1,$2,'integration-v1',now())`,
      [randomUUID(), fixtureInstrumentId],
    ), '23505');
    const assessment = await createAssessment(ownerId, noticeId, firstInstrument);
    const question = firstInstrument.questions[0];
    const otherQuestion = secondInstrument.questions[0];
    if (!question || !otherQuestion) throw new Error('Synthetic fixture question missing');
    const at = new Date();
    const answerValues = {
      assessmentId: assessment.assessmentId, instrumentVersionId: firstInstrument.instrumentVersionId,
      questionId: question.id, status: 'answered', answer: { type: 'text', value: 'Synthetic answer' }, createdAt: at, updatedAt: at,
    };
    const responses = new DrizzleAssessmentResponseRepository(db);
    await responses.saveForOwner({ ...answerValues, status: 'answered', answer: { type: 'text', value: 'Synthetic answer' } }, ownerId);

    await expectPostgresCode(pool.query(
      'INSERT INTO assessment_answers (assessment_id, instrument_version_id, question_id, status, answer) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [assessment.assessmentId, firstInstrument.instrumentVersionId, question.id, 'answered', JSON.stringify({ type: 'text', value: 'duplicate' })],
    ), '23505');
    await expectPostgresCode(pool.query(
      'INSERT INTO assessment_answers (assessment_id, instrument_version_id, question_id, status, answer) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [assessment.assessmentId, secondInstrument.instrumentVersionId, otherQuestion.id, 'answered', JSON.stringify({ type: 'text', value: 'wrong version' })],
    ), '23503');
    await expectPostgresCode(pool.query(
      'INSERT INTO assessment_answers (assessment_id, instrument_version_id, question_id, status, answer) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [assessment.assessmentId, firstInstrument.instrumentVersionId, randomUUID(), 'answered', JSON.stringify({ type: 'text', value: 'unknown question' })],
    ), '23503');

    const updatedAssessment = await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId);
    if (!updatedAssessment) throw new Error('Assessment fixture disappeared');
    const completed = completeAssessment(updatedAssessment, new Date(Date.now() + 2000), firstInstrument);
    const result = createUnavailableAssessmentResult(assessment.assessmentId, firstInstrument.instrumentVersionId, completed.completedAt!);
    await new DrizzlePreliminaryAssessmentRepository(db).completeWithResultForOwner(completed, result, ownerId, updatedAssessment.updatedAt);
    await expectPostgresCode(pool.query(
      `INSERT INTO assessment_results (assessment_id, instrument_version_id, schema_version, instrument_scores, interpretation, attention_priority, safety_state)
       VALUES ($1,$2,'1.0',$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb)`,
      [assessment.assessmentId, firstInstrument.instrumentVersionId, JSON.stringify(result.instrumentScores), JSON.stringify(result.interpretation), JSON.stringify(result.attentionPriority), JSON.stringify(result.safetyState)],
    ), '23505');

    await expectPostgresCode(pool.query('UPDATE assessment_instrument_versions SET version = $2 WHERE instrument_version_id = $1', [firstInstrument.instrumentVersionId, 'tampered']), '23514');
    await expectPostgresCode(pool.query('UPDATE assessment_instrument_questions SET definition = $3::jsonb WHERE instrument_version_id = $1 AND question_id = $2', [
      firstInstrument.instrumentVersionId, question.id, JSON.stringify({ ...question, prompt: 'tampered fixture' }),
    ]), '23514');
  });

  it('rejects starting without current explicit consent and cascades only the owned test account data', async () => {
    const ownerId = await account();
    const assessmentId = randomUUID();
    const now = new Date();
    const unconsented = createPreliminaryAssessment({
      assessmentId, accountId: ownerId, assessmentType: 'synthetic-integration-check', mode: 'conversational_contextual',
      consentNoticeVersionId: randomUUID(), createdAt: now, startedAt: now,
    });
    await expect(new DrizzlePreliminaryAssessmentRepository(db).create(unconsented)).rejects.toMatchObject({ code: 'consent_required' });
    expect(await db.select().from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, assessmentId))).toHaveLength(0);
    const noticeId = await grantConsent(ownerId);
    const ownedAssessment = await createAssessment(ownerId, noticeId);
    await pool.query('DELETE FROM auth_accounts WHERE id = $1::uuid', [ownerId]);
    expect(await db.select().from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, ownedAssessment.assessmentId))).toHaveLength(0);
  });

  it('serves the authenticated assessment lifecycle over HTTP with owner isolation and unavailable-only results', async () => {
    const owner = await account();
    const other = await account();
    const token = await testJwt.issue(owner);
    const otherToken = await testJwt.issue(other);
    const selected = await instrument(1);
    expect((await request('/api/v1/preliminary-assessments/info')).status).toBe(401);
    const info = await request('/api/v1/preliminary-assessments/info', token);
    expect(info.status).toBe(200);
    const infoBody = await info.json() as { assessmentAvailable: boolean; instruments: Array<{ instrumentVersionId: string }> };
    expect(infoBody.assessmentAvailable).toBe(true);
    expect(infoBody.instruments.some(item => item.instrumentVersionId === '00000000-0000-4000-8000-00000000a532')).toBe(true);

    const noticeId = await grantConsent(owner);
    const invalidStart = await request('/api/v1/preliminary-assessments', token, 'POST', { instrumentVersionId: selected.instrumentVersionId, accountId: other });
    expect(invalidStart.status).toBe(400);
    const unavailable = await request('/api/v1/preliminary-assessments', token, 'POST', { instrumentVersionId: randomUUID() });
    expect(unavailable.status).toBe(409);

    const startedResponse = await request('/api/v1/preliminary-assessments', token, 'POST', { instrumentVersionId: selected.instrumentVersionId });
    expect(startedResponse.status).toBe(201);
    const started = await startedResponse.json() as { id: string; status: string; responses: Array<unknown> };
    expect(started).toMatchObject({ status: 'in_progress', responses: [] });
    const foreignRead = await request(`/api/v1/preliminary-assessments/${started.id}`, otherToken);
    expect(foreignRead.status).toBe(404);
    expect((await request(`/api/v1/preliminary-assessments/${started.id}`, token)).status).toBe(200);

    const question = selected.questions[0];
    if (!question) throw new Error('Synthetic fixture question missing');
    const answer = await request(`/api/v1/preliminary-assessments/${started.id}/responses`, token, 'POST', {
      questionId: question.id, answer: { type: 'text', value: 'Synthetic integration response' },
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ status: 'answered', questionId: question.id });
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/pause`, token, 'POST', {})).status).toBe(200);
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/resume`, token, 'POST', {})).status).toBe(200);

    const completed = await request(`/api/v1/preliminary-assessments/${started.id}/complete`, token, 'POST', {});
    expect(completed.status).toBe(200);
    const completedBody = await completed.json() as { assessment: { status: string }; result: { instrumentScores: { status: string }; attentionPriority: { status: string }; safetyState: { reason: string } } };
    expect(completedBody).toMatchObject({ assessment: { status: 'completed' }, result: {
      instrumentScores: { status: 'not_available' }, attentionPriority: { status: 'not_available' }, safetyState: { status: 'not_available', reason: 'not_assessed' },
    } });
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/complete`, token, 'POST', {})).status).toBe(200);
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/result`, token)).status).toBe(200);
    expect((await request('/api/v1/preliminary-assessments?limit=1', token)).status).toBe(200);
    expect(await db.select().from(accountConsentEvents).where(eq(accountConsentEvents.accountId, owner))).toHaveLength(1);
    expect(noticeId).toBeTruthy();
  });

  it('fails closed when consent is absent or withdrawn and creates no answer after withdrawal', async () => {
    const owner = await account();
    const token = await testJwt.issue(owner);
    const selected = await instrument(1);
    expect((await request('/api/v1/preliminary-assessments', token, 'POST', { instrumentVersionId: selected.instrumentVersionId })).status).toBe(403);
    const noticeId = await grantConsent(owner);
    const started = await request('/api/v1/preliminary-assessments', token, 'POST', { instrumentVersionId: selected.instrumentVersionId });
    expect(started.status).toBe(201);
    const body = await started.json() as { id: string };
    await new DrizzleConsentRepository(db).recordDecision(owner, 'preliminary_assessment', noticeId, 'withdrawn', randomUUID(), new Date());
    const question = selected.questions[0];
    if (!question) throw new Error('Synthetic fixture question missing');
    expect((await request(`/api/v1/preliminary-assessments/${body.id}/responses`, token, 'POST', {
      questionId: question.id, answer: { type: 'text', value: 'Synthetic withheld response' },
    })).status).toBe(403);
    expect(await db.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, body.id))).toHaveLength(0);
    expect((await request(`/api/v1/preliminary-assessments/${body.id}/resume`, token, 'POST', {})).status).toBe(403);
  });
});
