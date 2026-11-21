import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectDemoDatabase } from './demo-database.js';

let connection: Awaited<ReturnType<typeof connectDemoDatabase>> | undefined;
try {
  connection = await connectDemoDatabase();
  await connection.pool.end();
  connection = undefined;

  const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
  const child = spawn(process.execPath, [vitestCli, 'run', 'tests/integration/conversational-demo.integration.test.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DEMO_HTTP_TEST_MODE: 'true' },
    stdio: 'inherit',
  });
  child.on('error', () => {
    console.error(JSON.stringify({ operation: 'demo_http_test', stage: 'test_runner', errorKind: 'runner_unavailable' }));
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  await connection?.pool.end();
  const kind = typeof error === 'object' && error !== null && 'errorKind' in error && typeof error.errorKind === 'string'
    ? error.errorKind : 'demo_database_not_verified';
  console.error(JSON.stringify({ operation: 'demo_http_test', stage: 'database_guard', errorKind: kind }));
  process.exitCode = 1;
}
