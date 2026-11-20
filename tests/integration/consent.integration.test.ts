import { randomUUID, createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, lte } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { ConsentPurpose } from '../../src/modules/consent/domain/model/consent.js';
import { ConsentIdempotencyConflict } from '../../src/modules/consent/domain/model/consent-errors.js';
import { GetMyConsentStatus } from '../../src/modules/consent/application/internal/query-services/get-my-consent-status.js';
import { ListAvailableConsentNotices } from '../../src/modules/consent/application/internal/query-services/list-available-consent-notices.js';
import { RecordMyConsentDecision } from '../../src/modules/consent/application/internal/command-services/record-my-consent-decision.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { accountConsentEvents, consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { ConsentController } from '../../src/modules/consent/interfaces/rest/resources/consent-controller.js';
import { authenticationMiddleware } from '../../src/shared/infrastructure/http/authentication-middleware.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { connectTestDatabase } from './test-database.js';

const testJwt = new JwtAccessTokenService('integration-test-only-secret-with-sufficient-entropy', 'consent-integration', 'consent-integration-client', 300);
describe('Consent & Privacy PostgreSQL integration', () => {
  let pool: Pool;
  let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
  let server: Server;
  let baseUrl: string;
  const accountIds = new Set<string>();
  const draftNoticeIds = new Set<string>();
  const repository = () => new DrizzleConsentRepository(db);

  async function createAccount(): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    const email = `consent-it-${randomUUID()}@example.test`;
    await db.insert(authAccounts).values({ id, email, passwordHash: 'integration-test-only-hash' });
    accountIds.add(id);
    return { id, token: await testJwt.issue(id) };
  }

  async function ensurePublishedNotice(purpose: ConsentPurpose) {
    const now = new Date();
    const [current] = await db.select().from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now),
    )).limit(1);
    if (current) return current;

    // Published notices are immutable and cannot be deleted. These clearly marked fixtures are
    // created only in the guarded tesis_test_db and reused by later integration runs.
    const id = randomUUID();
    const content = `Integration-test fixture for ${purpose}; not legal text and not valid for production.`;
    const contentHash = createHash('sha256').update(content).digest('hex');
    const [draft] = await db.insert(consentNoticeVersions).values({
      id, purpose, version: `test-${randomUUID().slice(0, 16)}`, content, contentHash,
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    }).returning();
    draftNoticeIds.add(id);
    await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
    draftNoticeIds.delete(id);
    return { ...draft, status: 'published' as const };
  }

  async function jsonRequest(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  beforeAll(async () => {
    // This is the only database connection path used by this suite. It rejects every target
    // except a locally verified tesis_test_db and never falls back to DATABASE_URL.
    ({ pool, db } = await connectTestDatabase());
    const repo = repository();
    const controller = new ConsentController(
      new ListAvailableConsentNotices(repo), new GetMyConsentStatus(repo), new RecordMyConsentDecision(repo),
    );
    const app = express();
    app.use(express.json());
    app.get('/api/v1/consents/notices', (req, res, next) => { void controller.listNotices(req, res).catch(next); });
    app.get('/api/v1/consents/me', authenticationMiddleware(testJwt), (req, res, next) => { void controller.myStatus(req, res).catch(next); });
    app.post('/api/v1/consents/me/decisions', authenticationMiddleware(testJwt), (req, res, next) => { void controller.decideForMe(req, res).catch(next); });
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 15_000);

  afterEach(async () => {
    const ids = [...accountIds];
    accountIds.clear();
    if (ids.length > 0) await pool.query('DELETE FROM auth_accounts WHERE id = ANY($1::uuid[])', [ids]);
    const draftIds = [...draftNoticeIds];
    draftNoticeIds.clear();
    if (draftIds.length > 0) await pool.query("DELETE FROM consent_notice_versions WHERE id = ANY($1::uuid[]) AND status = 'draft'", [draftIds]);
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool?.end();
  });

  it('persists grant, decline and withdrawal as history and derives the latest state', async () => {
    const account = await createAccount();
    const notice = await ensurePublishedNotice('ai_conversation_processing');
    const service = new RecordMyConsentDecision(repository());
    const base = { purpose: 'ai_conversation_processing' as const, noticeVersionId: notice.id };

    const grant = await service.execute(account.id, { ...base, action: 'granted', idempotencyKey: randomUUID() });
    expect((await repository().getStatus(account.id, new Date())).find(item => item.purpose === base.purpose)?.state).toBe('granted');
    const decline = await service.execute(account.id, { ...base, action: 'declined', idempotencyKey: randomUUID() });
    expect((await repository().getStatus(account.id, new Date())).find(item => item.purpose === base.purpose)?.state).toBe('declined');
    const withdrawal = await service.execute(account.id, { ...base, action: 'withdrawn', idempotencyKey: randomUUID() });
    const status = (await repository().getStatus(account.id, new Date())).find(item => item.purpose === base.purpose);
    const history = await db.select().from(accountConsentEvents).where(eq(accountConsentEvents.accountId, account.id)).orderBy(accountConsentEvents.sequence);

    expect(status?.state).toBe('withdrawn');
    expect(history.map(item => item.id)).toEqual([grant.id, decline.id, withdrawal.id]);
    expect(history.map(item => item.action)).toEqual(['granted', 'declined', 'withdrawn']);
  });

  it('keeps purposes and accounts independent', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const conversationNotice = await ensurePublishedNotice('ai_conversation_processing');
    const assessmentNotice = await ensurePublishedNotice('preliminary_assessment');
    const service = new RecordMyConsentDecision(repository());

    await service.execute(first.id, { purpose: 'ai_conversation_processing', noticeVersionId: conversationNotice.id, action: 'granted', idempotencyKey: randomUUID() });
    await service.execute(first.id, { purpose: 'preliminary_assessment', noticeVersionId: assessmentNotice.id, action: 'withdrawn', idempotencyKey: randomUUID() });
    const firstStatus = await repository().getStatus(first.id, new Date());
    const secondStatus = await repository().getStatus(second.id, new Date());

    expect(firstStatus.find(item => item.purpose === 'ai_conversation_processing')?.state).toBe('granted');
    expect(firstStatus.find(item => item.purpose === 'preliminary_assessment')?.state).toBe('withdrawn');
    expect(firstStatus.find(item => item.purpose === 'structured_signal_extraction')?.state).toBe('not_decided');
    expect(secondStatus.every(item => item.state === 'not_decided')).toBe(true);
  });

  it('returns the original event for identical retries and conflicts for a reused key with another payload', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const notice = await ensurePublishedNotice('structured_signal_extraction');
    const service = new RecordMyConsentDecision(repository());
    const idempotencyKey = randomUUID();
    const input = { purpose: 'structured_signal_extraction' as const, noticeVersionId: notice.id, action: 'granted' as const, idempotencyKey };

    const original = await service.execute(first.id, input);
    const retry = await service.execute(first.id, input);
    await expect(service.execute(first.id, { ...input, action: 'declined' })).rejects.toBeInstanceOf(ConsentIdempotencyConflict);
    const otherAccountEvent = await service.execute(second.id, input);
    const rows = await db.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, first.id), eq(accountConsentEvents.idempotencyKey, idempotencyKey)));

    expect(retry.id).toBe(original.id);
    expect(rows).toHaveLength(1);
    expect(otherAccountEvent.id).not.toBe(original.id);
  });

  it('serializes concurrent retries on independent PostgreSQL pool connections without duplicate events', async () => {
    const account = await createAccount();
    const notice = await ensurePublishedNotice('longitudinal_monitoring');
    const service = new RecordMyConsentDecision(repository());
    const input = { purpose: 'longitudinal_monitoring' as const, noticeVersionId: notice.id, action: 'granted' as const, idempotencyKey: randomUUID() };

    const [first, second] = await Promise.all([service.execute(account.id, input), service.execute(account.id, input)]);
    const rows = await db.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, account.id), eq(accountConsentEvents.idempotencyKey, input.idempotencyKey)));

    expect(first.id).toBe(second.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('granted');
  }, 15_000);

  it('keeps concurrent different decisions ordered by the confirmed database sequence', async () => {
    const account = await createAccount();
    const notice = await ensurePublishedNotice('ai_conversation_processing');
    const service = new RecordMyConsentDecision(repository());
    const common = { purpose: 'ai_conversation_processing' as const, noticeVersionId: notice.id };

    await Promise.all([
      service.execute(account.id, { ...common, action: 'granted', idempotencyKey: randomUUID() }),
      service.execute(account.id, { ...common, action: 'declined', idempotencyKey: randomUUID() }),
    ]);
    const [latest] = await db.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, account.id), eq(accountConsentEvents.purpose, common.purpose))).orderBy(accountConsentEvents.sequence);
    const history = await db.select().from(accountConsentEvents).where(and(eq(accountConsentEvents.accountId, account.id), eq(accountConsentEvents.purpose, common.purpose))).orderBy(accountConsentEvents.sequence);
    const status = (await repository().getStatus(account.id, new Date())).find(item => item.purpose === common.purpose);

    expect(history).toHaveLength(2);
    expect(status?.state).toBe(history.at(-1)?.action);
    expect(latest?.sequence).toBeLessThan(history.at(-1)?.sequence ?? Number.POSITIVE_INFINITY);
  }, 15_000);

  it('rejects a grant for an unavailable, future, or wrong-purpose notice', async () => {
    const account = await createAccount();
    const valid = await ensurePublishedNotice('ai_conversation_processing');
    const wrongPurpose = await ensurePublishedNotice('preliminary_assessment');
    const service = new RecordMyConsentDecision(repository());

    await expect(service.execute(account.id, { purpose: 'ai_conversation_processing', noticeVersionId: randomUUID(), action: 'granted', idempotencyKey: randomUUID() })).rejects.toThrow('Consent notice is unavailable');
    await expect(service.execute(account.id, { purpose: 'ai_conversation_processing', noticeVersionId: wrongPurpose.id, action: 'granted', idempotencyKey: randomUUID() })).rejects.toThrow('Consent notice is unavailable');
    const futureId = randomUUID();
    const futureContent = 'Integration-only future notice; not legal text.';
    await db.insert(consentNoticeVersions).values({ id: futureId, purpose: 'ai_conversation_processing', version: `test-${randomUUID().slice(0, 16)}`, content: futureContent, contentHash: createHash('sha256').update(futureContent).digest('hex'), effectiveAt: new Date(Date.now() + 3_600_000), status: 'draft' });
    draftNoticeIds.add(futureId);
    await expect(service.execute(account.id, { purpose: 'ai_conversation_processing', noticeVersionId: futureId, action: 'granted', idempotencyKey: randomUUID() })).rejects.toThrow('Consent notice is unavailable');
    expect(valid.status).toBe('published');
  });

  it('requires renewal when an old version is superseded and does not authorize it again', async () => {
    const purpose: ConsentPurpose = 'structured_signal_extraction';
    const currentNotice = await ensurePublishedNotice(purpose);
    const old = await db.select().from(consentNoticeVersions).where(and(eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'superseded'))).limit(1);
    let oldNotice = old[0];
    if (!oldNotice) {
      const content = 'Integration-only superseded notice; not legal text.';
      const [inserted] = await db.insert(consentNoticeVersions).values({
        purpose, version: `test-${randomUUID().slice(0, 16)}`, content,
        contentHash: createHash('sha256').update(content).digest('hex'),
        effectiveAt: new Date(Date.now() - 120_000), status: 'superseded',
      }).returning();
      oldNotice = inserted;
    }

    const account = await createAccount();
    await db.insert(accountConsentEvents).values({ accountId: account.id, purpose, noticeVersionId: oldNotice.id, action: 'granted', idempotencyKey: randomUUID() });
    const status = (await repository().getStatus(account.id, new Date())).find(item => item.purpose === purpose);
    await expect(new RecordMyConsentDecision(repository()).execute(account.id, { purpose, noticeVersionId: oldNotice.id, action: 'granted', idempotencyKey: randomUUID() })).rejects.toThrow('Consent notice is unavailable');
    expect(status?.state).toBe('renewal_required');
    expect(status?.currentNoticeVersion).toBe(currentNotice.version);
  });

  it('enforces published notice and event immutability and purpose matching in PostgreSQL', async () => {
    const notice = await ensurePublishedNotice('ai_conversation_processing');
    const otherPurposeNotice = await ensurePublishedNotice('preliminary_assessment');
    const client = await pool.connect();
    const accountId = randomUUID();
    const key = randomUUID();
    const email = `consent-constraints-${randomUUID()}@example.test`;
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO auth_accounts (id, email, password_hash) VALUES ($1, $2, $3)', [accountId, email, 'integration-test-only-hash']);
      await client.query("INSERT INTO account_consent_events (account_id, purpose, notice_version_id, action, idempotency_key) VALUES ($1, 'ai_conversation_processing', $2, 'granted', $3)", [accountId, notice.id, key]);
      await client.query('SAVEPOINT notice_immutable');
      await expect(client.query('UPDATE consent_notice_versions SET content = $2 WHERE id = $1', [notice.id, 'changed'])).rejects.toThrow('Published consent notice content is immutable');
      await client.query('ROLLBACK TO SAVEPOINT notice_immutable');
      await client.query('SAVEPOINT event_immutable');
      await expect(client.query("UPDATE account_consent_events SET action = 'withdrawn' WHERE account_id = $1", [accountId])).rejects.toThrow('Consent events are append-only');
      await client.query('ROLLBACK TO SAVEPOINT event_immutable');
      await client.query('SAVEPOINT purpose_match');
      await expect(client.query("INSERT INTO account_consent_events (account_id, purpose, notice_version_id, action, idempotency_key) VALUES ($1, 'ai_conversation_processing', $2, 'granted', $3)", [accountId, otherPurposeNotice.id, randomUUID()])).rejects.toThrow('Consent event purpose must match its notice purpose');
      await client.query('ROLLBACK TO SAVEPOINT purpose_match');
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('serves notices and authenticated status/decisions over HTTP with owner isolation and safe responses', async () => {
    const first = await createAccount();
    const second = await createAccount();
    const notice = await ensurePublishedNotice('ai_conversation_processing');
    const listed = await jsonRequest('/api/v1/consents/notices');
    expect(listed.status).toBe(200);
    const listedBody = await listed.json() as Array<Record<string, unknown>>;
    expect(listedBody.some(item => item.id === notice.id)).toBe(true);

    expect((await jsonRequest('/api/v1/consents/me')).status).toBe(401);
    expect((await jsonRequest('/api/v1/consents/me', { headers: { authorization: 'Bearer invalid-token' } })).status).toBe(401);
    const firstStatus = await jsonRequest('/api/v1/consents/me', { headers: { authorization: `Bearer ${first.token}` } });
    expect(firstStatus.status).toBe(200);
    const firstStatusBody = await firstStatus.json() as { items: Array<Record<string, unknown>> };
    const conversationConsent = firstStatusBody.items.find(item => item.purpose === 'ai_conversation_processing');
    expect(conversationConsent).toEqual({
      purpose: 'ai_conversation_processing',
      state: 'not_decided',
      currentNoticeVersion: notice.version,
      changedAt: null,
    });
    expect(JSON.stringify(firstStatusBody)).not.toContain(first.id);
    expect(JSON.stringify(firstStatusBody)).not.toContain(second.id);

    const key = randomUUID();
    const payload = { purpose: 'ai_conversation_processing', noticeVersionId: notice.id, action: 'granted', idempotencyKey: key };
    const headers = { authorization: `Bearer ${first.token}` };
    const created = await jsonRequest('/api/v1/consents/me/decisions', { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as Record<string, unknown>;
    expect(createdBody).not.toHaveProperty('accountId');
    expect(createdBody).not.toHaveProperty('idempotencyKey');
    expect(createdBody).not.toHaveProperty('contentHash');
    const retry = await jsonRequest('/api/v1/consents/me/decisions', { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(retry.status).toBe(201);
    expect((await retry.json() as Record<string, unknown>).id).toBe(createdBody.id);
    const conflict = await jsonRequest('/api/v1/consents/me/decisions', { method: 'POST', headers, body: JSON.stringify({ ...payload, action: 'declined' }) });
    expect(conflict.status).toBe(409);
    const unknownField = await jsonRequest('/api/v1/consents/me/decisions', { method: 'POST', headers, body: JSON.stringify({ ...payload, accountId: second.id }) });
    expect(unknownField.status).toBe(400);
    const missingNotice = await jsonRequest('/api/v1/consents/me/decisions', { method: 'POST', headers, body: JSON.stringify({ ...payload, noticeVersionId: randomUUID(), idempotencyKey: randomUUID() }) });
    expect(missingNotice.status).toBe(404);
    for (const action of ['declined', 'withdrawn'] as const) {
      const decision = await jsonRequest('/api/v1/consents/me/decisions', { method: 'POST', headers, body: JSON.stringify({ ...payload, action, idempotencyKey: randomUUID() }) });
      expect(decision.status).toBe(201);
    }
    const withdrawnStatus = await jsonRequest('/api/v1/consents/me', { headers });
    expect((await withdrawnStatus.json() as { items: Array<{ purpose: string; state: string }> }).items.find(item => item.purpose === 'ai_conversation_processing')?.state).toBe('withdrawn');
    const secondStatus = await jsonRequest('/api/v1/consents/me', { headers: { authorization: `Bearer ${second.token}` } });
    expect((await secondStatus.json() as { items: Array<{ purpose: string; state: string }> }).items.find(item => item.purpose === 'ai_conversation_processing')?.state).toBe('not_decided');
  }, 15_000);

  it('rolls back its constraint fixtures without retaining test accounts or events', async () => {
    const client = await pool.connect();
    const accountId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO auth_accounts (id, email, password_hash) VALUES ($1, $2, $3)', [accountId, `consent-rollback-${randomUUID()}@example.test`, 'integration-test-only-hash']);
      expect((await client.query('SELECT count(*)::int AS count FROM auth_accounts WHERE id = $1', [accountId])).rows[0]?.count).toBe(1);
      await client.query('ROLLBACK');
      expect((await pool.query('SELECT count(*)::int AS count FROM auth_accounts WHERE id = $1', [accountId])).rows[0]?.count).toBe(0);
    } finally { client.release(); }
  });
});
