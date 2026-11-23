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
  StreamConversationMessageRequest: schema(sendConversationMessageRequestSchema),
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
        '403': { description: 'Consentimiento vigente requerido para ai_conversation_processing' },
        '409': { $ref: '#/components/responses/ConversationConflict' },
        '503': { description: 'Estado de consentimiento o servicio de generación temporalmente no disponible' },
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
  '/api/v1/conversations/{id}/messages/stream': {
    post: {
      tags: ['Conversations'], summary: 'Enviar mensaje y recibir la respuesta progresivamente mediante SSE', security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/StreamConversationMessageRequest' }, example: { content: 'Quiero conversar sobre cómo me he sentido últimamente.' } } } },
      responses: {
        '200': {
          description: 'Flujo SSE progresivo. Swagger UI puede no representar incrementalmente todos los eventos.',
          content: { 'text/event-stream': { schema: { type: 'string' }, examples: {
            started: { summary: 'Inicio del turno', value: 'event: message.started\\ndata: {"messageId":"550e8400-e29b-41d4-a716-446655440002"}\\n\\n' },
            delta: { summary: 'Fragmento de texto', value: 'event: message.delta\\ndata: {"text":"Hola, "}\\n\\n' },
            completed: { summary: 'Turno persistido', value: 'event: message.completed\\ndata: {"messageId":"550e8400-e29b-41d4-a716-446655440003","status":"completed"}\\n\\nevent: stream.completed\\ndata: {}\\n\\n' },
            error: { summary: 'Fallo después del inicio', value: 'event: stream.error\\ndata: {"code":"generation_failed"}\\n\\n' },
            persistenceFailed: { summary: 'No se pudo persistir el mensaje final', value: 'event: stream.error\\ndata: {"code":"persistence_failed"}\\n\\n' },
            consentRequired: { summary: 'Consentimiento retirado durante el turno', value: 'event: stream.error\\ndata: {"code":"consent_required"}\\n\\n' },
            consentUnavailable: { summary: 'Estado de consentimiento no disponible', value: 'event: stream.error\\ndata: {"code":"consent_unavailable"}\\n\\n' },
            internalError: { summary: 'Fallo interno después de iniciar SSE', value: 'event: stream.error\\ndata: {"code":"internal_error"}\\n\\n' },
          } } },
        },
        '400': badRequest, '401': unauthorized, '404': notFound,
        '403': { description: 'Consentimiento vigente requerido para ai_conversation_processing antes de iniciar SSE. Si la revocación se detecta después de iniciar, se emite stream.error con code consent_required' },
        '409': { $ref: '#/components/responses/ConversationConflict' },
        '503': { description: 'Estado de consentimiento o servicio de generación temporalmente no disponible. Tras iniciar SSE, un fallo de consentimiento se comunica como stream.error con code consent_unavailable' }, '500': serverError,
      },
    },
  },
} as const;
