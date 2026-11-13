# Conversations persistence policy

- Deleting an `auth_accounts` row cascades to its conversations; deleting a conversation cascades to its messages. The migration does not change either existing table.
- While an assistant message is `generating`, its `content` is the empty string. If generation fails before completion, the message remains `failed` with empty content. Partial output is not persisted as a message or as SSE fragments.
- Messages are read in ascending `created_at`, then ascending UUID `id` order for stable ties.

## AI text stream contract

`AiTextGenerator.streamText(request, signal?)` yields text `delta` events and, only after a provider `response.completed` event with a completed response and matching final text, one `completed` event containing the verified full text and optional token usage. Repeated SDK sequence numbers are ignored. Provider errors, empty/incomplete responses and cancellation reject iteration with provider-neutral typed failure kinds; iterator exhaustion alone is not success. Consumers that receive deltas but no completion must treat the generation as failed or cancelled. Deltas are transient and are not persisted by this provider adapter.

The authenticated `POST /api/v1/conversations/:id/messages/stream` endpoint exposes `message.started`, `message.delta`, `message.completed`, `stream.completed`, and `stream.error` SSE events. It reuses the PostgreSQL session advisory lock shared with the non-streaming send endpoint. The user turn is stored once; the assistant message is stored once after provider completion. Provider failures and client cancellation attempt to persist an empty `failed` assistant message. An abrupt process crash can leave a user message without a corresponding assistant status record, and requests are not idempotent: clients must not blindly retry after an uncertain disconnect. A disconnected SSE stream cannot be resumed.
