import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, lte } from 'drizzle-orm';
import type { PoolClient } from 'pg';
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
import { ChangeAssessmentState } from '../../src/modules/preliminary-assessment/application/internal/command-services/change-assessment-state.js';
import { CompletePreliminaryAssessment } from '../../src/modules/preliminary-assessment/application/internal/command-services/complete-preliminary-assessment.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../src/modules/preliminary-assessment/application/ports/preliminary-assessment-consent-authorizer.js';
import { acquirePreliminaryAssessmentNoticeLock } from './preliminary-assessment-notice-lock.js';

type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const fixtureInstrumentId = '00000000-0000-4000-8000-00000000a531';
const fixtureQuestions = [
  { id: '00000000-0000-4000-8000-00000000a533', prompt: 'Synthetic neutral integration question.', responseType: 'text' as const, required: true, maxLength: 200, displayOrder: 1 },
  { id: '00000000-0000-4000-8000-00000000a535', prompt: 'Synthetic optional integration question.', responseType: 'boolean' as const, required: false, displayOrder: 2 },
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
  let noticeLock: Awaited<ReturnType<typeof acquirePreliminaryAssessmentNoticeLock>> | undefined;
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

  async function insertDraftNotice(): Promise<string> {
    const id = randomUUID();
    const content = 'Synthetic replacement notice for isolated integration testing; not legal text.';
    const [draft] = await db.insert(consentNoticeVersions).values({
      id, purpose: 'preliminary_assessment', version: `test-${randomUUID().slice(0, 16)}`, content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    }).returning({ id: consentNoticeVersions.id });
    if (!draft) throw new Error('Could not create synthetic replacement notice');
    draftNoticeIds.add(id);
    return id;
  }

  async function supersedeNotice(previousNoticeId: string): Promise<string> {
    const replacementId = await insertDraftNotice();
    await db.transaction(async tx => {
      await tx.update(consentNoticeVersions).set({ status: 'superseded' }).where(eq(consentNoticeVersions.id, previousNoticeId));
      await tx.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, replacementId));
    });
    draftNoticeIds.delete(replacementId);
    return replacementId;
  }

  async function waitForBlockedQuery(fragment: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const observer = noticeLock?.observer;
      if (!observer) throw new Error('Preliminary notice advisory lock is not held');
      const result = await observer.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock' AND query ILIKE $1
         LIMIT 1`,
        [`%${fragment}%`],
      );
      if (result.rows.length > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for a database lock involving ${fragment}`);
  }

  function consentAuthorizer(noticeId: string): PreliminaryAssessmentConsentAuthorizer {
    return { getCurrentNoticeVersionId: async () => noticeId };
  }

  async function executeProtectedWrite(operation: 'resume' | 'complete' | 'response', ownerId: string, assessmentId: string, noticeId: string) {
    const repository = new DrizzlePreliminaryAssessmentRepository(db);
    const authorizer = consentAuthorizer(noticeId);
    if (operation === 'resume') {
      return new ChangeAssessmentState(repository, authorizer).execute(assessmentId, ownerId, 'resume');
    }
    if (operation === 'response') {
      const current = await repository.findByIdForOwner(assessmentId, ownerId);
      if (!current?.instrumentVersionId) throw new Error('Synthetic instrument assessment fixture missing');
      const selected = await new DrizzleInstrumentCatalog(db).findAvailableByVersionId(current.instrumentVersionId, new Date());
      const question = selected?.questions[0];
      if (!question) throw new Error('Synthetic fixture question missing');
      const at = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
      return new DrizzleAssessmentResponseRepository(db).saveForOwner({
        assessmentId, instrumentVersionId: current.instrumentVersionId, questionId: question.id,
        status: 'answered', answer: { type: 'text', value: 'Synthetic transactional consent response' }, createdAt: at, updatedAt: at,
      }, ownerId);
    }
    return new CompletePreliminaryAssessment(
      repository,
      new DrizzleAssessmentResultRepository(db),
      new DrizzleInstrumentCatalog(db),
      authorizer,
    ).execute(assessmentId, ownerId);
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
    const versionId = randomUUID();
    const version = `it-${versionNumber}-${randomUUID().slice(0, 12)}`;
    const catalog = new DrizzleInstrumentCatalog(db);
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
    await catalog.createDraft(draft);
    instrumentIds.add(versionId);
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
      questions: [{ id: questionId, prompt: 'Synthetic isolated integration question.', responseType: 'text', required: true, maxLength: 200, displayOrder: 1 }],
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
    noticeLock = await acquirePreliminaryAssessmentNoticeLock(pool);
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
    await noticeLock?.release();
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

  it.each(['resume', 'complete', 'response'] as const)(
    'rejects %s and rolls back when the current consent notice was superseded before transactional revalidation',
    async operation => {
      const ownerId = await account();
      const oldNoticeId = await grantConsent(ownerId);
      const selected = operation === 'response' ? await instrument() : undefined;
      let assessment = await createAssessment(ownerId, oldNoticeId, selected);
      if (operation === 'resume') {
        const current = await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId);
        if (!current) throw new Error('Synthetic assessment fixture missing');
        const paused = pauseAssessment(current, new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)));
        expect(await new DrizzlePreliminaryAssessmentRepository(db).saveForOwner(paused, ownerId, current.updatedAt)).toBe(true);
        assessment = paused;
        expect((await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId))?.status).toBe('paused');
      }
      await supersedeNotice(oldNoticeId);

      await expect(executeProtectedWrite(operation, ownerId, assessment.assessmentId, oldNoticeId))
        .rejects.toMatchObject({ code: 'consent_required' });
      const stored = await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId);
      expect(stored?.status).toBe(operation === 'resume' ? 'paused' : 'in_progress');
      expect(await db.select().from(assessmentResults).where(eq(assessmentResults.assessmentId, assessment.assessmentId))).toHaveLength(0);
      expect(await db.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessment.assessmentId))).toHaveLength(0);
    },
  );

  it.each(['resume', 'complete', 'response'] as const)(
    'orders concurrent %s against notice supersession and denies the stale grant',
    async operation => {
      const ownerId = await account();
      const oldNoticeId = await grantConsent(ownerId);
      const selected = operation === 'response' ? await instrument() : undefined;
      let assessment = await createAssessment(ownerId, oldNoticeId, selected);
      if (operation === 'resume') {
        const current = await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId);
        if (!current) throw new Error('Synthetic assessment fixture missing');
        const paused = pauseAssessment(current, new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)));
        expect(await new DrizzlePreliminaryAssessmentRepository(db).saveForOwner(paused, ownerId, current.updatedAt)).toBe(true);
        assessment = paused;
        expect((await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId))?.status).toBe('paused');
      }
      const publisher = await pool.connect();
      let publisherTransaction = false;
      let pendingWriteOutcome: Promise<unknown> | undefined;
      try {
        await publisher.query('BEGIN');
        publisherTransaction = true;
        await publisher.query('SELECT id FROM consent_notice_versions WHERE id = $1::uuid FOR UPDATE', [oldNoticeId]);

        const pendingWrite = executeProtectedWrite(operation, ownerId, assessment.assessmentId, oldNoticeId);
        const outcome = pendingWrite.then(() => null, error => error as unknown);
        pendingWriteOutcome = outcome;
        await waitForBlockedQuery('consent_notice_versions');

        const replacementId = await insertDraftNotice();
        await publisher.query("UPDATE consent_notice_versions SET status = 'superseded' WHERE id = $1::uuid", [oldNoticeId]);
        await publisher.query("UPDATE consent_notice_versions SET status = 'published' WHERE id = $1::uuid", [replacementId]);
        await publisher.query('COMMIT');
        publisherTransaction = false;
        draftNoticeIds.delete(replacementId);

        await expect(outcome).resolves.toMatchObject({ code: 'consent_required' });
        const stored = await new DrizzlePreliminaryAssessmentRepository(db).findByIdForOwner(assessment.assessmentId, ownerId);
        expect(stored?.status).toBe(operation === 'resume' ? 'paused' : 'in_progress');
        expect(await db.select().from(assessmentResults).where(eq(assessmentResults.assessmentId, assessment.assessmentId))).toHaveLength(0);
        expect(await db.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessment.assessmentId))).toHaveLength(0);
      } finally {
        try {
          if (publisherTransaction) {
            await publisher.query('ROLLBACK');
            publisherTransaction = false;
          }
        } finally {
          publisher.release(publisherTransaction);
          await pendingWriteOutcome;
        }
      }
    },
  );

  it.each(['resume', 'complete', 'response'] as const)(
    'commits %s before a concurrent notice replacement when its notice lock was acquired first',
    async operation => {
      const ownerId = await account();
      const oldNoticeId = await grantConsent(ownerId);
      const selected = operation === 'response' ? await instrument() : undefined;
      const assessment = await createAssessment(ownerId, oldNoticeId, selected);
      const repository = new DrizzlePreliminaryAssessmentRepository(db);
      if (operation === 'resume') {
        const current = await repository.findByIdForOwner(assessment.assessmentId, ownerId);
        if (!current) throw new Error('Synthetic assessment fixture missing');
        const paused = pauseAssessment(current, new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)));
        expect(await repository.saveForOwner(paused, ownerId, current.updatedAt)).toBe(true);
      }

      // Prepare the immutable replacement as a tracked draft before reserving the
      // blocker, publisher, and pending-write connections. Publication still runs
      // concurrently and must wait on the notice lock held by the protected write.
      const replacementId = await insertDraftNotice();
      const assessmentBlocker = await pool.connect();
      let publisher: PoolClient | undefined;
      let blockerActive = false;
      let publisherActive = false;
      let pendingWriteOutcome: Promise<unknown> | undefined;
      let publisherOutcome: Promise<unknown> | undefined;
      try {
        publisher = await pool.connect();
        const publisherClient = publisher;
        await assessmentBlocker.query('BEGIN');
        blockerActive = true;
        await assessmentBlocker.query('SELECT assessment_id FROM preliminary_assessments WHERE assessment_id = $1::uuid FOR UPDATE', [assessment.assessmentId]);

        const pendingWrite = executeProtectedWrite(operation, ownerId, assessment.assessmentId, oldNoticeId);
        const outcome = pendingWrite.then(() => null, error => error as unknown);
        pendingWriteOutcome = outcome;
        await waitForBlockedQuery('preliminary_assessments');

        await publisherClient.query('BEGIN');
        publisherActive = true;
        const publisherWrite = (async () => {
          await publisherClient.query("UPDATE consent_notice_versions SET status = 'superseded' WHERE id = $1::uuid", [oldNoticeId]);
          await publisherClient.query("UPDATE consent_notice_versions SET status = 'published' WHERE id = $1::uuid", [replacementId]);
          await publisherClient.query('COMMIT');
          publisherActive = false;
          if (replacementId) draftNoticeIds.delete(replacementId);
        })();
        publisherOutcome = publisherWrite.then(() => null, error => error as unknown);
        await waitForBlockedQuery('consent_notice_versions');

        await assessmentBlocker.query('COMMIT');
        blockerActive = false;
        await expect(outcome).resolves.toBeNull();
        await expect(publisherOutcome).resolves.toBeNull();

        const stored = await repository.findByIdForOwner(assessment.assessmentId, ownerId);
        expect(stored?.status).toBe(operation === 'complete' ? 'completed' : 'in_progress');
        expect(await db.select().from(assessmentResults).where(eq(assessmentResults.assessmentId, assessment.assessmentId)))
          .toHaveLength(operation === 'complete' ? 1 : 0);
        expect(await db.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessment.assessmentId)))
          .toHaveLength(operation === 'response' ? 1 : 0);
      } finally {
        try {
          if (blockerActive) {
            await assessmentBlocker.query('ROLLBACK');
            blockerActive = false;
          }
        } finally {
          assessmentBlocker.release(blockerActive);
          try {
            if (publisherActive && publisher) {
              await publisher.query('ROLLBACK');
              publisherActive = false;
            }
          } finally {
            publisher?.release(publisherActive);
            await pendingWriteOutcome;
            await publisherOutcome;
          }
        }
      }
    },
  );

  it('enforces unique answers/results, question-version integrity, and immutable approved instruments', async () => {
    const ownerId = await account();
    const noticeId = await grantConsent(ownerId);
    const firstInstrument = await instrument(1);
    const secondInstrument = await isolatedInstrument();
    await expectPostgresCode(pool.query(
      `INSERT INTO assessment_instrument_versions (instrument_version_id, instrument_id, version, effective_at)
       VALUES ($1,$2,$3,now())`,
      [randomUUID(), fixtureInstrumentId, firstInstrument.version],
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
    await expectPostgresCode(pool.query(
      'UPDATE assessment_instrument_questions SET display_order = 2 WHERE instrument_version_id = $1 AND question_id = $2',
      [firstInstrument.instrumentVersionId, question.id],
    ), '23514');
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
    expect(infoBody.instruments.some(item => item.instrumentVersionId === selected.instrumentVersionId)).toBe(true);

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

  it('serves the owner’s exact ordered form and requires an explicit new consent decision before reauthorization', async () => {
    const owner = await account();
    const stranger = await account();
    const token = await testJwt.issue(owner);
    const strangerToken = await testJwt.issue(stranger);
    const selected = await instrument(1);
    const oldNoticeId = await grantConsent(owner);
    const startedResponse = await request('/api/v1/preliminary-assessments', token, 'POST', {
      instrumentVersionId: selected.instrumentVersionId,
    });
    expect(startedResponse.status).toBe(201);
    const started = await startedResponse.json() as { id: string; status: string };

    const initialFormResponse = await request(`/api/v1/preliminary-assessments/${started.id}/form`, token);
    expect(initialFormResponse.status).toBe(200);
    const initialForm = await initialFormResponse.json() as {
      assessment: { id: string; status: string; responses: unknown[] };
      instrument: { instrumentVersionId: string; questions: Array<{ id: string; displayOrder: number }> };
    };
    expect(initialForm.instrument.instrumentVersionId).toBe(selected.instrumentVersionId);
    expect(initialForm.instrument.questions.map(question => question.displayOrder)).toEqual([1, 2]);
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/form`, strangerToken)).status).toBe(404);

    const question = initialForm.instrument.questions[0];
    if (!question) throw new Error('Synthetic ordered form question missing');
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/responses`, token, 'POST', {
      questionId: question.id, answer: { type: 'text', value: 'Synthetic saved form progress' },
    })).status).toBe(200);

    const newNoticeId = await supersedeNotice(oldNoticeId);
    const consentRepository = new DrizzleConsentRepository(db);
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/form`, token)).status).toBe(403);
    const newGrant = await consentRepository.recordDecision(
      owner, 'preliminary_assessment', newNoticeId, 'granted', randomUUID(), new Date(),
    );
    expect(newGrant).toBeTruthy();
    // A new decision alone does not silently rebind an already-open assessment.
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/form`, token)).status).toBe(403);
    const staleList = await request('/api/v1/preliminary-assessments', token);
    const staleListBody = await staleList.json() as { items: Array<{ id: string; responses: unknown[] }> };
    expect(staleListBody.items.find(item => item.id === started.id)?.responses).toEqual([]);
    await expectPostgresCode(pool.query(
      `UPDATE preliminary_assessments SET consent_notice_version_id = $2::uuid, status = 'withdrawn',
       withdrawn_at = now(), updated_at = now() WHERE assessment_id = $1::uuid`,
      [started.id, newNoticeId],
    ), '23514');

    const reauthorizeResponse = await request(`/api/v1/preliminary-assessments/${started.id}/reauthorize`, token, 'POST', {});
    expect(reauthorizeResponse.status).toBe(200);
    expect(await reauthorizeResponse.json()).toMatchObject({ id: started.id, status: 'in_progress' });

    const resumedFormResponse = await request(`/api/v1/preliminary-assessments/${started.id}/form`, token);
    expect(resumedFormResponse.status).toBe(200);
    const resumedForm = await resumedFormResponse.json() as {
      assessment: { id: string; status: string; responses: Array<{ questionId: string; answer: unknown }> };
      instrument: { instrumentVersionId: string; questions: Array<{ id: string; displayOrder: number }> };
    };
    expect(resumedForm.assessment.responses).toHaveLength(1);
    expect(resumedForm.assessment.responses[0]).toMatchObject({
      questionId: question.id, answer: { type: 'text', value: 'Synthetic saved form progress' },
    });
    expect(resumedForm.instrument.instrumentVersionId).toBe(selected.instrumentVersionId);
    expect(JSON.stringify(resumedForm)).not.toMatch(/rawScore|equivalentScore|scoringVersion|dimensions/i);
    expect((await request(`/api/v1/preliminary-assessments/${started.id}/reauthorize`, strangerToken, 'POST', {})).status).toBe(404);
  });

  it('enforces unique question display positions and complete order before publication', async () => {
    const catalog = new DrizzleInstrumentCatalog(db);
    const versionId = randomUUID();
    const draft: NewInstrumentDraft = {
      instrumentId: randomUUID(), instrumentVersionId: versionId, version: `it-${randomUUID().slice(0, 16)}`,
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
      questions: [
        { id: randomUUID(), prompt: 'Synthetic order one.', responseType: 'boolean', required: true, displayOrder: 1 },
        { id: randomUUID(), prompt: 'Synthetic order two.', responseType: 'boolean', required: true, displayOrder: 2 },
      ],
      approval: { status: 'pending', approvedAt: null, approvalReference: null },
      license: { status: 'not_reviewed', reference: null },
    };
    await catalog.createDraft(draft);
    const [questionAtTwo] = await db.select({ questionId: assessmentInstrumentQuestions.questionId })
      .from(assessmentInstrumentQuestions)
      .where(and(eq(assessmentInstrumentQuestions.instrumentVersionId, versionId), eq(assessmentInstrumentQuestions.displayOrder, 2)));
    if (!questionAtTwo) throw new Error('Synthetic ordered draft fixture is missing its second question');
    await expectPostgresCode(pool.query(
      'UPDATE assessment_instrument_questions SET display_order = 1 WHERE instrument_version_id = $1::uuid AND question_id = $2::uuid',
      [versionId, questionAtTwo.questionId],
    ), '23505');

    const missingOrderVersionId = randomUUID();
    const incompleteDraft: NewInstrumentDraft = {
      ...draft, instrumentId: randomUUID(), instrumentVersionId: missingOrderVersionId,
      version: `it-${randomUUID().slice(0, 16)}`,
      questions: [
        { id: randomUUID(), prompt: 'Synthetic ordered item.', responseType: 'boolean', required: true, displayOrder: 1 },
        { id: randomUUID(), prompt: 'Synthetic item whose persisted position will be removed for the trigger test.', responseType: 'boolean', required: true, displayOrder: 2 },
      ],
    };
    await catalog.createDraft(incompleteDraft);
    const questionToMakeUnordered = incompleteDraft.questions[1];
    if (!questionToMakeUnordered) throw new Error('Synthetic second question fixture is missing');
    await db.update(assessmentInstrumentQuestions).set({ displayOrder: null }).where(and(
      eq(assessmentInstrumentQuestions.instrumentVersionId, missingOrderVersionId),
      eq(assessmentInstrumentQuestions.questionId, questionToMakeUnordered.id),
    ));
    await expectPostgresCode(pool.query(
      `UPDATE assessment_instrument_versions SET status = 'approved', approval_status = 'approved',
       approved_at = now(), approval_reference = 'synthetic integration fixture',
       license_status = 'not_applicable', license_reference = 'synthetic fixture only'
       WHERE instrument_version_id = $1::uuid`,
      [missingOrderVersionId],
    ), '23514');
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
