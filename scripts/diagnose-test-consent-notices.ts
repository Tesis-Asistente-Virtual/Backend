import { connectTestDatabase, TestDatabaseSafetyError } from '../tests/integration/test-database.js';
import { diagnoseConversationalDemoNotices, DemoNoticeSeedError } from '../tests/integration/conversational-demo-notices.js';

let connection: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;

try {
  // connectTestDatabase reads only TEST_DATABASE_URL and verifies local tesis_test_db.
  connection = await connectTestDatabase();
  const results = await diagnoseConversationalDemoNotices(connection.db);
  for (const result of results) {
    console.log(JSON.stringify({ operation: 'demo_notice_diagnosis', ...result }));
  }
} catch (error) {
  if (error instanceof TestDatabaseSafetyError) {
    console.error(JSON.stringify({ operation: 'demo_notice_diagnosis', stage: error.stage, errorKind: error.errorKind }));
  } else if (error instanceof DemoNoticeSeedError) {
    console.error(JSON.stringify({ operation: 'demo_notice_diagnosis', stage: error.stage, errorKind: error.errorKind }));
  } else {
    console.error(JSON.stringify({ operation: 'demo_notice_diagnosis', stage: 'read_only_inspection', errorKind: 'unknown_database_failure' }));
  }
  process.exitCode = 1;
} finally {
  await connection?.pool.end();
}
