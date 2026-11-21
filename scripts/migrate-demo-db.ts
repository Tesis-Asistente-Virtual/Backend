import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDemoDatabase, DemoDatabaseConnectionError } from './demo-database.js';
import { DemoDatabaseConfigurationError } from '../src/config/demo-database-url.js';

let connection: Awaited<ReturnType<typeof connectDemoDatabase>> | undefined;
try {
  connection = await connectDemoDatabase();
  await migrate(connection.db, { migrationsFolder: './drizzle' });
  console.log('Applied existing Drizzle migrations to verified local tesis_demo_db.');
} catch (error) {
  const errorKind = error instanceof DemoDatabaseConfigurationError ? error.code
    : error instanceof DemoDatabaseConnectionError ? error.errorKind : 'migration_failed';
  console.error(JSON.stringify({ operation: 'demo_database_migration', stage: 'guarded_migration', errorKind }));
  process.exitCode = 1;
} finally {
  await connection?.pool.end();
}
