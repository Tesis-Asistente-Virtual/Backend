# LongitudinalMonitoring

This bounded context currently manages voluntary enrollment metadata and explicitly opened sessions. It does not collect symptoms, measurements, conversational observations, trends, or clinical scores.

## Consent and write ordering

Starting an enrollment, resuming a paused enrollment, and creating a session each perform an application-level consent check for `longitudinal_monitoring` for early rejection. Their write repositories then revalidate the exact notice version stored on the enrollment (or being used to create it) against the currently published, effective notice and the latest account decision inside the same short transaction as the write. Missing, declined, withdrawn, superseded, or otherwise mismatched authorization fails closed. Database errors during this revalidation map to `consent_unavailable`.

The transaction lock order is:

1. Lock the account row `FOR SHARE`.
2. Lock the matching published notice row `FOR SHARE` and inspect the latest purpose event.
3. For resume/session operations, update or lock the enrollment row using its owner and optimistic revision/status checks.
4. Insert or update the enrollment/session, then commit.

Consent decision writes take `auth_accounts FOR UPDATE` before locking the notice and appending the immutable event. Thus the two orders agree at the account row. If a withdrawal commits first, the sensitive write sees it and is rejected. If a sensitive write acquires its account lock first, it commits before the withdrawal can proceed. No transaction remains open during external calls; this module currently makes none.

This serialization protects these three write boundaries only. It does not erase previously stored metadata, and a withdrawal cannot retroactively undo a write that committed before it. Retention and erasure policy remain subject to legal/ethical review. The enrollment one-open partial unique index, owner foreign keys, triggers, and optimistic revision checks are unchanged.

## Explicit conversation association (Sprint 5D.2)

`POST /api/v1/monitoring/enrollments/:id/sessions/:sessionId/conversation` accepts `{ "conversationId": "<uuid>", "explicitAssociation": true }` with JWT. The identity is read from the JWT. One active enrollment session can be linked to one active conversation, and a conversation can be linked only once. Composite foreign keys bind both resources to the same account and bind the session to the supplied enrollment. The record contains only IDs and `createdAt`; it never loads, copies, or returns message content.

The write revalidates the current `longitudinal_monitoring` notice and latest grant inside the transaction, using lock order account → notice → enrollment → session → conversation. The active enrollment/session and active owned conversation are locked/checked before insert. Withdrawal committed first denies the link; if the link commits first, it precedes withdrawal. Uniqueness resolves concurrent duplicate links as HTTP 409. Foreign/missing resources return a generic 404.

The production composition uses `DenyUnapprovedMonitoringConversationAssociation` by default. No notice version has been reviewed to authorize associating a conversation with a monitoring session, so production calls fail closed with 403 even when ordinary enrollment consent exists. The synthetic test-only policy used by PostgreSQL tests does not approve notices or authorize real participants. A future release must provide an explicit, reviewed policy for the exact immutable notice version before enabling writes. This route only links metadata; it does not grant access to or authorize reuse of conversation content. Any later read/extraction needs its own current consent for each purpose and an approved notice scope.

Migration `0008_monitoring_conversation_association.sql` adds the relationship table and composite unique keys required by its owner-bound foreign keys. It has not been applied by this change. Review the SQL, then apply pending migrations manually to the guarded local `tesis_test_db` with `npm run db:migrate:test`; do not run against development/demo/production targets. Run integration tests only after verifying `TEST_DATABASE_URL` points to loopback `tesis_test_db` and migration 0008 is present.

## Verification

Unit tests cover the use-case boundary and ensure no unchecked repository method is used after transactional consent denial. PostgreSQL integration tests exercise authorized writes, withdrawal-before-write denials for all three operations, and concurrent write/withdraw outcomes. Run them only with `TEST_DATABASE_URL` targeting the guarded local `tesis_test_db`; they must not fall back to `DATABASE_URL`.
