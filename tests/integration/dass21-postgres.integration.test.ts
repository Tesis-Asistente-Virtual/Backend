import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, lte } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { accountConsentEvents, consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { assessmentAnswers, assessmentInstrumentQuestions, assessmentInstrumentVersions, assessmentPsychometricScores, assessmentScoringItemMappings, assessmentScoringMappingVersions, preliminaryAssessments } from '../../src/modules/preliminary-assessment/infrastructure/persistence/schema.js';
import { DrizzleDass21QuestionMappingRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-dass21-question-mapping-repository.js';
import { DrizzleDass21AssessmentScoreRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-dass21-assessment-score-repository.js';
import { ScoreCompletedDass21Assessment } from '../../src/modules/preliminary-assessment/application/internal/command-services/score-completed-dass21-assessment.js';
import { DrizzleDass21InternalResultReadUnitOfWork } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-dass21-internal-result-read-unit-of-work.js';
import { ConsentAssessmentAuthorizer } from '../../src/modules/preliminary-assessment/infrastructure/persistence/consent-assessment-authorizer.js';
import { DrizzlePreliminaryAssessmentRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-preliminary-assessment-repository.js';
import { DrizzleAssessmentResponseRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-assessment-response-repository.js';
import { DrizzleAssessmentResultRepository } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-assessment-result-repository.js';
import { DrizzleInstrumentCatalog } from '../../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-instrument-catalog.js';
import { createDass21AssessmentScore } from '../../src/modules/preliminary-assessment/domain/model/dass21-assessment-score.js';
import { isInstrumentAvailable } from '../../src/modules/preliminary-assessment/domain/model/instrument.js';
import { createUnavailableAssessmentResult } from '../../src/modules/preliminary-assessment/domain/model/assessment-result.js';
import { completeAssessment, createPreliminaryAssessment } from '../../src/modules/preliminary-assessment/domain/model/preliminary-assessment.js';
import type { InstrumentVersion } from '../../src/modules/preliminary-assessment/domain/model/instrument.js';
import type { Dass21QuestionMapping } from '../../src/modules/preliminary-assessment/domain/model/dass21-question-mapping.js';
import type { NewInstrumentDraft } from '../../src/modules/preliminary-assessment/domain/repositories/instrument-catalog.js';
import { createPreliminaryAssessmentRouter } from '../../src/modules/preliminary-assessment/interfaces/rest/create-preliminary-assessment-router.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { connectTestDatabase } from './test-database.js';
import { acquirePreliminaryAssessmentNoticeLock } from './preliminary-assessment-notice-lock.js';

type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const fixtureInstrumentId = '00000000-0000-4000-8000-00000000b501';
const fixtureInstrumentVersionId = '00000000-0000-4000-8000-00000000b502';
const fallbackInstrumentVersionId = '00000000-0000-4000-8000-00000000b504';
const fixtureMappingVersion = 'synthetic-map-1';
const fixtureQuestions = Array.from({ length: 21 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${(index + 0xb510).toString(16).padStart(12, '0')}`,
  prompt: `Synthetic numeric integration item ${index + 1}.`, responseType: 'number' as const,
  required: true, minimum: 0, maximum: 3, displayOrder: index + 1,
}));
const testJwt = new JwtAccessTokenService('dass21-postgres-integration-only-secret-with-sufficient-entropy', 'dass21-integration', 'dass21-test-client', 300);

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error && typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause && typeof error.cause.code === 'string') return error.cause.code;
  return undefined;
}

async function expectPostgresCode(operation: Promise<unknown>, code: string): Promise<void> {
  try { await operation; } catch (error) { expect(postgresCode(error)).toBe(code); return; }
  throw new Error(`Expected PostgreSQL SQLSTATE ${code}`);
}

describe('DASS-21 infrastructure PostgreSQL integration (synthetic fixtures only)', () => {
  let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
  let db: TestDb;
  let noticeLock: Awaited<ReturnType<typeof acquirePreliminaryAssessmentNoticeLock>> | undefined;
  let server: Server | undefined;
  let baseUrl: string;
  const accountIds = new Set<string>();
  const draftNoticeIds = new Set<string>();
  const draftMappingIds = new Set<string>();

  async function account(): Promise<string> {
    const id = randomUUID();
    await db.insert(authAccounts).values({ id, email: `dass21-it-${randomUUID()}@example.test`, passwordHash: 'integration-test-only-hash' });
    accountIds.add(id);
    return id;
  }

  async function notice(): Promise<string> {
    const now = new Date();
    const [published] = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, 'preliminary_assessment'), eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, now),
    )).limit(1);
    if (published) return published.id;
    const id = randomUUID();
    const text = 'Synthetic integration notice only; not legal text or production authorization.';
    await db.insert(consentNoticeVersions).values({
      id, purpose: 'preliminary_assessment', version: `it-${randomUUID().slice(0, 16)}`, content: text,
      contentHash: createHash('sha256').update(text).digest('hex'), effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    });
    draftNoticeIds.add(id);
    await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
    draftNoticeIds.delete(id);
    return id;
  }

  async function grant(ownerId: string): Promise<string> {
    const id = await notice();
    const event = await new DrizzleConsentRepository(db).recordDecision(ownerId, 'preliminary_assessment', id, 'granted', randomUUID(), new Date());
    if (!event) throw new Error('Synthetic consent fixture could not be granted');
    await expectCurrentPreliminaryAssessmentConsent(ownerId, id);
    return id;
  }

  async function expectCurrentPreliminaryAssessmentConsent(accountId: string, expectedNoticeVersionId: string): Promise<void> {
    const checkedAt = new Date();
    const currentNotices = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, 'preliminary_assessment'), eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, checkedAt),
    )).limit(2);
    const [latestDecision] = await db.select({
      action: accountConsentEvents.action,
      noticeVersionId: accountConsentEvents.noticeVersionId,
    }).from(accountConsentEvents).where(and(
      eq(accountConsentEvents.accountId, accountId), eq(accountConsentEvents.purpose, 'preliminary_assessment'),
    )).orderBy(desc(accountConsentEvents.sequence)).limit(1);

    expect(currentNotices).toHaveLength(1);
    expect(currentNotices[0]?.id).toBe(expectedNoticeVersionId);
    expect(latestDecision).toMatchObject({ action: 'granted', noticeVersionId: currentNotices[0]?.id });
  }

  async function approvedSyntheticInstrument(): Promise<InstrumentVersion> {
    const catalog = new DrizzleInstrumentCatalog(db);
    const original = await catalog.findVersion(fixtureInstrumentId, fixtureInstrumentVersionId);
    if (original?.status === 'approved' && isInstrumentAvailable(original)) return original;

    // 0007 intentionally leaves historical approved questions without display_order unchanged.
    // Such immutable fixtures cannot be repaired in place, so use a new synthetic version.
    const useFallbackVersion = Boolean(original && original.status !== 'draft');
    const instrumentVersionId = useFallbackVersion ? fallbackInstrumentVersionId : fixtureInstrumentVersionId;
    const version = useFallbackVersion ? 'synthetic-integration-v2' : 'synthetic-integration-v1';
    const found = useFallbackVersion ? await catalog.findVersion(fixtureInstrumentId, fallbackInstrumentVersionId) : original;
    if (found?.status === 'approved' && isInstrumentAvailable(found)) return found;
    if (found && found.status !== 'draft') throw new Error('Reserved synthetic DASS infrastructure fixture is not approved and ordered');
    const draft: NewInstrumentDraft = {
      instrumentId: fixtureInstrumentId, instrumentVersionId,
      version, effectiveAt: new Date(Date.now() - 60_000), status: 'draft', questions: fixtureQuestions,
      approval: { status: 'pending', approvedAt: null, approvalReference: null },
      license: { status: 'not_reviewed', reference: null },
    };
    if (found) await catalog.updateDraft(draft);
    else await catalog.createDraft(draft);
    const approved = await catalog.publishVersion(instrumentVersionId, {
      approval: { status: 'approved', approvedAt: new Date(), approvalReference: 'TEST ONLY: synthetic infrastructure fixture' },
      license: { status: 'not_applicable', reference: 'Synthetic fixture; not an instrument license determination' },
      effectiveAt: draft.effectiveAt,
    });
    if (!approved) throw new Error('Synthetic infrastructure fixture could not be published in test DB');
    return approved;
  }

  async function frozenMapping(instrument: InstrumentVersion): Promise<Dass21QuestionMapping> {
    const repo = new DrizzleDass21QuestionMappingRepository(db);
    const existing = await repo.findFrozen(instrument.instrumentVersionId, fixtureMappingVersion);
    if (existing) return existing;
    const mapping: Dass21QuestionMapping = {
      schemaVersion: '1.0', mappingId: randomUUID(), instrumentCode: 'DASS-21',
      instrumentId: instrument.instrumentId, instrumentVersionId: instrument.instrumentVersionId,
      mappingVersion: fixtureMappingVersion, status: 'draft', createdAt: new Date(Date.now() - 1_000), frozenAt: null,
      entries: fixtureQuestions.map((question, index) => ({ questionId: question.id, itemNumber: index + 1 })),
    };
    await repo.saveDraft(mapping);
    return repo.freeze(mapping.mappingId, instrument.instrumentVersionId, mapping.mappingVersion, new Date());
  }

  async function assessmentWithScore(ownerId: string, noticeId: string, instrument: InstrumentVersion, mapping: Dass21QuestionMapping) {
    // Pinpoint stale or mismatched fixture consent before the repository's transactional guard.
    await expectCurrentPreliminaryAssessmentConsent(ownerId, noticeId);
    const start = new Date();
    const created = createPreliminaryAssessment({ assessmentId: randomUUID(), accountId: ownerId,
      assessmentType: 'synthetic-integration-only', mode: 'structured_instrument', instrumentVersionId: instrument.instrumentVersionId,
      consentNoticeVersionId: noticeId, createdAt: start, startedAt: start });
    const assessments = new DrizzlePreliminaryAssessmentRepository(db);
    await assessments.create(created);
    const responses = new DrizzleAssessmentResponseRepository(db);
    for (const [index, question] of instrument.questions.entries()) {
      const at = new Date(start.getTime() + index + 1);
      await responses.saveForOwner({ assessmentId: created.assessmentId, instrumentVersionId: instrument.instrumentVersionId,
        questionId: question.id, status: 'answered', answer: { type: 'number', value: index % 4 }, createdAt: at, updatedAt: at }, ownerId);
    }
    const withResponses = await assessments.findByIdForOwner(created.assessmentId, ownerId);
    if (!withResponses) throw new Error('Synthetic assessment fixture could not be loaded');
    const completed = completeAssessment(withResponses, new Date(start.getTime() + 30), instrument);
    const publicResult = createUnavailableAssessmentResult(completed.assessmentId, completed.instrumentVersionId, completed.completedAt!);
    const saved = await assessments.completeWithResultForOwner(completed, publicResult, ownerId, withResponses.updatedAt);
    if (!saved) throw new Error('Synthetic assessment fixture could not be completed');
    const score = createDass21AssessmentScore({ assessment: completed, instrument, mapping, calculatedAt: new Date(completed.completedAt!.getTime() + 1) });
    return { completed, score };
  }

  beforeAll(async () => {
    // The only database connection path validates TEST_DATABASE_URL and the live local database identity.
    ({ pool, db } = await connectTestDatabase());
    noticeLock = await acquirePreliminaryAssessmentNoticeLock(pool);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/preliminary-assessments', createPreliminaryAssessmentRouter(db, testJwt));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server?.once('listening', resolve); server?.once('error', reject); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 15_000);

  afterEach(async () => {
    const ids = [...accountIds]; accountIds.clear();
    if (ids.length > 0) await pool.query('DELETE FROM auth_accounts WHERE id = ANY($1::uuid[])', [ids]);
    const drafts = [...draftNoticeIds]; draftNoticeIds.clear();
    if (drafts.length > 0) await pool.query("DELETE FROM consent_notice_versions WHERE id = ANY($1::uuid[]) AND status = 'draft'", [drafts]);
    const mappingIds = [...draftMappingIds]; draftMappingIds.clear();
    if (mappingIds.length > 0) {
      await pool.query('DELETE FROM assessment_scoring_item_mappings WHERE mapping_id = ANY($1::uuid[])', [mappingIds]);
      await pool.query("DELETE FROM assessment_scoring_mapping_versions WHERE mapping_id = ANY($1::uuid[]) AND status = 'draft'", [mappingIds]);
    }
    // Approved synthetic instrument and frozen mapping fixtures are immutable and retained for reuse in tesis_test_db only.
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await noticeLock?.release();
    await pool?.end();
  });

  it('persists and reloads a complete immutable synthetic mapping and enforces its database constraints', async () => {
    const instrument = await approvedSyntheticInstrument();
    expect(isInstrumentAvailable(instrument)).toBe(true);
    expect(instrument.questions.map(question => question.displayOrder)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    const mapping = await frozenMapping(instrument);
    expect(mapping).toMatchObject({ status: 'frozen', mappingVersion: fixtureMappingVersion, instrumentVersionId: instrument.instrumentVersionId });
    expect(mapping.entries).toHaveLength(21);
    expect(mapping.entries.map(entry => entry.itemNumber)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(new Set(mapping.entries.map(entry => entry.questionId)).size).toBe(21);
    await expect(new DrizzleDass21QuestionMappingRepository(db).findFrozen(instrument.instrumentVersionId, fixtureMappingVersion)).resolves.toEqual(mapping);

    await expectPostgresCode(db.insert(assessmentScoringMappingVersions).values({
      mappingId: randomUUID(), instrumentId: instrument.instrumentId, instrumentVersionId: instrument.instrumentVersionId,
      mappingVersion: fixtureMappingVersion, status: 'draft', createdAt: new Date(), frozenAt: null,
    }), '23505');

    const draftMappingId = randomUUID();
    const draftMappingVersion = `draft-${randomUUID().slice(0, 12)}`;
    const draftMap: Dass21QuestionMapping = { ...mapping, mappingId: draftMappingId, mappingVersion: draftMappingVersion,
      status: 'draft', frozenAt: null, createdAt: new Date() };
    await new DrizzleDass21QuestionMappingRepository(db).saveDraft(draftMap);
    draftMappingIds.add(draftMappingId);
    await expectPostgresCode(db.update(assessmentScoringItemMappings).set({ itemNumber: 2 }).where(and(
      eq(assessmentScoringItemMappings.mappingId, draftMappingId), eq(assessmentScoringItemMappings.itemNumber, 1),
    )), '23505');
    await expectPostgresCode(db.update(assessmentScoringMappingVersions).set({ mappingVersion: 'tampered' })
      .where(eq(assessmentScoringMappingVersions.mappingId, mapping.mappingId)), '23514');
    await expectPostgresCode(db.update(assessmentScoringItemMappings).set({ itemNumber: 7 })
      .where(and(eq(assessmentScoringItemMappings.mappingId, mapping.mappingId), eq(assessmentScoringItemMappings.itemNumber, 1))), '23514');

    const invalid = new DrizzleDass21QuestionMappingRepository(db);
    const duplicateId = randomUUID();
    const duplicateMap: Dass21QuestionMapping = { ...mapping, mappingId: duplicateId, mappingVersion: `invalid-${randomUUID().slice(0, 12)}`,
      status: 'draft', frozenAt: null, entries: mapping.entries.map((entry, index) => index === 20 ? { ...entry, itemNumber: 20 } : entry) };
    await expect(invalid.saveDraft(duplicateMap)).rejects.toMatchObject({ code: 'invalid_instrument' });
    const missingMap: Dass21QuestionMapping = { ...duplicateMap, mappingId: randomUUID(), mappingVersion: `missing-${randomUUID().slice(0, 12)}`, entries: mapping.entries.slice(0, 20) };
    await expect(invalid.saveDraft(missingMap)).rejects.toMatchObject({ code: 'invalid_instrument' });
  });

  it('stores only internally authorized completed scores, is idempotent, fails closed, and keeps public /result score-free', async () => {
    const ownerId = await account();
    const strangerId = await account();
    const noticeId = await grant(ownerId);
    const instrument = await approvedSyntheticInstrument();
    const mapping = await frozenMapping(instrument);
    const { completed } = await assessmentWithScore(ownerId, noticeId, instrument, mapping);
    const scores = new DrizzleDass21AssessmentScoreRepository(db);
    const orchestrator = new ScoreCompletedDass21Assessment(
      new DrizzlePreliminaryAssessmentRepository(db), new DrizzleInstrumentCatalog(db),
      new DrizzleDass21QuestionMappingRepository(db), scores,
      new ConsentAssessmentAuthorizer(new DrizzleConsentRepository(db)),
    );
    const score = await orchestrator.execute(ownerId, { assessmentId: completed.assessmentId, mappingVersion: mapping.mappingVersion });
    const repeated = await orchestrator.execute(ownerId, { assessmentId: completed.assessmentId, mappingVersion: mapping.mappingVersion });
    expect(repeated).toEqual(score);
    await expect(orchestrator.execute(ownerId, { assessmentId: completed.assessmentId, mappingVersion: 'incompatible-map-version' }))
      .rejects.toMatchObject({ code: 'mapping_not_found' });
    await expect(scores.saveForCompletedOwner({ ...score, dimensions: {
      ...score.dimensions,
      depression: { rawScore: (score.dimensions.depression.rawScore + 1) % 22,
        equivalentScore: ((score.dimensions.depression.rawScore + 1) % 22) * 2 },
    } }, ownerId)).rejects.toMatchObject({ code: 'result_conflict' });
    const [stored] = await db.select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, completed.assessmentId));
    expect(stored).toMatchObject({ accountId: ownerId, instrumentVersionId: instrument.instrumentVersionId,
      mappingId: mapping.mappingId, mappingVersion: mapping.mappingVersion, scoringVersion: 'dass21-score-1.0', status: 'calculated' });
    expect([stored?.depressionRawScore, stored?.anxietyRawScore, stored?.stressRawScore]).toEqual([
      score.dimensions.depression.rawScore, score.dimensions.anxiety.rawScore, score.dimensions.stress.rawScore,
    ]);
    expect([stored?.depressionEquivalentScore, stored?.anxietyEquivalentScore, stored?.stressEquivalentScore]).toEqual([
      score.dimensions.depression.equivalentScore, score.dimensions.anxiety.equivalentScore, score.dimensions.stress.equivalentScore,
    ]);
    expect(await db.select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, completed.assessmentId))).toHaveLength(1);
    await expectPostgresCode(db.insert(assessmentPsychometricScores).values({
      assessmentId: score.assessmentId, accountId: ownerId, instrumentId: score.instrumentId,
      instrumentVersionId: score.instrumentVersionId, mappingId: score.mappingId, mappingVersion: score.mappingVersion,
      scoringVersion: score.scoringVersion, schemaVersion: score.schemaVersion, status: 'calculated',
      depressionRawScore: score.dimensions.depression.rawScore, depressionEquivalentScore: score.dimensions.depression.equivalentScore,
      anxietyRawScore: score.dimensions.anxiety.rawScore, anxietyEquivalentScore: score.dimensions.anxiety.equivalentScore,
      stressRawScore: score.dimensions.stress.rawScore, stressEquivalentScore: score.dimensions.stress.equivalentScore,
      calculatedAt: score.calculatedAt,
    }), '23505');
    await expect(scores.saveForCompletedOwner(score, strangerId)).rejects.toMatchObject({ code: 'assessment_not_found' });
    await expectPostgresCode(db.insert(assessmentPsychometricScores).values({
      assessmentId: score.assessmentId, accountId: ownerId, instrumentId: score.instrumentId,
      instrumentVersionId: score.instrumentVersionId, mappingId: score.mappingId, mappingVersion: score.mappingVersion,
      scoringVersion: score.scoringVersion, schemaVersion: score.schemaVersion, status: 'calculated',
      depressionRawScore: 22, depressionEquivalentScore: 44,
      anxietyRawScore: score.dimensions.anxiety.rawScore, anxietyEquivalentScore: score.dimensions.anxiety.equivalentScore,
      stressRawScore: score.dimensions.stress.rawScore, stressEquivalentScore: score.dimensions.stress.equivalentScore,
      calculatedAt: score.calculatedAt,
    }), '23514');

    const token = await testJwt.issue(ownerId);
    const response = await fetch(`${baseUrl}/api/v1/preliminary-assessments/${completed.assessmentId}/result`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const publicBody = await response.text();
    expect(publicBody).toContain('not_available');
    for (const forbidden of ['rawScore', 'equivalentScore', 'depressionRawScore', 'mappingVersion', 'scoringVersion']) expect(publicBody).not.toContain(forbidden);

    await new DrizzleConsentRepository(db).recordDecision(ownerId, 'preliminary_assessment', noticeId, 'withdrawn', randomUUID(), new Date());
    await expect(scores.saveForCompletedOwner(score, ownerId)).rejects.toMatchObject({ code: 'consent_required' });

    const deniedOwner = await account();
    await expect(scores.saveForCompletedOwner({ ...score, accountId: deniedOwner }, deniedOwner)).rejects.toMatchObject({ code: 'consent_required' });

    const declinedOwner = await account();
    const currentNotice = await notice();
    await new DrizzleConsentRepository(db).recordDecision(declinedOwner, 'preliminary_assessment', currentNotice, 'declined', randomUUID(), new Date());
    await expect(scores.saveForCompletedOwner({ ...score, accountId: declinedOwner }, declinedOwner)).rejects.toMatchObject({ code: 'consent_required' });

    await grant(deniedOwner);
    const incompleteAt = new Date();
    const [incomplete] = await db.insert(preliminaryAssessments).values({
      accountId: deniedOwner, assessmentType: 'synthetic-integration-only', mode: 'structured_instrument', status: 'in_progress',
      instrumentVersionId: instrument.instrumentVersionId, consentNoticeVersionId: noticeId,
      createdAt: incompleteAt, startedAt: incompleteAt, updatedAt: incompleteAt,
    }).returning({ assessmentId: preliminaryAssessments.assessmentId });
    expect(incomplete).toBeDefined();
    await expectPostgresCode(db.insert(assessmentPsychometricScores).values({
      assessmentId: incomplete!.assessmentId, accountId: deniedOwner, instrumentId: instrument.instrumentId,
      instrumentVersionId: instrument.instrumentVersionId, mappingId: mapping.mappingId, mappingVersion: mapping.mappingVersion,
      scoringVersion: 'dass21-score-1.0', schemaVersion: '1.0', status: 'calculated',
      depressionRawScore: 1, depressionEquivalentScore: 2, anxietyRawScore: 1, anxietyEquivalentScore: 2,
      stressRawScore: 1, stressEquivalentScore: 2, calculatedAt: new Date(),
    }), '23514');
    expect(await db.select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, incomplete!.assessmentId))).toHaveLength(0);
  });

  it('serializes score writing against concurrent consent withdrawal', async () => {
    const ownerId = await account();
    const noticeId = await grant(ownerId);
    const instrument = await approvedSyntheticInstrument();
    const mapping = await frozenMapping(instrument);
    const { completed, score } = await assessmentWithScore(ownerId, noticeId, instrument, mapping);
    const decisions = new DrizzleConsentRepository(db);
    const [writeOutcome, withdrawal] = await Promise.allSettled([
      new DrizzleDass21AssessmentScoreRepository(db).saveForCompletedOwner(score, ownerId),
      decisions.recordDecision(ownerId, 'preliminary_assessment', noticeId, 'withdrawn', randomUUID(), new Date()),
    ]);
    expect(withdrawal.status).toBe('fulfilled');
    if (writeOutcome.status === 'rejected') expect(writeOutcome.reason).toMatchObject({ code: 'consent_required' });
    const [stored] = await db.select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, completed.assessmentId));
    expect(stored === undefined || stored.accountId === ownerId).toBe(true);
    const events = await db.select({ action: accountConsentEvents.action }).from(accountConsentEvents)
      .where(eq(accountConsentEvents.accountId, ownerId)).orderBy(accountConsentEvents.sequence);
    expect(events.at(-1)?.action).toBe('withdrawn');
  });

  it('holds a coherent internal result read ahead of concurrent withdrawal and notice supersession', async () => {
    const ownerId = await account();
    const noticeId = await grant(ownerId);
    const instrument = await approvedSyntheticInstrument();
    const mapping = await frozenMapping(instrument);
    const { completed, score } = await assessmentWithScore(ownerId, noticeId, instrument, mapping);
    await new DrizzleDass21AssessmentScoreRepository(db).saveForCompletedOwner(score, ownerId);

    const readUnit = new DrizzleDass21InternalResultReadUnitOfWork(db);
    const releaseBarriers: Array<() => void> = [];
    const lockRead = () => {
      let signalReadLocks!: () => void;
      let releaseRead!: () => void;
      const readLocksAcquired = new Promise<void>(resolve => { signalReadLocks = resolve; });
      const holdRead = new Promise<void>(resolve => { releaseRead = resolve; });
      releaseBarriers.push(releaseRead);
      const read = readUnit.execute(async session => {
        const lockedNotice = await session.requireCurrentConsentNotice(ownerId, new Date());
        expect(lockedNotice).toBe(noticeId);
        const assessment = await session.findAssessmentForOwner(completed.assessmentId, ownerId);
        expect(assessment?.status).toBe('completed');
        const lockedInstrument = await session.findAvailableInstrumentVersion(instrument.instrumentVersionId, new Date());
        expect(lockedInstrument?.instrumentVersionId).toBe(instrument.instrumentVersionId);
        const lockedScore = await session.findScoreForOwner(completed.assessmentId, ownerId);
        expect(lockedScore?.assessmentId).toBe(completed.assessmentId);
        const lockedMapping = await session.findFrozenMapping(instrument.instrumentVersionId, mapping.mappingVersion, instrument);
        expect(lockedMapping?.mappingId).toBe(mapping.mappingId);
        signalReadLocks();
        await holdRead;
        return 'read_completed_under_locks';
      });
      return { read, readLocksAcquired, releaseRead };
    };

    const replacementContent = 'Synthetic rollback-only notice replacement; not legal text.';
    const replacementId = randomUUID();
    await db.insert(consentNoticeVersions).values({
      id: replacementId, purpose: 'preliminary_assessment', version: `rollback-${randomUUID().slice(0, 12)}`,
      content: replacementContent, contentHash: createHash('sha256').update(replacementContent).digest('hex'),
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    });
    draftNoticeIds.add(replacementId);

    let publisher: import('pg').PoolClient | undefined;
    const pending: Promise<unknown>[] = [];
    const waitForBlockedQuery = async (fragment: string): Promise<void> => {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const observer = noticeLock?.observer;
        if (!observer) throw new Error('DASS-21 integration advisory lock is not held');
        const blocked = await observer.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock' AND query ILIKE $1 LIMIT 1`, [`%${fragment}%`],
        );
        if (blocked.rows.length > 0) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for synthetic ${fragment} lock`);
    };
    try {
      // Keep the two writers in separate phases. If a publisher transaction updates
      // the notice and stays open while this test awaits withdrawal, withdrawal's
      // notice read waits on the publisher while the test waits on withdrawal.
      // Phase 1: withdrawal waits on the account lock, then commits after the read.
      const withdrawalRead = lockRead();
      pending.push(withdrawalRead.read);
      await withdrawalRead.readLocksAcquired;
      const withdrawal = new DrizzleConsentRepository(db).recordDecision(
        ownerId, 'preliminary_assessment', noticeId, 'withdrawn', randomUUID(), new Date(),
      );
      pending.push(withdrawal);
      await waitForBlockedQuery('FOR UPDATE');
      withdrawalRead.releaseRead();
      await expect(withdrawalRead.read).resolves.toBe('read_completed_under_locks');
      await expect(withdrawal).resolves.toMatchObject({ action: 'withdrawn' });
      await expect(readUnit.execute(session => session.requireCurrentConsentNotice(ownerId, new Date())))
        .rejects.toMatchObject({ code: 'consent_required' });

      // Restore consent for a separate, non-overlapping supersession ordering check.
      const renewed = await new DrizzleConsentRepository(db).recordDecision(
        ownerId, 'preliminary_assessment', noticeId, 'granted', randomUUID(), new Date(),
      );
      expect(renewed?.action).toBe('granted');

      // Phase 2: notice replacement waits on the notice lock, then is rolled back after the read.
      const replacementRead = lockRead();
      pending.push(replacementRead.read);
      await replacementRead.readLocksAcquired;
      publisher = await pool.connect();
      await publisher.query('BEGIN');
      const replacementUpdate = publisher.query(
        'UPDATE consent_notice_versions SET status = $1 WHERE id = $2', ['superseded', noticeId],
      );
      pending.push(replacementUpdate);
      await waitForBlockedQuery('UPDATE consent_notice_versions');
      replacementRead.releaseRead();
      await expect(replacementRead.read).resolves.toBe('read_completed_under_locks');
      await replacementUpdate;
      await publisher.query('UPDATE consent_notice_versions SET status = $1 WHERE id = $2', ['published', replacementId]);
      await publisher.query('ROLLBACK');
    } finally {
      // Release every test barrier before waiting for transactions or returning clients.
      // These guards are idempotent so cleanup also works after an assertion failure.
      for (const release of releaseBarriers) release();
      if (publisher) {
        try { await publisher.query('ROLLBACK'); } catch { /* transaction may already have rolled back */ }
        publisher.release();
      }
      await Promise.allSettled(pending);
    }
    const [replacement] = await db.select({ status: consentNoticeVersions.status }).from(consentNoticeVersions)
      .where(eq(consentNoticeVersions.id, replacementId));
    expect(replacement?.status).toBe('draft');
    const [originalNotice] = await db.select({ status: consentNoticeVersions.status }).from(consentNoticeVersions)
      .where(eq(consentNoticeVersions.id, noticeId));
    expect(originalNotice?.status).toBe('published');
    expect(await db.select().from(assessmentPsychometricScores).where(eq(assessmentPsychometricScores.assessmentId, completed.assessmentId))).toHaveLength(1);
  });

  it('rejects a question reference not registered under the mapped instrument version at PostgreSQL FK', async () => {
    const instrument = await approvedSyntheticInstrument();
    const mapId = randomUUID();
    const mapVersion = `draft-${randomUUID().slice(0, 12)}`;
    await db.insert(assessmentScoringMappingVersions).values({ mappingId: mapId, instrumentId: instrument.instrumentId,
      instrumentVersionId: instrument.instrumentVersionId, mappingVersion: mapVersion, status: 'draft', createdAt: new Date(), frozenAt: null });
    draftMappingIds.add(mapId);
    await expectPostgresCode(db.insert(assessmentScoringItemMappings).values({ mappingId: mapId, instrumentId: instrument.instrumentId,
      instrumentVersionId: instrument.instrumentVersionId, questionId: randomUUID(), itemNumber: 1 }), '23503');
  });
});
