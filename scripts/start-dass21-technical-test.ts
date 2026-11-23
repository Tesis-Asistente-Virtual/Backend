import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { and, eq, lte } from 'drizzle-orm';
import { authAccounts } from '../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { consentNoticeVersions } from '../src/modules/consent/infrastructure/persistence/schema.js';
import { createConsentRouter } from '../src/modules/consent/interfaces/rest/create-consent-router.js';
import { createTechnicalTestDass21Router } from '../src/modules/preliminary-assessment/technical-test/create-technical-test-dass21-router.js';
import { DrizzleInstrumentCatalog } from '../src/modules/preliminary-assessment/infrastructure/persistence/drizzle-instrument-catalog.js';
import { ensureDass21TechnicalTestDraft } from '../src/modules/preliminary-assessment/technical-test/ensure-dass21-technical-test-draft.js';
import { createCorsMiddleware } from '../src/shared/infrastructure/http/cors-middleware.js';
import { parseCorsAllowedOrigins } from '../src/config/cors.js';
import { errorHandler } from '../src/shared/infrastructure/http/error-handler.js';
import { connectTestDatabase } from '../tests/integration/test-database.js';

const port = 3031;
const { pool, db } = await connectTestDatabase();
let server: Server | undefined;
let accountId: string | undefined;

async function cleanup(): Promise<void> {
  if (server?.listening) await new Promise<void>(resolve => server?.close(() => resolve()));
  if (accountId) await db.delete(authAccounts).where(eq(authAccounts.id, accountId));
  await pool.end();
}

try {
  const now = new Date();
  const notices = await db.select({ id: consentNoticeVersions.id, content: consentNoticeVersions.content }).from(consentNoticeVersions).where(and(
    eq(consentNoticeVersions.purpose, 'preliminary_assessment'),
    eq(consentNoticeVersions.status, 'published'),
    lte(consentNoticeVersions.effectiveAt, now),
  )).limit(1);
  if (notices.length === 0) throw new Error('No current preliminary_assessment notice exists in the guarded test database');
  if (!/synthetic|synthetic-only|test notice|solo (?:prueba|demostraci[oó]n)|datos ficticios/i.test(notices[0]!.content)) {
    throw new Error('The current preliminary_assessment notice is not identified as a synthetic test notice');
  }

  await ensureDass21TechnicalTestDraft(new DrizzleInstrumentCatalog(db), now);
  accountId = randomUUID();
  await db.insert(authAccounts).values({
    id: accountId,
    email: `dass21-technical-test-${accountId}@example.test`,
    passwordHash: 'technical-test-account-has-no-password-login',
  });

  const jwt = new JwtAccessTokenService(randomBytes(32).toString('base64url'), 'dass21-technical-test', 'local-test-client', 60 * 60);
  const accessToken = await jwt.issue(accountId);
  const app = express();
  app.use(createCorsMiddleware(parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS)));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/v1/consents', createConsentRouter(db, jwt));
  app.use('/api/v1/preliminary-assessments', await createTechnicalTestDass21Router(db, jwt));
  app.use(errorHandler);

  server = app.listen(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('listening', resolve);
    server?.once('error', reject);
  });

  process.stdout.write(`DASS-21 technical test server listening at http://127.0.0.1:${port}\n`);
  process.stdout.write(`Synthetic account: ${accountId}\n`);
  process.stdout.write(`Temporary access token (do not share): ${accessToken}\n`);
  process.stdout.write('This isolated server uses only TEST_DATABASE_URL / tesis_test_db; the candidate remains not approved.\n');

  const shutdown = () => {
    void cleanup().then(() => process.exit(0), () => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  await cleanup();
  throw error;
}
