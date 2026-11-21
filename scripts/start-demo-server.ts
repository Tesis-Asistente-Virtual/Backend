import 'dotenv/config';
import { connectDemoDatabase, DemoDatabaseConnectionError } from './demo-database.js';
import { DemoDatabaseConfigurationError, getDemoDatabaseUrl } from '../src/config/demo-database-url.js';

let verified: Awaited<ReturnType<typeof connectDemoDatabase>> | undefined;
try {
  // Refuse to import the normal app composition until the demo DB identity is verified.
  verified = await connectDemoDatabase();
  await verified.pool.end();
  verified = undefined;

  // The existing app reads DATABASE_URL. Bridge only the already validated demo URL
  // inside this child process; never fall back to a pre-existing DATABASE_URL.
  process.env.DATABASE_URL = getDemoDatabaseUrl();
  await import('../src/server.js');
} catch (error) {
  await verified?.pool.end();
  const errorKind = error instanceof DemoDatabaseConfigurationError ? error.code
    : error instanceof DemoDatabaseConnectionError ? error.errorKind : 'demo_server_start_failed';
  console.error(JSON.stringify({ operation: 'demo_server_start', stage: 'database_guard_or_startup', errorKind }));
  process.exitCode = 1;
}
