import { z } from 'zod';
import { createConversationRequestSchema, sendConversationMessageRequestSchema } from './validation/conversation-request-schemas.js';

const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const conversationResponse = z.object({
  id: z.string().uuid(), title: z.string().nullable(), status: z.enum(['active', 'archived']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const messageResponse = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(), role: z.enum(['user', 'assistant']),
  content: z.string(), status: z.enum(['generating', 'completed', 'failed']), createdAt: z.string().datetime(),
}).strict();
const sentTurnResponse = z.object({ userMessage: messageResponse, assistantMessage: messageResponse }).strict();
const paginationResponse = { type: 'object', properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, hasMore: { type: 'boolean' } }, required: ['limit', 'offset', 'hasMore'], additionalProperties: false } as const;
const pageSchema = (item: object) => ({ type: 'object', properties: { items: { type: 'array', items: item }, pagination: paginationResponse }, required: ['items', 'pagination'], additionalProperties: false });
const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const notFound = { $ref: '#/components/responses/ConversationNotFound' };
const serverError = { $ref: '#/components/responses/ServerError' };
const security = [{ bearerAuth: [] }];

export const conversationsSchemas = {
  CreateConversationRequest: schema(createConversationRequestSchema),
  SendConversationMessageRequest: schema(sendConversationMessageRequestSchema),
  ConversationResponse: schema(conversationResponse),
  ConversationMessageResponse: schema(messageResponse),
  SentConversationTurnResponse: schema(sentTurnResponse),
  ConversationPageResponse: pageSchema(schema(conversationResponse)),
  ConversationMessagePageResponse: pageSchema(schema(messageResponse)),
};

export const conversationsPaths = {
  '/api/v1/conversations': {
    post: {
      tags: ['Conversations'], summary: 'Crear conversación', security,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateConversationRequest' }, example: { title: 'Conversación inicial' } } } },
      responses: {
        '201': { description: 'Conversación creada', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationResponse' } } } },
        '400': badRequest, '401': unauthorized, '500': serverError,
      },
    },
    get: {
      tags: ['Conversations'], summary: 'Listar conversaciones propias', security,
      parameters: [
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 } },
      ],
      responses: {
        '200': { description: 'Página de conversaciones', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationPageResponse' } } } },
        '400': badRequest, '401': unauthorized, '500': serverError,
      },
    },
  },
  '/api/v1/conversations/{id}': {
    get: {
      tags: ['Conversations'], summary: 'Consultar una conversación propia', security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'Conversación', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationResponse' } } } },
        '400': badRequest, '401': unauthorized, '404': notFound, '500': serverError,
      },
    },
  },
  '/api/v1/conversations/{id}/messages': {
    post: {
      tags: ['Conversations'], summary: 'Enviar mensaje y obtener respuesta del asistente', security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendConversationMessageRequest' }, example: { content: 'Quiero conversar sobre cómo me he sentido últimamente.' } } } },
      responses: {
        '201': { description: 'Mensaje del estudiante y respuesta completa persistidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/SentConversationTurnResponse' } } } },
        '400': badRequest, '401': unauthorized, '404': notFound,
        '409': { $ref: '#/components/responses/ConversationConflict' },
        '503': { $ref: '#/components/responses/AssistantUnavailable' },
        '500': serverError,
      },
    },
    get: {
      tags: ['Conversations'], summary: 'Listar mensajes de una conversación propia', security,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 } },
      ],
      responses: {
        '200': { description: 'Página de mensajes', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationMessagePageResponse' } } } },
        '400': badRequest, '401': unauthorized, '404': notFound, '500': serverError,
      },
    },
  },
} as const;
