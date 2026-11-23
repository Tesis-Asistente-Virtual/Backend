import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { createConsentRouter } from '../../src/modules/consent/interfaces/rest/create-consent-router.js';
import { assessmentAnswers, assessmentInstrumentVersions, assessmentPsychometricScores, preliminaryAssessments } from '../../src/modules/preliminary-assessment/infrastructure/persistence/schema.js';
import { createPreliminaryAssessmentRouter } from '../../src/modules/preliminary-assessment/interfaces/rest/create-preliminary-assessment-router.js';
import { createTechnicalTestDass21Router } from '../../src/modules/preliminary-assessment/technical-test/create-technical-test-dass21-router.js';
import { DrizzleInstrumentCatalog } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-instrument-catalog.js';
import { ensureDass21TechnicalTestDraft } from '../../src/modules/preliminary-assessment/technical-test/ensure-dass21-technical-test-draft.js';
import { TECHNICAL_TEST_DASS21_VERSION_ID } from '../../src/modules/preliminary-assessment/technical-test/dass21-candidate-fixture.js';
import { connectTestDatabase } from './test-database.js';
import { acquirePreliminaryAssessmentNoticeLock } from './preliminary-assessment-notice-lock.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { DASS21_ITEMS_BY_DIMENSION } from '../../src/modules/preliminary-assessment/domain/model/dass21-scoring.js';

type Connection = Awaited<ReturnType<typeof connectTestDatabase>>;
const jwt = new JwtAccessTokenService('dass21-technical-test-integration-secret-with-sufficient-entropy', 'dass21-technical-test-integration', 'synthetic-test-client', 600);

describe('isolated Spanish DASS-21 technical-test HTTP flow (synthetic accounts only)', () => {
  let connection: Connection | undefined;
  let server: Server | undefined;
  let baseUrl = '';
  let noticeLock: Awaited<ReturnType<typeof acquirePreliminaryAssessmentNoticeLock>> | undefined;
  const accountIds = new Set<string>();
  const fixtureNoticeIds = new Set<string>();

  function db(): Connection['db'] {
    if (!connection) throw new Error('Guarded PostgreSQL test connection is not initialized');
    return connection.db;
  }

  async function createAccount(): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    await db().insert(authAccounts).values({ id, email: `dass21-test-http-${id}@example.test`, passwordHash: 'synthetic-test-only-no-password-login' });
    accountIds.add(id);
    return { id, token: await jwt.issue(id) };
  }

  async function currentTestNotice(): Promise<string> {
    const now = new Date();
    const [current] = await db().select({ id: consentNoticeVersions.id, content: consentNoticeVersions.content }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, 'preliminary_assessment'), eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, now),
    )).orderBy(desc(consentNoticeVersions.effectiveAt)).limit(1);
    if (current) {
      if (!/synthetic|synthetic-only|test notice|solo (?:prueba|demostraci[oó]n)|datos ficticios/i.test(current.content)) throw new Error('Current preliminary assessment notice is not a synthetic test fixture');
      return current.id;
    }

    const id = randomUUID();
    const content = 'SOLO PRUEBA TÉCNICA / NO APROBACIÓN LEGAL / DATOS FICTICIOS. Aviso sintético de integración para verificar el flujo; no autoriza uso con participantes.';
    await db().insert(consentNoticeVersions).values({
      id, purpose: 'preliminary_assessment', version: `test-${randomUUID().slice(0, 16)}`, content,
      contentHash: createHash('sha256').update(content).digest('hex'), effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    });
    fixtureNoticeIds.add(id);
    await db().update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
    fixtureNoticeIds.delete(id);
    return id;
  }

  async function request(path: string, token?: string, method = 'GET', body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function grantConsent(token: string, noticeVersionId: string): Promise<void> {
    const decision = await request('/api/v1/consents/me/decisions', token, 'POST', {
      purpose: 'preliminary_assessment', noticeVersionId, action: 'granted', idempotencyKey: randomUUID(),
    });
    expect(decision.status).toBe(201);
  }

  beforeAll(async () => {
    connection = await connectTestDatabase();
    noticeLock = await acquirePreliminaryAssessmentNoticeLock(connection.pool);
    await ensureDass21TechnicalTestDraft(new DrizzleInstrumentCatalog(db()));
    const app = express();
    app.use(express.json({ limit: '32kb' }));
    app.use('/api/v1/consents', createConsentRouter(db(), jwt));
    app.use('/api/v1/preliminary-assessments', await createTechnicalTestDass21Router(db(), jwt));
    app.use('/normal/api/v1/preliminary-assessments', createPreliminaryAssessmentRouter(db(), jwt));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server?.once('listening', resolve);
      server?.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 20_000);

  afterAll(async () => {
    try {
      if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
      if (!connection) return;
      if (accountIds.size > 0) await db().delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
      // A published synthetic notice is immutable and retained; incomplete drafts are removed only by their exact IDs.
      if (fixtureNoticeIds.size > 0) await db().delete(consentNoticeVersions).where(inArray(consentNoticeVersions.id, [...fixtureNoticeIds]));
      if (noticeLock) await noticeLock.release();
    } finally {
      if (connection) await connection.pool.end();
    }
  }, 20_000);

  it('serves only the exact pending candidate in this test composition and completes a 21-item HTTP assessment', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const unconsented = await createAccount();
    const noticeId = await currentTestNotice();
    const notices = await request('/api/v1/consents/notices');
    expect(notices.status).toBe(200);
    const listedNotices = await notices.json() as Array<{ id: string; purpose: string }>;
    expect(listedNotices).toContainEqual(expect.objectContaining({ id: noticeId, purpose: 'preliminary_assessment' }));
    expect((await request('/api/v1/preliminary-assessments', unconsented.token, 'POST', { instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID })).status).toBe(403);
    await grantConsent(owner.token, noticeId);
    await grantConsent(other.token, noticeId);

    const infoResponse = await request('/api/v1/preliminary-assessments/info', owner.token);
    expect(infoResponse.status).toBe(200);
    const info = await infoResponse.json() as { instruments: Array<{ instrumentVersionId: string; technicalAvailability: string; approvalStatus: string }> };
    expect(info.instruments.map(item => item.instrumentVersionId)).toEqual([TECHNICAL_TEST_DASS21_VERSION_ID]);
    expect(info.instruments[0]).toMatchObject({ technicalAvailability: 'technical_test_only', approvalStatus: 'not_approved' });

    const normalInfoResponse = await request('/normal/api/v1/preliminary-assessments/info', owner.token);
    expect(normalInfoResponse.status).toBe(200);
    const normalInfo = await normalInfoResponse.json() as { instruments: Array<{ instrumentVersionId: string }> };
    expect(normalInfo.instruments.some(item => item.instrumentVersionId === TECHNICAL_TEST_DASS21_VERSION_ID)).toBe(false);
    const normalStart = await request('/normal/api/v1/preliminary-assessments', owner.token, 'POST', { instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID });
    expect(normalStart.status).toBe(409);

    const invalidStart = await request('/api/v1/preliminary-assessments', owner.token, 'POST', { instrumentVersionId: randomUUID() });
    expect(invalidStart.status).toBe(409);
    const start = await request('/api/v1/preliminary-assessments', owner.token, 'POST', { instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID });
    expect(start.status).toBe(201);
    const started = await start.json() as { id: string };
    const formResponse = await request(`/api/v1/preliminary-assessments/${started.id}/form`, owner.token);
    expect(formResponse.status).toBe(200);
    const form = await formResponse.json() as { instrument: {
      instrumentVersionId: string; technicalAvailability: string; candidateVersion: string;
      professionalReviewStatus: string; approvalStatus: string; instructionsOriginal: string;
      referencePeriod: string; questions: Array<{ id: string; displayOrder: number; options: Array<{ id: string; scoringValue?: number }> }>;
    } };
    expect(form.instrument.instrumentVersionId).toBe(TECHNICAL_TEST_DASS21_VERSION_ID);
    expect(form.instrument.technicalAvailability).toBe('technical_test_only');
    expect(form.instrument.candidateVersion).toBe('dass21-spanish-candidate-1.1');
    expect(form.instrument.professionalReviewStatus).toBe('pending');
    expect(form.instrument.approvalStatus).toBe('not_approved');
    expect(form.instrument.instructionsOriginal).toContain('durante la semana pasada');
    expect(form.instrument.referencePeriod).toBe('durante la semana pasada');
    expect(form.instrument.questions).toHaveLength(21);
    expect(form.instrument.questions.map(question => question.displayOrder)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(JSON.stringify(form)).not.toContain('scoringValue');
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/form`, other.token)).status).toBe(404);

    const premature = await request(`/api/v1/preliminary-assessments/${started.id}/complete`, owner.token, 'POST', {});
    expect(premature.status).toBe(409);
    expect(await db().select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, started.id)))
      .toHaveLength(0);
    const incompleteResult = await request(`/api/v1/preliminary-assessments/${started.id}/result`, owner.token);
    expect(incompleteResult.status).toBe(200);
    expect(await incompleteResult.json()).toMatchObject({
      technicalTest: { scope: 'synthetic_only', instrumentApprovalStatus: 'not_approved' },
      result: { status: 'not_available', reason: 'result_not_available' },
    });
    const firstQuestion = form.instrument.questions[0];
    if (!firstQuestion) throw new Error('Technical-test fixture has no first item');
    const [assessmentBeforeInvalid] = await db().select({ updatedAt: preliminaryAssessments.updatedAt })
      .from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, started.id));
    if (!assessmentBeforeInvalid) throw new Error('Technical-test assessment was not persisted');
    const invalidOption = await request(`/api/v1/preliminary-assessments/${started.id}/responses`, owner.token, 'POST', {
      questionId: firstQuestion.id, answer: { type: 'single_choice', optionId: 'not-an-option' },
    });
    expect(invalidOption.status).toBe(400);
    expect(await db().select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, started.id))).toHaveLength(0);
    const [assessmentAfterInvalid] = await db().select({ updatedAt: preliminaryAssessments.updatedAt })
      .from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, started.id));
    expect(assessmentAfterInvalid?.updatedAt).toEqual(assessmentBeforeInvalid.updatedAt);
    const secondQuestion = form.instrument.questions[1];
    const optionFromOtherQuestion = secondQuestion?.options[0];
    if (!secondQuestion || !optionFromOtherQuestion) throw new Error('Technical-test fixture has no second item option');
    // Candidate option IDs are scoped to a question and intentionally reused;
    // this ID also belongs to firstQuestion, so the submitted pair is valid.
    expect(firstQuestion.options.map(option => option.id)).toEqual(secondQuestion.options.map(option => option.id));
    const sharedOption = await request(`/api/v1/preliminary-assessments/${started.id}/responses`, owner.token, 'POST', {
      questionId: firstQuestion.id, answer: { type: 'single_choice', optionId: optionFromOtherQuestion.id },
    });
    expect(sharedOption.status).toBe(200);

    for (const question of form.instrument.questions) {
      const scoringValue = (question.displayOrder - 1) % 4;
      const option = question.options[scoringValue];
      if (!option) throw new Error('Technical-test fixture has no response options');
      const saved = await request(`/api/v1/preliminary-assessments/${started.id}/responses`, owner.token, 'POST', {
        questionId: question.id, answer: { type: 'single_choice', optionId: option.id },
      });
      expect(saved.status).toBe(200);
    }

    const completed = await request(`/api/v1/preliminary-assessments/${started.id}/complete`, owner.token, 'POST', {});
    expect(completed.status).toBe(200);
    expect(await db().select().from(preliminaryAssessments).where(eq(preliminaryAssessments.assessmentId, started.id)))
      .toMatchObject([{ status: 'completed', instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID }]);
    expect(await db().select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, started.id))).toHaveLength(21);

    const expectedRaw = Object.fromEntries(Object.entries(DASS21_ITEMS_BY_DIMENSION).map(([dimension, itemNumbers]) => {
      const rawScore = itemNumbers.reduce((sum, itemNumber) => sum + ((itemNumber - 1) % 4), 0);
      const equivalentScore = rawScore * 2;
      const category = dimension === 'depression' ? 'mild' : dimension === 'anxiety' ? 'extremely_severe' : 'moderate';
      return [dimension, { rawScore, equivalentScore, category }];
    }));
    expect(await db().select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, started.id)))
      .toHaveLength(1);

    const result = await request(`/api/v1/preliminary-assessments/${started.id}/result`, owner.token);
    expect(result.status).toBe(200);
    const payload = await result.json() as { technicalTest: { scope: string; instrumentApprovalStatus: string }; result: {
      contractVersion: string; status: string; assessmentId: string; instrument: { version: string };
      scoringVersion: string; interpretationVersion: string; dimensions: Record<string, { rawScore: number; equivalentScore: number; category: string }>;
      isDiagnostic: boolean; limitations: string[];
    } };
    expect(payload.technicalTest).toEqual({ scope: 'synthetic_only', instrumentApprovalStatus: 'not_approved' });
    expect(payload.result).toMatchObject({
      contractVersion: 'dass21-participant-result-1.0', status: 'available', assessmentId: started.id,
      instrument: { version: 'dass21-spanish-candidate-1.1' }, scoringVersion: 'dass21-score-1.0',
      interpretationVersion: 'dass21-conventional-cutoffs-1.0', dimensions: expectedRaw, isDiagnostic: false,
    });
    expect(Object.keys(payload.result.dimensions).sort()).toEqual(['anxiety', 'depression', 'stress']);
    expect(payload.result).not.toHaveProperty('totalScore');
    expect(payload.result.limitations).toContain('not_a_diagnosis');
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/result`, other.token)).status).toBe(404);

    // Repeating completion retries the idempotent scoring operation without duplicating persisted scores.
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/complete`, owner.token, 'POST', {})).status).toBe(200);
    expect(await db().select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, started.id)))
      .toHaveLength(1);

    const normalResult = await request(`/normal/api/v1/preliminary-assessments/${started.id}/result`, owner.token);
    expect(normalResult.status).toBe(200);
    const normalResultText = await normalResult.text();
    expect(normalResultText).toContain('not_available');
    for (const forbidden of ['rawScore', 'equivalentScore', 'category', 'scoringVersion', 'dimensions']) expect(normalResultText).not.toContain(forbidden);

    const withdrawn = await request('/api/v1/consents/me/decisions', owner.token, 'POST', {
      purpose: 'preliminary_assessment', noticeVersionId: noticeId, action: 'withdrawn', idempotencyKey: randomUUID(),
    });
    expect(withdrawn.status).toBe(201);
    const afterWithdrawal = await request(`/api/v1/preliminary-assessments/${started.id}/result`, owner.token);
    expect(afterWithdrawal.status).toBe(200);
    const withdrawnPayload = await afterWithdrawal.json() as { result: { status: string; reason?: string } };
    expect(withdrawnPayload.result).toMatchObject({ status: 'not_available', reason: 'result_not_available' });
    expect(JSON.stringify(withdrawnPayload)).not.toMatch(/rawScore|equivalentScore|category|scoringVersion/);

    const persisted = await db().select({ status: assessmentInstrumentVersions.status, approvalStatus: assessmentInstrumentVersions.approvalStatus,
      approvedAt: assessmentInstrumentVersions.approvedAt, approvalReference: assessmentInstrumentVersions.approvalReference })
      .from(assessmentInstrumentVersions).where(eq(assessmentInstrumentVersions.instrumentVersionId, TECHNICAL_TEST_DASS21_VERSION_ID));
    expect(persisted).toMatchObject([{ status: 'draft', approvalStatus: 'pending', approvedAt: null, approvalReference: null }]);
  }, 30_000);

  it('denies response writes after explicit consent withdrawal and keeps owner isolation', async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    const noticeId = await currentTestNotice();
    await grantConsent(owner.token, noticeId);
    const start = await request('/api/v1/preliminary-assessments', owner.token, 'POST', { instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID });
    expect(start.status).toBe(201);
    const started = await start.json() as { id: string };
    const formResponse = await request(`/api/v1/preliminary-assessments/${started.id}/form`, owner.token);
    const form = await formResponse.json() as { instrument: { questions: Array<{ id: string; options: Array<{ id: string }> }> } };
    const question = form.instrument.questions[0];
    const option = question?.options[0];
    if (!question || !option) throw new Error('Technical-test fixture response option missing');

    expect((await request(`/api/v1/preliminary-assessments/${started.id}`, stranger.token)).status).toBe(404);
    const withdrawal = await request('/api/v1/consents/me/decisions', owner.token, 'POST', {
      purpose: 'preliminary_assessment', noticeVersionId: noticeId, action: 'withdrawn', idempotencyKey: randomUUID(),
    });
    expect(withdrawal.status).toBe(201);
    const denied = await request(`/api/v1/preliminary-assessments/${started.id}/responses`, owner.token, 'POST', {
      questionId: question.id, answer: { type: 'single_choice', optionId: option.id },
    });
    expect(denied.status).toBe(403);
    expect(await db().select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, started.id))).toHaveLength(0);
  }, 20_000);
});
