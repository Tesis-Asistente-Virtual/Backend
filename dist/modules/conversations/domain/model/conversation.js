export const conversationStatuses = ['active', 'archived'];
export function createConversation(input) {
    if (!conversationStatuses.includes(input.status)) {
        throw new Error('Invalid conversation status');
    }
    if (input.title !== null && input.title.length > 150) {
        throw new Error('Conversation title cannot exceed 150 characters');
    }
    if (Number.isNaN(input.createdAt.getTime()) || Number.isNaN(input.updatedAt.getTime())) {
        throw new Error('Conversation timestamps must be valid dates');
    }
    return Object.freeze({ ...input });
}
