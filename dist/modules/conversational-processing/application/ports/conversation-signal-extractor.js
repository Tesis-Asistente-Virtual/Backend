import { z } from 'zod';
import { conversationSignalExtractionSchema } from '../../domain/model/signal-observation.js';
export const authorizedSignalMessageSchema = z.object({
    messageId: z.string().uuid(),
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(5000),
}).strict();
/** Minimal message data supplied only after the caller has checked authorization and purpose consent. */
export const extractConversationSignalsInputSchema = z.object({
    messages: z.array(authorizedSignalMessageSchema).min(1).max(20),
}).strict();
/** Provider-neutral and safe for application handling; never carries prompts or provider payloads. */
export class ConversationSignalExtractionError extends Error {
    kind;
    incompleteReason;
    constructor(kind, incompleteReason) {
        super('Conversation signal extraction failed');
        this.kind = kind;
        this.incompleteReason = incompleteReason;
        this.name = 'ConversationSignalExtractionError';
    }
}
export function parseExtractConversationSignalsInput(input) {
    const parsed = extractConversationSignalsInputSchema.safeParse(input);
    if (!parsed.success)
        throw new ConversationSignalExtractionError('invalid_input');
    return parsed.data;
}
/** Shared parser for provider or test implementations; unknown fields are rejected by the schema. */
export function parseConversationSignalExtraction(input) {
    const parsed = conversationSignalExtractionSchema.safeParse(input);
    if (!parsed.success)
        throw new ConversationSignalExtractionError('invalid_response');
    return parsed.data;
}
