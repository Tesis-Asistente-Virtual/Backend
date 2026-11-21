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

## Verification

Unit tests cover the use-case boundary and ensure no unchecked repository method is used after transactional consent denial. PostgreSQL integration tests exercise authorized writes, withdrawal-before-write denials for all three operations, and concurrent write/withdraw outcomes. Run them only with `TEST_DATABASE_URL` targeting the guarded local `tesis_test_db`; they must not fall back to `DATABASE_URL`.
