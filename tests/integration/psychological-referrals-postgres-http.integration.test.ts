import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { inArray } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzlePsychologicalReferralRepository } from '../../src/modules/psychological-referrals/infrastructure/persistence/drizzle-psychological-referral-repository.js';
import { PsychologicalReferralService } from '../../src/modules/psychological-referrals/application/internal/psychological-referral-service.js';
import type { ReferralMailer } from '../../src/modules/psychological-referrals/application/ports/referral-mailer.js';
import { createPsychologicalReferralRouter } from '../../src/modules/psychological-referrals/interfaces/rest/create-psychological-referral-router.js';
import { ensureTestPublishedNotice, grantTestConsent, withdrawTestConsent } from './consent-test-fixtures.js';
import { connectTestDatabase } from './test-database.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import type { PsychologicalReferralRepository } from '../../src/modules/psychological-referrals/application/ports/referral-repository.js';

const enabled = process.env.TEST_DATABASE_URL !== undefined;
const jwt = new JwtAccessTokenService('synthetic-referral-integration-secret-32bytes', 'referral-it', 'referral-it-client', 3600);
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const accounts = new Set<string>();

function httpApp(allowlist: readonly string[], send: ReturnType<typeof vi.fn>, featureEnabled = true): Express {
  const mailer: ReferralMailer = { send };
  const service = new PsychologicalReferralService(
    new DrizzlePsychologicalReferralRepository(db) as PsychologicalReferralRepository,
    mailer,
    { enabled: featureEnabled, deployment: 'synthetic_test', allowedAccountIds: allowlist,
      selectedTestRecipient: 'u20181g752@upc.edu.pe', allowedTestRecipients: ['u20181g752@upc.edu.pe'], smtpConfigured: true },
  );
  const app = express();
  app.use(express.json());
  app.use('/api/v1/me/psychological-referrals', createPsychologicalReferralRouter(jwt, service));
  app.use(errorHandler);
  return app;
}

async function withHttp<T>(app: Express, action: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Referral HTTP integration server did not bind to loopback');
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function createAccount(): Promise<{ id: string; token: string }> {
  const [account] = await db.insert(authAccounts).values({
    email: `referral-it-${randomUUID()}@example.test`, passwordHash: 'synthetic-integration-hash',
  }).returning({ id: authAccounts.id });
  if (!account) throw new Error('Synthetic referral account insert returned no id');
  accounts.add(account.id);
  return { id: account.id, token: await jwt.issue(account.id) };
}

async function request(baseUrl: string, token: string, path: string, method: string, body?: unknown, idempotencyKey?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => { if (enabled) ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (!db || accounts.size === 0) return;
  await db.delete(authAccounts).where(inArray(authAccounts.id, [...accounts]));
  accounts.clear();
});
afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!enabled)('Psychological referrals PostgreSQL + HTTP integration', () => {
  it('creates a voluntary draft, shows exact recipient, confirms once, and isolates owner', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    await ensureTestPublishedNotice(db, 'psychological_referral_sharing');
    await grantTestConsent(db, owner.id, 'psychological_referral_sharing');
    const send = vi.fn(async () => ({ messageId: '<synthetic-referral@test.invalid>' }));
    const app = httpApp([owner.id, other.id], send);
    const createKey = randomUUID();
    const sendKey = randomUUID();

    await withHttp(app, async baseUrl => {
      const create = await request(baseUrl, owner.token, '/api/v1/me/psychological-referrals', 'POST', {}, createKey);
      expect(create.status).toBe(201);
      const preview = await create.json() as { referralId: string; status: string; recipient: string; previewHash: string; report: { signals: unknown; isDiagnostic: boolean } };
      expect(preview).toMatchObject({ status: 'draft', recipient: 'u20181g752@upc.edu.pe', report: { signals: null, isDiagnostic: false } });

      const crossOwner = await request(baseUrl, other.token, `/api/v1/me/psychological-referrals/${preview.referralId}`, 'GET');
      expect(crossOwner.status).toBe(404);
      const sendResponse = await request(baseUrl, owner.token, `/api/v1/me/psychological-referrals/${preview.referralId}/send`, 'POST', { confirmed: true, previewHash: preview.previewHash }, sendKey);
      expect(sendResponse.status).toBe(200);
      expect(await sendResponse.json()).toMatchObject({ status: 'sent', duplicate: false });
      const duplicate = await request(baseUrl, owner.token, `/api/v1/me/psychological-referrals/${preview.referralId}/send`, 'POST', { confirmed: true, previewHash: preview.previewHash }, sendKey);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({ status: 'sent', duplicate: true });
      expect(send).toHaveBeenCalledOnce();
    });
  });

  it('requires the separate current sharing consent and never invokes mail without it', async () => {
    const owner = await createAccount();
    const send = vi.fn(async () => ({ messageId: '<unexpected@test.invalid>' }));
    const app = httpApp([owner.id], send);
    await withHttp(app, async baseUrl => {
      const response = await request(baseUrl, owner.token, '/api/v1/me/psychological-referrals', 'POST', {}, randomUUID());
      expect(response.status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('blocks sending after the sharing consent is withdrawn', async () => {
    const owner = await createAccount();
    await ensureTestPublishedNotice(db, 'psychological_referral_sharing');
    await grantTestConsent(db, owner.id, 'psychological_referral_sharing');
    const send = vi.fn(async () => ({ messageId: '<unexpected@test.invalid>' }));
    const app = httpApp([owner.id], send);
    await withHttp(app, async baseUrl => {
      const created = await request(baseUrl, owner.token, '/api/v1/me/psychological-referrals', 'POST', {}, randomUUID());
      expect(created.status).toBe(201);
      const preview = await created.json() as { referralId: string; previewHash: string };
      await withdrawTestConsent(db, owner.id, 'psychological_referral_sharing');
      const response = await request(baseUrl, owner.token, `/api/v1/me/psychological-referrals/${preview.referralId}/send`, 'POST', {
        confirmed: true, previewHash: preview.previewHash,
      }, randomUUID());
      expect(response.status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('blocks a non-allowlisted account and a disabled policy', async () => {
    const owner = await createAccount();
    const send = vi.fn(async () => ({ messageId: '<unexpected@test.invalid>' }));
    await withHttp(httpApp([], send), async baseUrl => {
      expect((await request(baseUrl, owner.token, '/api/v1/me/psychological-referrals', 'POST', {}, randomUUID())).status).toBe(503);
    });
    await withHttp(httpApp([owner.id], send, false), async baseUrl => {
      expect((await request(baseUrl, owner.token, '/api/v1/me/psychological-referrals', 'POST', {}, randomUUID())).status).toBe(503);
    });
    expect(send).not.toHaveBeenCalled();
  });
});

