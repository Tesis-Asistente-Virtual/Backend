export function toConversationResource(value) {
    return {
        id: value.id,
        title: value.title,
        status: value.status,
        createdAt: value.createdAt.toISOString(),
        updatedAt: value.updatedAt.toISOString(),
    };
}
export function toConversationMessageResource(value) {
    return {
        id: value.id,
        conversationId: value.conversationId,
        role: value.role,
        content: value.content,
        status: value.status,
        createdAt: value.createdAt.toISOString(),
    };
}
export function toPageResource(page, transform) {
    return {
        items: page.items.map(transform),
        pagination: { limit: page.limit, offset: page.offset, hasMore: page.hasMore },
    };
}
