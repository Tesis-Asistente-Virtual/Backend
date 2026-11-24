import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/shared/infrastructure/database/schema.js';
import { PurgeExpiredConversationalSignalAnalyses } from '../src/modules/conversational-processing/application/internal/command-services/purge-expired-conversational-signal-analyses.js';
import { DrizzleConversationalSignalAnalysisRepository } from '../src/modules/conversational-processing/infrastructure/persistence/drizzle-conversational-signal-analysis-repository.js';
import { isAllowedLoopbackAddress, validateTestDatabaseUrl } from '../src/shared/infrastructure/database/test-database-safety.js';

const requiredFlags = ['--run-expired-signal-purge-test', '--confirm-test-database-only'] as const;
const args = process.argv.slice(2);
if (args.length !== requiredFlags.length || requiredFlags.some(flag => !args.includes(flag)) || new Set(args).size !== args.length) {
  process.stderr.write('Purge refused. Provide both explicit test-only confirmation flags.\n');
  process.exitCode = 1;
} else {
  await run();
}

async function run(): Promise<void> {
  let connectionString: string;
  try {
    connectionString = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Test database target rejected'}\n`);
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 3_000, application_name: 'conversational_signal_test_purge' });
  try {
    const check = await pool.query<{ database_name: string; server_address: string | null }>(
      'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
    );
    const target = check.rows[0];
    if (!target || target.database_name !== 'tesis_test_db' || !target.server_address || !isAllowedLoopbackAddress(target.server_address)) {
      throw new Error('Purge refused: connected PostgreSQL identity is not loopback tesis_test_db');
    }

    const repository = new DrizzleConversationalSignalAnalysisRepository(drizzle(pool, { schema }));
    const purge = new PurgeExpiredConversationalSignalAnalyses(repository);
    let deleted = 0;
    const asOf = new Date();
    while (true) {
      const batch = await purge.execute({ asOf, limit: 100 });
      deleted += batch;
      if (batch < 100) break;
    }
    process.stdout.write(JSON.stringify({ operation: 'purge_expired_conversational_signal_analyses', database: 'tesis_test_db', deleted }) + '\n');
  } catch {
    process.stderr.write('Purge stopped safely; no database details were emitted.\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
