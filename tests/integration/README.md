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

Replace the placeholders with test-only credentials. The migration command reuses `./drizzle` and validates the destination before connecting. The integration suite deletes only accounts created with its unique run identifiers; it never drops databases, tables, or truncates data. Consent notice fixtures are labeled as integration-only non-legal text and retained in `tesis_test_db`, because the immutability trigger correctly prevents deleting a published notice. The suite reuses existing published notices where possible and never changes a pre-existing notice. Keep `npm test` for unit tests; it excludes this integration directory.

`conversational-processing.integration.test.ts` follows the same rule: it reuses effective published notices, creates only short (`test-` plus 16 UUID characters) fixtures when needed, and retains published or superseded notice fixtures. Per-test accounts and their conversations, messages, and consent events are deleted by account ID (foreign-key cascades); only drafts created by a failed fixture setup are deleted directly. It never edits or deletes pre-existing notices.

`preliminary-assessment.integration.test.ts` also requires the current migrations to be applied first with the guarded `npm run db:migrate:test`. It uses synthetic, non-clinical instrument questions and explicit test consent in `tesis_test_db`; approved instrument fixtures are immutable and retained for reuse. Test accounts and their assessments, answers, results, and consent events are cleaned up by account ID. Do not run these fixtures against `tesis_db`.

Vitest runs integration files in parallel by default. Consent, PreliminaryAssessment, and DASS-21 suites share the globally published `preliminary_assessment` notice, so they hold the same test-only PostgreSQL advisory lock for the suite lifetime. The lock-owning connection also observes `pg_stat_activity` in PreliminaryAssessment's lock-order tests. The concurrent replacement draft is prepared before the race test reserves its blocker, publisher, and pending-write connections. This avoids checking out additional connections during the lock window; the pool remains at `max: 4` and the business locking scenarios remain unchanged.
