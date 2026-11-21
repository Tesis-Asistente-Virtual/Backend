import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { DrizzleMonitoringEnrollmentRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-enrollment-repository.js';
import { DrizzleMonitoringSessionRepository } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/drizzle-monitoring-session-repository.js';
import { monitoringEnrollments, monitoringSessions } from '../../src/modules/longitudinal-monitoring/infrastructure/persistence/schema.js';
import { createMonitoringRouter } from '../../src/modules/longitudinal-monitoring/interfaces/rest/create-monitoring-router.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { connectTestDatabase } from './test-database.js';

type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const testJwt = new JwtAccessTokenService('longitudinal-monitoring-integration-test-secret-only', 'monitoring-integration', 'monitoring-test-client', 300);

describe('LongitudinalMonitoring HTTP/PostgreSQL integration', () => {
  let pool: Pool;
  let db: TestDb;
  let server: Server | undefined;
  let baseUrl: string;
  const accountIds = new Set<string>();

  async function account(): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    await db.insert(authAccounts).values({ id, email: `monitor-http-it-${randomUUID()}@example.test`, passwordHash: 'integration-test-only-hash' });
    accountIds.add(id);
    return { id, token: await testJwt.issue(id) };
  }

  async function request(path: string, token?: string, method = 'GET', body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    ({ pool, db } = await connectTestDatabase());
    const app = express();
    app.use(express.json());
    app.use('/api/v1/monitoring', createMonitoringRouter(db, testJwt));
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
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await pool?.end();
  });

  it('requires JWT and rejects extra request properties', async () => {
    const owner = await account();
    expect((await request('/api/v1/monitoring/info')).status).toBe(401);
    expect((await request('/api/v1/monitoring/info', 'not-a-valid-jwt')).status).toBe(401);
    expect((await request('/api/v1/monitoring/info', owner.token)).status).toBe(200);
    const invalid = await request('/api/v1/monitoring/enrollments', owner.token, 'POST', { explicitOptIn: true, accountId: randomUUID() });
    expect(invalid.status).toBe(400);
    expect((await request('/api/v1/monitoring/enrollments?accountId=' + owner.id, owner.token)).status).toBe(400);
  });

  it('fails closed without current consent and uses the real consent repository when a published notice exists', async () => {
    const owner = await account();
    const stranger = await account();
    const enrollments = new DrizzleMonitoringEnrollmentRepository(db);
    const sessions = new DrizzleMonitoringSessionRepository(db);
    const consents = new DrizzleConsentRepository(db);

    expect((await request('/api/v1/monitoring/enrollments', owner.token, 'POST', { explicitOptIn: true })).status).toBe(403);
    const notices = await consents.listAvailableNotices(new Date());
    const notice = notices.find(item => item.purpose === 'longitudinal_monitoring');
    if (!notice) {
      expect(await enrollments.listByOwner(owner.id, { limit: 10, offset: 0 })).toEqual([]);
      expect(await db.select().from(monitoringEnrollments).where(eq(monitoringEnrollments.accountId, owner.id))).toEqual([]);
      return;
    }

    const grant = await consents.recordDecision(owner.id, 'longitudinal_monitoring', notice.id, 'granted', randomUUID(), new Date());
    expect(grant?.action).toBe('granted');
    const response = await request('/api/v1/monitoring/enrollments', owner.token, 'POST', { explicitOptIn: true });
    expect(response.status).toBe(201);
    const resource = await response.json() as { id: string; status: string };
    expect(resource.status).toBe('active');
    expect(resource).not.toHaveProperty('accountId');
    expect(resource).not.toHaveProperty('consentNoticeVersionId');
    expect((await request(`/api/v1/monitoring/enrollments/${resource.id}`, stranger.token)).status).toBe(404);
    expect((await request('/api/v1/monitoring/enrollments', owner.token)).status).toBe(200);

    const opened = await request(`/api/v1/monitoring/enrollments/${resource.id}/sessions`, owner.token, 'POST', {});
    expect(opened.status).toBe(201);
    const sessionResource = await opened.json() as { id: string; status: string };
    expect(sessionResource.status).toBe('in_progress');
    expect((await request(`/api/v1/monitoring/enrollments/${resource.id}/sessions`, stranger.token)).status).toBe(404);

    await consents.recordDecision(owner.id, 'longitudinal_monitoring', notice.id, 'withdrawn', randomUUID(), new Date());
    expect((await request(`/api/v1/monitoring/enrollments/${resource.id}/sessions`, owner.token, 'POST', {})).status).toBe(403);
    expect((await db.select().from(monitoringSessions).where(eq(monitoringSessions.enrollmentId, resource.id))).length).toBe(1);
    expect((await request(`/api/v1/monitoring/enrollments/${resource.id}/withdraw`, owner.token, 'POST', {})).status).toBe(200);
    expect(await sessions.findByIdForOwner(sessionResource.id, stranger.id)).toBeNull();
  });
});
