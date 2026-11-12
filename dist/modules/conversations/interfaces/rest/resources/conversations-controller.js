import { AssistantGenerationUnavailable, ConversationArchived } from '../../../application/internal/command-services/send-conversation-message.js';
import { conversationIdParamsSchema, createConversationRequestSchema, paginationQuerySchema, sendConversationMessageRequestSchema } from '../validation/conversation-request-schemas.js';
import { toConversationMessageResource, toConversationResource, toPageResource } from '../transformers/conversation-transformer.js';
async function writeWhenReady(res, frame, signal) {
    if (signal.aborted)
        return;
    if (res.destroyed || res.writableEnded)
        throw new Error('SSE connection is closed');
    if (res.write(frame))
        return;
    await new Promise((resolve, reject) => {
        const cleanup = () => {
            res.off('drain', onDrain);
            res.off('close', onClose);
            signal.removeEventListener('abort', onAbort);
        };
        const onDrain = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(new Error('SSE connection closed')); };
        const onAbort = () => { cleanup(); reject(new Error('SSE stream cancelled')); };
        res.once('drain', onDrain);
        res.once('close', onClose);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted || res.destroyed || res.writableEnded)
            onAbort();
    });
}
export class ConversationsController {
    createConversation;
    listConversations;
    getConversation;
    listMessages;
    sendMessage;
    streamMessage;
    constructor(createConversation, listConversations, getConversation, listMessages, sendMessage, streamMessage) {
        this.createConversation = createConversation;
        this.listConversations = listConversations;
        this.getConversation = getConversation;
        this.listMessages = listMessages;
        this.sendMessage = sendMessage;
        this.streamMessage = streamMessage;
    }
    async create(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const input = createConversationRequestSchema.parse(req.body);
        const conversation = await this.createConversation.execute(accountId, input.title ?? null);
        res.status(201).json(toConversationResource(conversation));
    }
    async list(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const pagination = paginationQuerySchema.parse(req.query);
        const page = await this.listConversations.execute(accountId, pagination);
        res.status(200).json(toPageResource(page, toConversationResource));
    }
    async get(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = conversationIdParamsSchema.parse(req.params);
        res.status(200).json(toConversationResource(await this.getConversation.execute(id, accountId)));
    }
    async listConversationMessages(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = conversationIdParamsSchema.parse(req.params);
        const pagination = paginationQuerySchema.parse(req.query);
        const page = await this.listMessages.execute(id, accountId, pagination);
        res.status(200).json(toPageResource(page, toConversationMessageResource));
    }
    async sendConversationMessage(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = conversationIdParamsSchema.parse(req.params);
        const { content } = sendConversationMessageRequestSchema.parse(req.body);
        if (!this.sendMessage) {
            const conversation = await this.getConversation.execute(id, accountId);
            if (conversation.status !== 'active')
                throw new ConversationArchived();
            throw new AssistantGenerationUnavailable();
        }
        const result = await this.sendMessage.execute(accountId, id, content);
        res.status(201).json({
            userMessage: toConversationMessageResource(result.userMessage),
            assistantMessage: toConversationMessageResource(result.assistantMessage),
        });
    }
    async streamConversationMessage(req, res) {
        const accountId = req.auth?.accountId;
        if (!accountId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { id } = conversationIdParamsSchema.parse(req.params);
        const { content } = sendConversationMessageRequestSchema.parse(req.body);
        if (!this.streamMessage) {
            const conversation = await this.getConversation.execute(id, accountId);
            if (conversation.status !== 'active')
                throw new ConversationArchived();
            throw new AssistantGenerationUnavailable();
        }
        const abortController = new AbortController();
        const abortOnDisconnect = () => {
            if (!res.writableEnded)
                abortController.abort();
        };
        const abortOnRequestAbort = () => abortController.abort();
        res.on('close', abortOnDisconnect);
        req.on('aborted', abortOnRequestAbort);
        if (req.aborted || res.destroyed)
            abortController.abort();
        const emit = async (event) => {
            if (abortController.signal.aborted)
                return;
            if (res.destroyed || res.writableEnded)
                throw new Error('SSE connection is closed');
            const payload = event.type === 'message.started'
                ? { messageId: event.messageId }
                : event.type === 'message.delta'
                    ? { text: event.text }
                    : event.type === 'message.completed'
                        ? { messageId: event.messageId, status: event.status }
                        : event.type === 'stream.error'
                            ? { code: event.code }
                            : {};
            await writeWhenReady(res, `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`, abortController.signal);
        };
        try {
            await this.streamMessage.execute(accountId, id, content, abortController.signal, {
                onReady: async () => {
                    res.status(200);
                    res.set({
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'Cache-Control': 'no-cache, no-transform',
                        Connection: 'keep-alive',
                        'X-Accel-Buffering': 'no',
                    });
                    res.flushHeaders();
                },
                emit,
            });
        }
        catch (error) {
            if (res.headersSent) {
                if (!abortController.signal.aborted && !res.destroyed && !res.writableEnded) {
                    res.write(`event: stream.error\ndata: ${JSON.stringify({ code: 'internal_error' })}\n\n`);
                }
            }
            else {
                throw error;
            }
        }
        finally {
            res.off('close', abortOnDisconnect);
            req.off('aborted', abortOnRequestAbort);
            if (!res.destroyed && !res.writableEnded && res.headersSent)
                res.end();
        }
    }
}
