import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/shared/infrastructure/database/schema.js';
import { PurgeExpiredConversationalSignalAnalyses } from '../src/modules/conversational-processing/application/internal/command-services/purge-expired-conversational-signal-analyses.js';
import { DrizzleConversationalSignalAnalysisRepository } from '../src/modules/conversational-processing/infrastructure/persistence/drizzle-conversational-signal-analysis-repository.js';

const runFlag = '--run-expired-signal-purge';
const confirmationFlag = '--confirm-authorized-pilot-database';
const dryRunFlag = '--dry-run';
const args = process.argv.slice(2);
const dryRun = args.includes(dryRunFlag);
const expectedArgs = dryRun ? [runFlag, confirmationFlag, dryRunFlag] : [runFlag, confirmationFlag];

if (args.length !== expectedArgs.length || new Set(args).size !== args.length || expectedArgs.some(flag => !args.includes(flag))) {
  process.stderr.write(`Purge refused. Require ${runFlag} and ${confirmationFlag}; optional ${dryRunFlag}.\n`);
  process.exitCode = 1;
} else {
  await run();
}

async function run(): Promise<void> {
  const runId = randomUUID();
  const startedAt = new Date();
  if (process.env.CONVERSATIONAL_SIGNAL_ANALYSIS_PURGE_ENABLED !== 'true' ||
      process.env.CONVERSATIONAL_SIGNAL_ANALYSIS_DEPLOYMENT !== 'authorized_pilot' ||
      !process.env.CONVERSATIONAL_SIGNAL_ANALYSIS_AUTHORIZATION_REFERENCE?.trim()) {
    process.stderr.write('Purge refused; authorized pilot purge configuration is incomplete.\n');
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  const expectedDatabase = process.env.CONVERSATIONAL_SIGNAL_ANALYSIS_PURGE_DATABASE_NAME?.trim();
  if (!connectionString || !expectedDatabase || ['tesis_test_db', 'tesis_demo_db', 'tesis_staging_db'].includes(expectedDatabase)) {
    process.stderr.write('Purge refused; explicit authorized database target is required.\n');
    process.exitCode = 1;
    return;
  }

  let url: URL;
  try { url = new URL(connectionString); }
  catch { process.stderr.write('Purge refused; DATABASE_URL is malformed.\n'); process.exitCode = 1; return; }
  const urlDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || urlDatabase !== expectedDatabase) {
    process.stderr.write('Purge refused; DATABASE_URL does not match the explicitly authorized database name.\n');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000, application_name: 'conversational_signal_analysis_purge' });
  try {
    const identity = await pool.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (identity.rows[0]?.database_name !== expectedDatabase) throw new Error('database_identity_mismatch');
    const asOf = new Date();
    if (dryRun) {
      const count = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM conversational_signal_analyses WHERE expires_at <= $1', [asOf],
      );
      process.stdout.write(JSON.stringify({ operation: 'expired_signal_analysis_purge_dry_run', runId, database: expectedDatabase, asOf: asOf.toISOString(), eligible: Number(count.rows[0]?.count ?? 0), durationMs: Date.now() - startedAt.getTime() }) + '\n');
      return;
    }
    const repository = new DrizzleConversationalSignalAnalysisRepository(drizzle(pool, { schema }));
    const purge = new PurgeExpiredConversationalSignalAnalyses(repository);
    let deleted = 0;
    while (true) {
      const batch = await purge.execute({ asOf, limit: 100 });
      deleted += batch;
      if (batch < 100) break;
    }
    process.stdout.write(JSON.stringify({ operation: 'expired_signal_analysis_purge', runId, database: expectedDatabase, asOf: asOf.toISOString(), deleted, durationMs: Date.now() - startedAt.getTime() }) + '\n');
  } catch {
    process.stderr.write(JSON.stringify({ operation: 'expired_signal_analysis_purge', runId, database: expectedDatabase, status: 'failed', durationMs: Date.now() - startedAt.getTime(), errorKind: 'target_identity_or_database_operation_failed' }) + '\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
