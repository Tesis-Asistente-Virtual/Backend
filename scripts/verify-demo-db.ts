import { connectDemoDatabase, DemoDatabaseConnectionError } from './demo-database.js';
import { DemoDatabaseConfigurationError } from '../src/config/demo-database-url.js';

let connection: Awaited<ReturnType<typeof connectDemoDatabase>> | undefined;
try {
  connection = await connectDemoDatabase();
  console.log(JSON.stringify({ operation: 'demo_database_verify', database: 'tesis_demo_db', host: 'loopback', verified: true }));
} catch (error) {
  const errorKind = error instanceof DemoDatabaseConfigurationError ? error.code
    : error instanceof DemoDatabaseConnectionError ? error.errorKind : 'unknown_database_failure';
  console.error(JSON.stringify({ operation: 'demo_database_verify', stage: 'read_only_connection_check', errorKind }));
  process.exitCode = 1;
} finally {
  await connection?.pool.end();
}
