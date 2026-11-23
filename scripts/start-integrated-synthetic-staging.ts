import type { Server } from 'node:http';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, lte } from 'drizzle-orm';
import * as schema from '../src/shared/infrastructure/database/schema.js';
import { consentNoticeVersions } from '../src/modules/consent/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { createIntegratedSyntheticStagingApp } from '../src/staging/create-integrated-synthetic-staging-app.js';
import { isStagingLoopbackAddress, validateStagingDatabaseUrl } from '../src/shared/infrastructure/database/staging-database-safety.js';

class SafeStagingStartupError extends Error {}

if (process.env.NODE_ENV === 'production') throw new Error('Synthetic staging cannot run when NODE_ENV=production');
const stagingDatabaseUrl = validateStagingDatabaseUrl(process.env.STAGING_DATABASE_URL);
const stagingJwtSecret = process.env.STAGING_JWT_SECRET;
if (!stagingJwtSecret || Buffer.byteLength(stagingJwtSecret, 'utf8') < 32) {
  throw new Error('STAGING_JWT_SECRET must be configured with at least 32 bytes; no other JWT secret is used');
}
const port = Number(process.env.STAGING_PORT ?? 3042);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STAGING_PORT must be a valid port');

const pool = new Pool({ connectionString: stagingDatabaseUrl, max: 6, connectionTimeoutMillis: 3000, application_name: 'tesis_integrated_synthetic_staging' });
const db = drizzle(pool, { schema });
let server: Server | undefined;
try {
  const identity = await pool.query<{ database_name: string; server_address: string | null }>(
    'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
  );
  const target = identity.rows[0];
  if (target?.database_name !== 'tesis_staging_db' || !isStagingLoopbackAddress(target.server_address)) {
    throw new SafeStagingStartupError('Connected PostgreSQL instance is not the authorized local tesis_staging_db');
  }

  const purposes = ['ai_conversation_processing', 'structured_signal_extraction', 'preliminary_assessment'] as const;
  const now = new Date();
  for (const purpose of purposes) {
    const notice = await db.select({ content: consentNoticeVersions.content }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, now),
    )).limit(1);
    if (!notice[0] || !/SOLO PRUEBA TÉCNICA.*NO APROBACIÓN LEGAL.*DATOS FICTICIOS/i.test(notice[0].content)) {
      throw new SafeStagingStartupError(`A current synthetic-only consent notice is required for ${purpose}; use the explicit staging fixture command first`);
    }
  }

  const jwt = new JwtAccessTokenService(stagingJwtSecret, 'tesis-integrated-synthetic-staging', 'synthetic-staging-client', 900);
  const app = await createIntegratedSyntheticStagingApp({
    database: db, pool, jwt, stagingDatabaseUrl,
    corsOrigins: parseStagingOrigins(process.env.STAGING_CORS_ALLOWED_ORIGINS),
  });
  server = app.listen(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('listening', resolve);
    server?.once('error', reject);
  });
  process.stdout.write(`Integrated synthetic staging listening at http://127.0.0.1:${port}; provider=deterministic_synthetic; database=tesis_staging_db\n`);
  process.stdout.write('Only @example.test accounts are accepted. No external AI provider is called. DASS-21 remains not approved and test-only.\n');

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      if (server?.listening) await new Promise<void>(resolve => server?.close(() => resolve()));
      await pool.end();
      process.exit(0);
    })().catch(() => process.exit(1));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  await pool.end();
  if (error instanceof SafeStagingStartupError) throw error;
  throw new Error('Integrated synthetic staging failed safely; database credentials and provider payloads were suppressed');
}

function parseStagingOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return [];
  const entries = value.split(',').map(item => item.trim());
  if (entries.some(item => item === '' || item.includes('*'))) throw new Error('STAGING_CORS_ALLOWED_ORIGINS must contain exact origins');
  const origins = entries.map(item => {
    const url = new URL(item);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== item || url.username || url.password) {
      throw new Error('STAGING_CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins');
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) throw new Error('STAGING_CORS_ALLOWED_ORIGINS contains duplicate origins');
  return origins;
}
