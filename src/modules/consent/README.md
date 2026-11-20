# Consent & Privacy

This module records append-only user decisions against immutable, purpose-specific notice versions. Purposes are independent; only the latest event for the currently published notice can authorize processing. A grant for an older version reports `renewal_required`. A missing notice, declined/withdrawn event, or absent event never grants permission.

`POST /api/v1/consents/me/decisions` requires an explicit action and UUID idempotency key. Repeating the same key and payload returns the original event; reusing that key with another payload returns 409. New deliberate decisions append new events. PostgreSQL serializes decisions per account by locking its account row; a sequence column orders concurrent event writes.

No notice is seeded or published by this implementation. Until an approved notice is created and published through a controlled release process, notice listing is empty and `CheckConsentForPurpose` returns false. The stored content hash must be computed from the exact notice bytes/content by that release process. There is intentionally no API for publishing legal text.

Before making consent mandatory in chat, call `CheckConsentForPurpose` in `SendConversationMessage.execute` after acquiring the conversation turn lock and verifying ownership/status, but before persisting the user message or calling OpenAI. In `StreamConversationMessage.execute`, call it after acquiring the lock and checking owner/status, before `callbacks.onReady()` so a denied request still receives a normal HTTP response. New extraction and assessment use cases must check their own purpose before reading or submitting sensitive content. This sprint leaves existing REST/SSE behavior unchanged.

Consent withdrawal only changes future authorization. It does not delete past messages, observations, or assessment data; retention and erasure rules remain subject to approved legal/ethical policy. Account deletion cascades consent events. Published notice records are retained; consent events cannot be updated, though account cascade deletion remains permitted.

Apply migration `0003_deep_ender_wiggin.sql` only after reviewing it and confirming the target database explicitly. This sprint did not run `db:migrate` against development or test databases.
