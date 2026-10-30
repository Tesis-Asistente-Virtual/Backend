# PostgreSQL integration tests

Integration tests accept only `TEST_DATABASE_URL` pointing to a PostgreSQL server on `localhost`, `127.0.0.1`, or `::1`, with database name exactly `tesis_test_db`. They reject production mode and verify `current_database()` plus the server address before Drizzle is used. There is no fallback to `DATABASE_URL`.

Prepare the isolated database once, using a local PostgreSQL administrator:

```sql
CREATE DATABASE tesis_test_db;
```

From PowerShell, set a URL for that local database and apply the existing versioned migrations:

```powershell
$env:TEST_DATABASE_URL = 'postgres://USER:PASSWORD@localhost:5432/tesis_test_db'
npm run db:migrate:test
npm run test:integration
```

Replace the placeholders with test-only credentials. The migration command reuses `./drizzle` and validates the destination before connecting. The integration suite deletes only accounts created with its unique run identifiers; it never drops databases, tables, or truncates data. Keep `npm test` for unit tests; it excludes this integration directory.
