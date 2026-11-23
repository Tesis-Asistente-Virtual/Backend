import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { conversations } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { createMonitoringEnrollment, monitoringConsentPurpose, monitoringContractVersion, startMonitoringSession } from '../../src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';
import { ConsentMonitoringAuthorizer } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/consent-monitoring-authorizer.js';
import { DrizzleMonitoringConversationAssociationRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-conversation-association-repository.js';
import { DrizzleMonitoringEnrollmentRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-enrollment-repository.js';
import { DrizzleMonitoringSessionRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-session-repository.js';
import { monitoringEnrollments, monitoringSessionConversations, monitoringSessions } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/schema.js';
import { createMonitoringRouter } from '../../src/modules/longitudinal-monitoring/interfaces/rest/create-monitoring-router.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { connectTestDatabase } from './test-database.js';
import { grantTestConsent, withdrawTestConsent } from './consent-test-fixtures.js';

type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const jwt = new JwtAccessTokenService('monitoring-conversation-association-test-secret', 'monitoring-association-integration', 'monitoring-test-client', 300);

describe('LongitudinalMonitoring conversation association HTTP/PostgreSQL integration', () => {
  let pool: Pool;
  let db: TestDb;
  let server: Server | undefined;
  let baseUrl: string;
  const accountIds = new Set<string>();

  async function createAccount() {
    const id = randomUUID();
    await db.insert(authAccounts).values({ id, email: `monitor-link-it-${randomUUID()}@example.test`, passwordHash: 'synthetic-integration-hash' });
    accountIds.add(id);
    return { id, token: await jwt.issue(id) };
  }

  async function request(path: string, token?: string, body: unknown = {}, method = 'POST') {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function ownerFixture(ownerId: string) {
    await grantTestConsent(db, ownerId, monitoringConsentPurpose);
    const consent = new DrizzleConsentRepository(db);
    const authorization = await new ConsentMonitoringAuthorizer(consent).getCurrentAuthorization(ownerId);
    if (!authorization) throw new Error('Synthetic integration consent did not authorize owner fixture');
    const enrolledAt = new Date(Math.max(Date.now(), authorization.checkedAt.getTime()));
    const enrollment = await new DrizzleMonitoringEnrollmentRepository(db).createWithCurrentConsent(createMonitoringEnrollment({
      contractVersion: monitoringContractVersion,
      enrollmentId: randomUUID(), accountId: ownerId, consentNoticeVersionId: authorization.noticeVersionId,
      enrolledAt, explicitOptIn: true,
    }, authorization));
    const session = startMonitoringSession(enrollment, randomUUID(), new Date(enrollment.updatedAt.getTime() + 1));
    await new DrizzleMonitoringSessionRepository(db).createWithCurrentConsent(session, enrollment.consentNoticeVersionId);
    const [conversation] = await db.insert(conversations).values({ accountId: ownerId, status: 'active' }).returning({ id: conversations.id });
    if (!conversation) throw new Error('Synthetic conversation fixture was not created');
    return { enrollment, session, conversationId: conversation.id };
  }

async function expectSqlState(operation: Promise<unknown>, expected: string) {
  try { await operation; }
  catch (error) {
    const outer = error as { code?: string; cause?: { code?: string } };
    expect(outer.cause?.code ?? outer.code).toBe(expected);
    return;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expected}`);
}

  const associationPath = (enrollmentId: string, sessionId: string) =>
    `/api/v1/monitoring/enrollments/${enrollmentId}/sessions/${sessionId}/conversation`;

  beforeAll(async () => {
    ({ pool, db } = await connectTestDatabase());
    const app = express();
    app.use(express.json());
    // Test-only scope allowlist: synthetic fixture consent is never an approval for real participants.
    app.use('/api/v1/monitoring', createMonitoringRouter(db, jwt, { isNoticeApprovedForAssociation: async () => true }));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server?.once('listening', resolve);
      server?.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 15_000);

  afterEach(async () => {
    const ids = [...accountIds];
    accountIds.clear();
    if (ids.length) await db.delete(authAccounts).where(inArray(authAccounts.id, ids));
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await pool?.end();
  });

  it('creates only an explicit same-owner metadata link and prevents duplicate/cross-owner links', async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    const own = await ownerFixture(owner.id);
    const foreign = await ownerFixture(stranger.id);
    const path = associationPath(own.enrollment.enrollmentId, own.session.sessionId);

    await expectSqlState(db.insert(monitoringSessionConversations).values({
      id: randomUUID(), enrollmentId: own.enrollment.enrollmentId, monitoringSessionId: own.session.sessionId,
      conversationId: foreign.conversationId, accountId: owner.id,
    }), '23503');

    expect((await request(path, undefined, { conversationId: own.conversationId, explicitAssociation: true })).status).toBe(401);
    const linked = await request(path, owner.token, { conversationId: own.conversationId, explicitAssociation: true });
    expect(linked.status).toBe(201);
    const resource = await linked.json() as Record<string, unknown>;
    expect(Object.keys(resource).sort()).toEqual(['contractVersion', 'conversationId', 'createdAt', 'enrollmentId', 'id', 'monitoringSessionId']);
    expect(resource).toMatchObject({ enrollmentId: own.enrollment.enrollmentId, monitoringSessionId: own.session.sessionId, conversationId: own.conversationId, contractVersion: '1.0' });
    expect(resource).not.toHaveProperty('accountId');
    expect(resource).not.toHaveProperty('content');
    expect(resource).not.toHaveProperty('messages');
    expect(resource).not.toHaveProperty('observations');
    expect(await db.select().from(monitoringSessionConversations).where(eq(monitoringSessionConversations.monitoringSessionId, own.session.sessionId))).toHaveLength(1);

    expect((await request(path, owner.token, { conversationId: foreign.conversationId, explicitAssociation: true })).status).toBe(404);
    expect((await request(path, stranger.token, { conversationId: foreign.conversationId, explicitAssociation: true })).status).toBe(404);
    expect((await request(path, owner.token, { conversationId: own.conversationId, explicitAssociation: true })).status).toBe(409);
    expect((await request(associationPath(own.enrollment.enrollmentId, foreign.session.sessionId), owner.token, { conversationId: own.conversationId, explicitAssociation: true })).status).toBe(404);
    expect((await request(path, owner.token, { conversationId: own.conversationId, explicitAssociation: true, accountId: owner.id })).status).toBe(400);
    expect(await db.select().from(monitoringSessionConversations).where(eq(monitoringSessionConversations.accountId, owner.id))).toHaveLength(1);

    const closeAt = new Date(own.session.updatedAt.getTime() + 1000);
    await db.update(monitoringSessions).set({ status: 'completed', closedAt: closeAt, updatedAt: closeAt, revision: 2 }).where(eq(monitoringSessions.id, own.session.sessionId));
    const nextSession = startMonitoringSession(own.enrollment, randomUUID(), new Date(closeAt.getTime() + 1));
    await new DrizzleMonitoringSessionRepository(db).createWithCurrentConsent(nextSession, own.enrollment.consentNoticeVersionId);
    expect((await request(associationPath(own.enrollment.enrollmentId, nextSession.sessionId), owner.token, { conversationId: own.conversationId, explicitAssociation: true })).status).toBe(409);
    expect(await db.select().from(monitoringSessionConversations).where(eq(monitoringSessionConversations.conversationId, own.conversationId))).toHaveLength(1);
  });

  it('serializes duplicate concurrent association requests to one insert', async () => {
    const owner = await createAccount();
    const fixture = await ownerFixture(owner.id);
    const path = associationPath(fixture.enrollment.enrollmentId, fixture.session.sessionId);
    const body = { conversationId: fixture.conversationId, explicitAssociation: true };
    const responses = await Promise.all([request(path, owner.token, body), request(path, owner.token, body)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(monitoringSessionConversations).where(eq(monitoringSessionConversations.monitoringSessionId, fixture.session.sessionId))).toHaveLength(1);
  });

  it('fails closed after withdrawal and rejects a closed session without inserting a link', async () => {
    const owner = await createAccount();
    const fixture = await ownerFixture(owner.id);
    const closedAt = new Date(fixture.session.updatedAt.getTime() + 1000);
    await db.update(monitoringSessions).set({ status: 'completed', closedAt, updatedAt: closedAt, revision: 2 }).where(eq(monitoringSessions.id, fixture.session.sessionId));
    const closedPath = associationPath(fixture.enrollment.enrollmentId, fixture.session.sessionId);
    expect((await request(closedPath, owner.token, { conversationId: fixture.conversationId, explicitAssociation: true })).status).toBe(409);
    expect(await db.select().from(monitoringSessionConversations).where(eq(monitoringSessionConversations.monitoringSessionId, fixture.session.sessionId))).toHaveLength(0);

    const newSession = startMonitoringSession(fixture.enrollment, randomUUID(), new Date(closedAt.getTime() + 1));
    await new DrizzleMonitoringSessionRepository(db).createWithCurrentConsent(newSession, fixture.enrollment.consentNoticeVersionId);
    await withdrawTestConsent(db, owner.id, monitoringConsentPurpose);
    const newPath = associationPath(fixture.enrollment.enrollmentId, newSession.sessionId);
    expect((await request(newPath, owner.token, { conversationId: fixture.conversationId, explicitAssociation: true })).status).toBe(403);
    expect(await db.select().from(monitoringSessionConversations).where(eq(monitoringSessionConversations.accountId, owner.id))).toHaveLength(0);
  });
});
