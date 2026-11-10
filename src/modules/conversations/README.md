# Conversations persistence policy

- Deleting an `auth_accounts` row cascades to its conversations; deleting a conversation cascades to its messages. The migration does not change either existing table.
- While an assistant message is `generating`, its `content` is the empty string. If generation fails before completion, the message remains `failed` with empty content. Partial output is not persisted as a message or as SSE fragments.
- Messages are read in ascending `created_at`, then ascending UUID `id` order for stable ties.
