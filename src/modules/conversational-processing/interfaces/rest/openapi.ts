import { z } from 'zod';
import {
  extractConversationSignalsRequestSchema,
  extractConversationSignalsResponseSchema,
  generateConversationSignalResultResponseSchema,
} from './conversation-signal-extraction-controller.js';

const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const security = [{ bearerAuth: [] }];
const error = { $ref: '#/components/schemas/ErrorResponse' };

export const conversationSignalExtractionSchemas = {
  ExtractConversationSignalsRequest: schema(extractConversationSignalsRequestSchema),
  ConversationSignalExtractionResponse: schema(extractConversationSignalsResponseSchema),
  GenerateConversationSignalResultResponse: schema(generateConversationSignalResultResponseSchema),
};

export const conversationSignalExtractionPaths = {
  '/api/v1/conversations/{id}/signals/extract': {
    post: {
      tags: ['Conversational Processing'],
      summary: 'Solicitar extracción estructurada de mensajes seleccionados de una conversación propia',
      description: 'Operación explícita, no automática. Requiere consentimiento vigente para ai_conversation_processing y structured_signal_extraction. Devuelve observaciones tentativas, sin diagnóstico ni puntuaciones; no persiste el resultado. La calidad de extracción no equivale a evaluación clínica.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ExtractConversationSignalsRequest' }, example: { messageIds: ['550e8400-e29b-41d4-a716-446655440010'] } } },
      },
      responses: {
        '200': { description: 'Extracción estructurada validada; solo incluye referencias a los mensajes solicitados', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationSignalExtractionResponse' } } } },
        '400': { description: 'UUID, referencias o solicitud inválidos', content: { 'application/json': { schema: error } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta uno de los consentimientos vigentes requeridos', content: { 'application/json': { schema: error } } },
        '404': { description: 'Conversación inexistente o no perteneciente a la cuenta', content: { 'application/json': { schema: error } } },
        '503': { description: 'Autorización o extracción temporalmente no disponible', content: { 'application/json': { schema: error } } },
      },
    },
  },
  '/api/v1/conversations/{id}/signals/results': {
    post: {
      tags: ['Conversational Processing'],
      summary: 'Generar un resultado conversacional descriptivo efímero',
      description: 'Solicitud explícita. Requiere los consentimientos vigentes ai_conversation_processing y structured_signal_extraction. Devuelve el resultado directamente, sin persistirlo ni ofrecer consulta posterior por ID. El resumen es determinista y descriptivo; no diagnostica, no calcula severidad clínica y no evalúa seguridad.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ExtractConversationSignalsRequest' }, example: { messageIds: ['550e8400-e29b-41d4-a716-446655440010'] } } },
      },
      responses: {
        '200': { description: 'Resultado descriptivo efímero con referencias verificables a los mensajes seleccionados', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateConversationSignalResultResponse' } } } },
        '400': { description: 'UUID, referencias o solicitud inválidos', content: { 'application/json': { schema: error } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta uno de los consentimientos vigentes requeridos', content: { 'application/json': { schema: error } } },
        '404': { description: 'Conversación inexistente o no perteneciente a la cuenta', content: { 'application/json': { schema: error } } },
        '503': { description: 'Autorización o extracción temporalmente no disponible', content: { 'application/json': { schema: error } } },
      },
    },
  },
} as const;
