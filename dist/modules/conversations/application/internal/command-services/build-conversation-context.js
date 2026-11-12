export async function buildConversationContext(repository, conversationId, accountId, currentUserMessage, maxContextMessages) {
    const recent = await repository.listRecentCompletedForOwner(conversationId, accountId, maxContextMessages);
    const previousLimit = Math.max(0, maxContextMessages - 1);
    const previous = recent.filter(message => message.status === 'completed' && message.id !== currentUserMessage.id);
    const priorContext = previousLimit > 0 ? previous.slice(-previousLimit) : [];
    return [...priorContext, currentUserMessage]
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        .map(({ role, content }) => ({ role, content }));
}
