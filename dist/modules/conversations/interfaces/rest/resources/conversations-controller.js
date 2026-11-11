import { AssistantGenerationUnavailable, ConversationArchived } from '../../../application/internal/command-services/send-conversation-message.js';
import { conversationIdParamsSchema, createConversationRequestSchema, paginationQuerySchema, sendConversationMessageRequestSchema } from '../validation/conversation-request-schemas.js';
import { toConversationMessageResource, toConversationResource, toPageResource } from '../transformers/conversation-transformer.js';
export class ConversationsController {
    createConversation;
    listConversations;
    getConversation;
    listMessages;
    sendMessage;
    constructor(createConversation, listConversations, getConversation, listMessages, sendMessage) {
        this.createConversation = createConversation;
        this.listConversations = listConversations;
        this.getConversation = getConversation;
        this.listMessages = listMessages;
        this.sendMessage = sendMessage;
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
}
