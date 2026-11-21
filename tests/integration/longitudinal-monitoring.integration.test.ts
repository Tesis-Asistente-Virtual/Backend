import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import {
  createMonitoringEnrollment,
  monitoringConsentPurpose,
  monitoringContractVersion,
  pauseMonitoring,
  resumeMonitoring,
  startMonitoringSession,
} from '../../src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';
import { DrizzleMonitoringEnrollmentRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-enrollment-repository.js';
import { DrizzleMonitoringSessionRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-session-repository.js';
import { monitoringEnrollments, monitoringSessions } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/schema.js';
import { MonitoringError } from '../../src/modules/longitudinal-monitoring/domain/model/monitoring-errors.js';
import { ConsentMonitoringAuthorizer } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/consent-monitoring-authorizer.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { ensureTestPublishedNotice, grantTestConsent, withdrawTestConsent } from './consent-test-fixtures.js';
import { connectTestDatabase } from './test-database.js';

const runId = randomUUID();
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const accountIds = new Set<string>();

async function createAccount(): Promise<string> {
  const [account] = await db.insert(authAccounts).values({
    email: `monitor-it-${runId}-${randomUUID()}@example.test`,
    passwordHash: 'integration-test-hash',
  }).returning({ id: authAccounts.id });
  if (!account) throw new Error('Integration fixture account was not created');
  accountIds.add(account.id);
  return account.id;
}

function createEnrollment(accountId: string) {
  const enrolledAt = new Date('2026-01-01T00:00:00.000Z');
  const noticeVersionId = randomUUID();
  return createMonitoringEnrollment({
    contractVersion: monitoringContractVersion,
    enrollmentId: randomUUID(),
    accountId,
    consentNoticeVersionId: noticeVersionId,
    enrolledAt,
    explicitOptIn: true,
  }, {
    purpose: monitoringConsentPurpose,
    state: 'granted',
    noticeVersionId,
    grantedAt: enrolledAt,
    checkedAt: enrolledAt,
  });
}

async function grantAndReadAuthorization(accountId: string) {
  await grantTestConsent(db, accountId, monitoringConsentPurpose);
  const authorization = await new ConsentMonitoringAuthorizer(new DrizzleConsentRepository(db)).getCurrentAuthorization(accountId);
  if (!authorization) throw new Error('Synthetic monitoring consent fixture did not authorize the test account');
  return authorization;
}

function createEnrollmentForAuthorization(accountId: string, authorization: NonNullable<Awaited<ReturnType<typeof grantAndReadAuthorization>>>) {
  const enrolledAt = new Date(Math.max(Date.now(), authorization.checkedAt.getTime()));
  return createMonitoringEnrollment({
    contractVersion: monitoringContractVersion,
    enrollmentId: randomUUID(),
    accountId,
    consentNoticeVersionId: authorization.noticeVersionId,
    enrolledAt,
    explicitOptIn: true,
  }, authorization);
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.cause === 'object' && candidate.cause !== null) {
    const cause = candidate.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return typeof candidate.code === 'string' ? candidate.code : undefined;
}

async function expectSqlState(operation: Promise<unknown>, expected: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(postgresCode(error)).toBe(expected);
    return;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expected}`);
}

beforeAll(async () => { ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (!db || accountIds.size === 0) return;
  await db.delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
  accountIds.clear();
});
afterAll(async () => { if (pool) await pool.end(); });

describe('LongitudinalMonitoring PostgreSQL integration', () => {
  it('persists enrollment metadata and scopes reads and lists to its owner', async () => {
    const ownerId = await createAccount();
    const otherId = await createAccount();
    const repository = new DrizzleMonitoringEnrollmentRepository(db);
    const enrollment = await repository.create(createEnrollment(ownerId));

    expect(enrollment).toMatchObject({ accountId: ownerId, status: 'active', revision: 1 });
    expect(await repository.findByIdForOwner(enrollment.enrollmentId, ownerId)).toEqual(enrollment);
    expect(await repository.findByIdForOwner(enrollment.enrollmentId, otherId)).toBeNull();
    expect(await repository.listByOwner(otherId, { limit: 20, offset: 0 })).toEqual([]);
    expect((await repository.listByOwner(ownerId, { limit: 20, offset: 0 })).map(item => item.enrollmentId)).toEqual([enrollment.enrollmentId]);
  });

  it('serializes state changes through optimistic revision checks', async () => {
    const ownerId = await createAccount();
    const repository = new DrizzleMonitoringEnrollmentRepository(db);
    const active = await repository.create(createEnrollment(ownerId));
    const paused = pauseMonitoring(active, new Date(active.updatedAt.getTime() + 1000));
    const results = await Promise.all([
      repository.saveStatusForOwner(paused, ownerId, active.revision),
      repository.saveStatusForOwner(paused, ownerId, active.revision),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repository.findByIdForOwner(active.enrollmentId, ownerId)).toMatchObject({ status: 'paused', revision: 2 });
  });

  it('creates owner-bound sessions and rejects cross-owner enrollment links in PostgreSQL', async () => {
    const ownerId = await createAccount();
    const otherId = await createAccount();
    const enrollment = await new DrizzleMonitoringEnrollmentRepository(db).create(createEnrollment(ownerId));
    const sessionAt = new Date(enrollment.updatedAt.getTime() + 1000);
    const session = startMonitoringSession(enrollment, randomUUID(), sessionAt);
    const repository = new DrizzleMonitoringSessionRepository(db);
    const stored = await repository.create(session);
    expect(await repository.findByIdForOwner(stored.sessionId, ownerId)).toEqual(stored);
    expect(await repository.findByIdForOwner(stored.sessionId, otherId)).toBeNull();
    expect(await repository.listByEnrollmentForOwner(enrollment.enrollmentId, otherId, { limit: 20, offset: 0 })).toEqual([]);

    await expectSqlState(db.insert(monitoringSessions).values({
      id: randomUUID(), enrollmentId: enrollment.enrollmentId, accountId: otherId,
      status: 'in_progress', contractVersion: '1.0', openedAt: sessionAt,
      updatedAt: sessionAt, closedAt: null, revision: 1,
    }), '23503');
    await expectSqlState(db.insert(monitoringSessions).values({
      id: randomUUID(), enrollmentId: randomUUID(), accountId: ownerId,
      status: 'in_progress', contractVersion: '1.0', openedAt: sessionAt,
      updatedAt: sessionAt, closedAt: null, revision: 1,
    }), '23503');

    const referencedUnique = await pool.query<{ constraint_name: string }>(
      `SELECT conname AS constraint_name FROM pg_constraint
       WHERE conrelid = 'public.monitoring_enrollments'::regclass
         AND contype = 'u' AND conname = 'monitoring_enrollments_id_account_uq'`,
    );
    expect(referencedUnique.rows).toHaveLength(1);
  });

  it('enforces one open enrollment per account and valid status checks', async () => {
    const ownerId = await createAccount();
    const repository = new DrizzleMonitoringEnrollmentRepository(db);
    const existing = await repository.create(createEnrollment(ownerId));

    // The repository deliberately translates PostgreSQL's unique_violation
    // into a stable application error for callers.
    await expect(repository.create(createEnrollment(ownerId)))
      .rejects.toMatchObject({ code: 'enrollment_already_open' });

    // Check the partial UNIQUE index independently, bypassing that translation.
    const duplicateAt = new Date(existing.updatedAt.getTime() + 1000);
    await expectSqlState(db.insert(monitoringEnrollments).values({
      id: randomUUID(), accountId: ownerId, status: 'active', consentPurpose: monitoringConsentPurpose,
      consentNoticeVersionId: randomUUID(), contractVersion: '1.0', consentedAt: duplicateAt,
      enrolledAt: duplicateAt, statusChangedAt: duplicateAt, updatedAt: duplicateAt, revision: 1,
    }), '23505');

    const at = new Date();
    await expectSqlState(db.insert(monitoringEnrollments).values({
      id: randomUUID(), accountId: randomUUID(), status: 'active', consentPurpose: monitoringConsentPurpose,
      consentNoticeVersionId: randomUUID(), contractVersion: '1.0', consentedAt: at,
      enrolledAt: at, statusChangedAt: at, updatedAt: at, revision: 1,
    }), '23503');

    await expectSqlState(db.insert(monitoringEnrollments).values({
      id: randomUUID(), accountId: ownerId, status: 'invalid', consentPurpose: monitoringConsentPurpose,
      consentNoticeVersionId: randomUUID(), contractVersion: '1.0', consentedAt: new Date(),
      enrolledAt: new Date(), statusChangedAt: new Date(), updatedAt: new Date(), revision: 1,
    }), '23514');
  });

  it('fails closed at each transactional write boundary after consent withdrawal', async () => {
    const enrollmentRepository = new DrizzleMonitoringEnrollmentRepository(db);
    const sessionRepository = new DrizzleMonitoringSessionRepository(db);

    const createOwnerId = await createAccount();
    const createAuthorization = await grantAndReadAuthorization(createOwnerId);
    const pendingEnrollment = createEnrollmentForAuthorization(createOwnerId, createAuthorization);
    await withdrawTestConsent(db, createOwnerId, monitoringConsentPurpose);
    await expect(enrollmentRepository.createWithCurrentConsent(pendingEnrollment))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(await db.select().from(monitoringEnrollments).where(eq(monitoringEnrollments.accountId, createOwnerId))).toHaveLength(0);

    const resumeOwnerId = await createAccount();
    const resumeAuthorization = await grantAndReadAuthorization(resumeOwnerId);
    const activeEnrollment = await enrollmentRepository.createWithCurrentConsent(createEnrollmentForAuthorization(resumeOwnerId, resumeAuthorization));
    const paused = pauseMonitoring(activeEnrollment, new Date(activeEnrollment.updatedAt.getTime() + 1000));
    expect(await enrollmentRepository.saveStatusForOwner(paused, resumeOwnerId, activeEnrollment.revision)).toBe(true);
    const resumed = resumeMonitoring(paused, resumeAuthorization, new Date(paused.updatedAt.getTime() + 1000));
    await withdrawTestConsent(db, resumeOwnerId, monitoringConsentPurpose);
    await expect(enrollmentRepository.saveStatusForOwnerWithCurrentConsent(resumed, resumeOwnerId, paused.revision, paused.consentNoticeVersionId))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(await enrollmentRepository.findByIdForOwner(activeEnrollment.enrollmentId, resumeOwnerId)).toMatchObject({ status: 'paused', revision: paused.revision });

    const sessionOwnerId = await createAccount();
    const sessionAuthorization = await grantAndReadAuthorization(sessionOwnerId);
    const sessionEnrollment = await enrollmentRepository.createWithCurrentConsent(createEnrollmentForAuthorization(sessionOwnerId, sessionAuthorization));
    const candidateSession = startMonitoringSession(sessionEnrollment, randomUUID(), new Date(sessionEnrollment.updatedAt.getTime() + 1000));
    await withdrawTestConsent(db, sessionOwnerId, monitoringConsentPurpose);
    await expect(sessionRepository.createWithCurrentConsent(candidateSession, sessionEnrollment.consentNoticeVersionId))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(await db.select().from(monitoringSessions).where(eq(monitoringSessions.enrollmentId, sessionEnrollment.enrollmentId))).toHaveLength(0);
  });

  it('persists enrollment, resume, and session writes while current consent remains granted', async () => {
    const ownerId = await createAccount();
    const authorization = await grantAndReadAuthorization(ownerId);
    const enrollments = new DrizzleMonitoringEnrollmentRepository(db);
    const sessions = new DrizzleMonitoringSessionRepository(db);

    const created = await enrollments.createWithCurrentConsent(createEnrollmentForAuthorization(ownerId, authorization));
    const paused = pauseMonitoring(created, new Date(created.updatedAt.getTime() + 1000));
    expect(await enrollments.saveStatusForOwner(paused, ownerId, created.revision)).toBe(true);
    const resumed = resumeMonitoring(paused, authorization, new Date(paused.updatedAt.getTime() + 1000));
    expect(await enrollments.saveStatusForOwnerWithCurrentConsent(resumed, ownerId, paused.revision, paused.consentNoticeVersionId)).toBe(true);

    const session = startMonitoringSession(resumed, randomUUID(), new Date(resumed.updatedAt.getTime() + 1000));
    await expect(sessions.createWithCurrentConsent(session, resumed.consentNoticeVersionId)).resolves.toMatchObject({
      sessionId: session.sessionId, enrollmentId: resumed.enrollmentId, accountId: ownerId, status: 'in_progress',
    });
    expect(await enrollments.findByIdForOwner(created.enrollmentId, ownerId)).toMatchObject({ status: 'active', revision: resumed.revision });
  });

  it.each(['create enrollment', 'resume enrollment', 'create session'] as const)(
    'serializes a concurrent withdrawal against %s with a valid before-or-after outcome', async (operation) => {
      const ownerId = await createAccount();
      const authorization = await grantAndReadAuthorization(ownerId);
      const enrollments = new DrizzleMonitoringEnrollmentRepository(db);
      const sessions = new DrizzleMonitoringSessionRepository(db);
      const notice = await ensureTestPublishedNotice(db, monitoringConsentPurpose);
      let write: Promise<unknown>;
      let readOutcome: () => Promise<{ enrollmentCount: number; sessionCount: number; status?: string }>;

      if (operation === 'create enrollment') {
        const candidate = createEnrollmentForAuthorization(ownerId, authorization);
        write = enrollments.createWithCurrentConsent(candidate);
        readOutcome = async () => ({
          enrollmentCount: (await db.select().from(monitoringEnrollments).where(eq(monitoringEnrollments.accountId, ownerId))).length,
          sessionCount: 0,
        });
      } else {
        const enrollment = await enrollments.createWithCurrentConsent(createEnrollmentForAuthorization(ownerId, authorization));
        if (operation === 'resume enrollment') {
          const paused = pauseMonitoring(enrollment, new Date(enrollment.updatedAt.getTime() + 1000));
          expect(await enrollments.saveStatusForOwner(paused, ownerId, enrollment.revision)).toBe(true);
          const resumed = resumeMonitoring(paused, authorization, new Date(paused.updatedAt.getTime() + 1000));
          write = enrollments.saveStatusForOwnerWithCurrentConsent(resumed, ownerId, paused.revision, paused.consentNoticeVersionId);
          readOutcome = async () => ({
            enrollmentCount: 1,
            sessionCount: 0,
            status: (await enrollments.findByIdForOwner(enrollment.enrollmentId, ownerId))?.status,
          });
        } else {
          const session = startMonitoringSession(enrollment, randomUUID(), new Date(enrollment.updatedAt.getTime() + 1000));
          write = sessions.createWithCurrentConsent(session, enrollment.consentNoticeVersionId);
          readOutcome = async () => ({
            enrollmentCount: 1,
            sessionCount: (await db.select().from(monitoringSessions).where(eq(monitoringSessions.enrollmentId, enrollment.enrollmentId))).length,
          });
        }
      }

      const [writeResult, withdrawalResult] = await Promise.allSettled([
        write,
        new DrizzleConsentRepository(db).recordDecision(ownerId, monitoringConsentPurpose, notice.id, 'withdrawn', randomUUID(), new Date()),
      ]);
      expect(withdrawalResult.status).toBe('fulfilled');
      const state = await readOutcome();
      expect((await new DrizzleConsentRepository(db).getStatus(ownerId, new Date()))
        .find(item => item.purpose === monitoringConsentPurpose)?.state).toBe('withdrawn');

      if (writeResult.status === 'rejected') {
        expect(writeResult.reason).toBeInstanceOf(MonitoringError);
        expect(writeResult.reason).toMatchObject({ code: 'consent_required' });
        if (operation === 'create enrollment') expect(state.enrollmentCount).toBe(0);
        if (operation === 'resume enrollment') expect(state.status).toBe('paused');
        if (operation === 'create session') expect(state.sessionCount).toBe(0);
      } else {
        // A successful write holds/obtains the account lock first and is ordered before withdrawal.
        if (operation === 'create enrollment') expect(state.enrollmentCount).toBe(1);
        if (operation === 'resume enrollment') expect(state.status).toBe('active');
        if (operation === 'create session') expect(state.sessionCount).toBe(1);
      }
    },
  );

  it('rejects terminal-state reopening and invalid session transitions at the database boundary', async () => {
    const ownerId = await createAccount();
    const enrollment = await new DrizzleMonitoringEnrollmentRepository(db).create(createEnrollment(ownerId));
    const later = new Date(enrollment.updatedAt.getTime() + 1000);
    await db.update(monitoringEnrollments).set({ status: 'withdrawn', statusChangedAt: later, updatedAt: later, revision: 2 })
      .where(eq(monitoringEnrollments.id, enrollment.enrollmentId));
    await expectSqlState(db.update(monitoringEnrollments).set({ status: 'active', statusChangedAt: new Date(later.getTime() + 1000), updatedAt: new Date(later.getTime() + 1000), revision: 3 })
      .where(eq(monitoringEnrollments.id, enrollment.enrollmentId)), '23514');

    const secondOwner = await createAccount();
    const active = await new DrizzleMonitoringEnrollmentRepository(db).create(createEnrollment(secondOwner));
    const session = startMonitoringSession(active, randomUUID(), new Date(active.updatedAt.getTime() + 1000));
    const stored = await new DrizzleMonitoringSessionRepository(db).create(session);
    const closedAt = new Date(stored.updatedAt.getTime() + 1000);
    await db.update(monitoringSessions).set({ status: 'completed', closedAt, updatedAt: closedAt, revision: 2 })
      .where(eq(monitoringSessions.id, stored.sessionId));
    await expectSqlState(db.update(monitoringSessions).set({ status: 'in_progress', closedAt: null, updatedAt: new Date(closedAt.getTime() + 1000), revision: 3 })
      .where(eq(monitoringSessions.id, stored.sessionId)), '23514');
  });
});
