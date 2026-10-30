import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectTestDatabase } from '../tests/integration/test-database.js';

const { pool, db } = await connectTestDatabase();
try {
  await migrate(db, { migrationsFolder: './drizzle' });
  process.stdout.write('Applied existing Drizzle migrations to verified local tesis_test_db.\n');
} finally {
  await pool.end();
}
