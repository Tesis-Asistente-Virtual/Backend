export const messageRoles = ['user', 'assistant'];
export const messageStatuses = ['generating', 'completed', 'failed'];
/** Incomplete assistant output is represented by empty content; streamed chunks are not persisted as messages. */
export function createConversationMessage(input) {
    if (!messageRoles.includes(input.role))
        throw new Error('Invalid conversation message role');
    if (!messageStatuses.includes(input.status))
        throw new Error('Invalid conversation message status');
    if (input.role === 'user' && input.status !== 'completed') {
        throw new Error('User messages must be completed');
    }
    if (input.role === 'assistant' && input.status !== 'completed' && input.content !== '') {
        throw new Error('Incomplete assistant messages must not contain a partial response');
    }
    if (Number.isNaN(input.createdAt.getTime()))
        throw new Error('Message timestamp must be a valid date');
    return Object.freeze({ ...input });
}
export function orderConversationMessages(messages) {
    return [...messages].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
}
