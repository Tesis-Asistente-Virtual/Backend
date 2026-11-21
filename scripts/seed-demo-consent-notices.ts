import { connectDemoDatabase, DemoDatabaseConnectionError } from './demo-database.js';
import { DemoDatabaseConfigurationError } from '../src/config/demo-database-url.js';
import {
  createDrizzleDemoNoticeStore,
  conversationalDemoNotices,
  DemoNoticeSeedError,
  ensureConversationalDemoNotices,
} from '../tests/integration/conversational-demo-notices.js';

let connection: Awaited<ReturnType<typeof connectDemoDatabase>> | undefined;
try {
  connection = await connectDemoDatabase();
  const seeded = await ensureConversationalDemoNotices(createDrizzleDemoNoticeStore(connection.db));
  for (const notice of conversationalDemoNotices) {
    if (!seeded[notice.purpose]) throw new Error('Demo fixture verification failed');
    console.log(JSON.stringify({ operation: 'demo_notice_seed', stage: 'fixture_transaction', errorKind: 'none', purpose: notice.purpose, version: notice.version }));
  }
  console.log('Synthetic notices are present in verified local tesis_demo_db.');
} catch (error) {
  const errorKind = error instanceof DemoDatabaseConfigurationError ? error.code
    : error instanceof DemoDatabaseConnectionError ? error.errorKind
      : error instanceof DemoNoticeSeedError ? error.errorKind : 'unknown_database_failure';
  const reason = error instanceof DemoNoticeSeedError ? error.reason : undefined;
  console.error(JSON.stringify({ operation: 'demo_notice_seed', stage: error instanceof DemoNoticeSeedError ? error.stage : 'connection_or_fixture', errorKind, ...(reason ? { reason } : {}) }));
  process.exitCode = 1;
} finally {
  await connection?.pool.end();
}
