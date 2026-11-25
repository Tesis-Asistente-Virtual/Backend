import { z } from 'zod';
import { createPsychologicalReferralRequestSchema, psychologicalReferralPreviewSchema } from '../../domain/model/psychological-referral.js';
import { sendPsychologicalReferralRequestSchema } from './psychological-referral-controller.js';

const toSchema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const security = [{ bearerAuth: [] }];
const error = { $ref: '#/components/schemas/ErrorResponse' };

export const psychologicalReferralSchemas = {
  CreatePsychologicalReferralRequest: toSchema(createPsychologicalReferralRequestSchema),
  SendPsychologicalReferralRequest: toSchema(sendPsychologicalReferralRequestSchema),
  PsychologicalReferralPreview: toSchema(psychologicalReferralPreviewSchema),
};

export const psychologicalReferralPaths = {
  '/api/v1/me/psychological-referrals': {
    post: {
      tags: ['Psychological Referrals'], summary: 'Crear borrador voluntario de solicitud de orientación', security,
      parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePsychologicalReferralRequest' } } } },
      responses: {
        '201': { description: 'Borrador creado; muestra destinatario y vista previa', content: { 'application/json': { schema: { $ref: '#/components/schemas/PsychologicalReferralPreview' } } } },
        '200': { description: 'Borrador idempotente existente', content: { 'application/json': { schema: { $ref: '#/components/schemas/PsychologicalReferralPreview' } } } },
        '400': { description: 'Cuerpo o clave de idempotencia inválidos', content: { 'application/json': { schema: error } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta consentimiento de divulgación vigente', content: { 'application/json': { schema: error } } },
        '404': { description: 'Análisis propio inexistente o vencido', content: { 'application/json': { schema: error } } },
        '503': { description: 'La función no está habilitada en este entorno de prueba', content: { 'application/json': { schema: error } } },
      },
    },
  },
  '/api/v1/me/psychological-referrals/{id}': {
    get: {
      tags: ['Psychological Referrals'], summary: 'Consultar vista previa propia', security,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'Vista previa con destinatario exacto', content: { 'application/json': { schema: { $ref: '#/components/schemas/PsychologicalReferralPreview' } } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta consentimiento vigente', content: { 'application/json': { schema: error } } },
        '404': { description: 'Borrador propio no encontrado o fuente vencida', content: { 'application/json': { schema: error } } },
        '503': { description: 'La función no está habilitada', content: { 'application/json': { schema: error } } },
      },
    },
    delete: {
      tags: ['Psychological Referrals'], summary: 'Cancelar un borrador propio antes de enviarlo', security,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'Borrador cancelado y contenido del reporte eliminado' },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '404': { description: 'Borrador propio no encontrado o ya no cancelable', content: { 'application/json': { schema: error } } },
        '503': { description: 'La función no está habilitada', content: { 'application/json': { schema: error } } },
      },
    },
  },
  '/api/v1/me/psychological-referrals/{id}/send': {
    post: {
      tags: ['Psychological Referrals'], summary: 'Compartir una vista previa tras confirmación explícita', security,
      parameters: [
        { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendPsychologicalReferralRequest' } } } },
      responses: {
        '200': { description: 'Correo aceptado por SMTP o envío idempotente previamente registrado', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/PsychologicalReferralPreview' }, { type: 'object', properties: { duplicate: { type: 'boolean' } }, required: ['duplicate'] }] } } } },
        '400': { description: 'Confirmación inválida', content: { 'application/json': { schema: error } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta consentimiento vigente', content: { 'application/json': { schema: error } } },
        '404': { description: 'Borrador propio no encontrado o fuente vencida', content: { 'application/json': { schema: error } } },
        '409': { description: 'Envío duplicado con otra clave o estado incompatible', content: { 'application/json': { schema: error } } },
        '503': { description: 'Proveedor no disponible o resultado de entrega incierto; no reintentar automáticamente', content: { 'application/json': { schema: error } } },
      },
    },
  },
} as const;

