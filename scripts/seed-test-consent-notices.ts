import { connectTestDatabase, TestDatabaseSafetyError } from '../tests/integration/test-database.js';
import { createDrizzleDemoNoticeStore, DemoNoticeSeedError, ensureConversationalDemoNotices, conversationalDemoNotices } from '../tests/integration/conversational-demo-notices.js';

let connection: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;

try {
  // This helper reads only TEST_DATABASE_URL and verifies local tesis_test_db before returning a DB handle.
  connection = await connectTestDatabase();
  const noticeIds = await ensureConversationalDemoNotices(createDrizzleDemoNoticeStore(connection.db));
  for (const notice of conversationalDemoNotices) {
    if (!noticeIds[notice.purpose]) throw new Error('Fixture verification did not return an identifier');
    console.log(JSON.stringify({ operation: 'demo_notice_seed', stage: 'fixture_transaction', errorKind: 'none', purpose: notice.purpose, version: notice.version }));
  }
  console.log('Synthetic demo notices are published only in the verified local tesis_test_db.');
} catch (error) {
  if (error instanceof TestDatabaseSafetyError) {
    console.error(JSON.stringify({ operation: 'demo_notice_seed', stage: error.stage, errorKind: error.errorKind }));
    console.error(`Demo notice setup stopped safely: ${error.message}.`);
  } else if (error instanceof DemoNoticeSeedError) {
    console.error(JSON.stringify({ operation: 'demo_notice_seed', stage: error.stage, errorKind: error.errorKind, ...(error.reason ? { reason: error.reason } : {}) }));
  } else {
    console.error(JSON.stringify({ operation: 'demo_notice_seed', stage: 'fixture_transaction', errorKind: 'unknown_database_failure' }));
  }
  process.exitCode = 1;
} finally {
  await connection?.pool.end();
}
