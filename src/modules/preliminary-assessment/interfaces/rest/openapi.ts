import { z } from 'zod';
import { assessmentAnswerSchema } from '../../domain/model/assessment-response.js';
import { instrumentQuestionSchema } from '../../domain/model/instrument.js';
import { startAssessmentBodySchema, submitAssessmentResponseBodySchema } from './validation/assessment-request-schemas.js';

const toSchema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const security = [{ bearerAuth: [] }];
const errorSchema = { $ref: '#/components/schemas/ErrorResponse' };
const errorResponses = (codes: readonly string[]) => Object.fromEntries(codes.map(code => [code, {
  description: ({
    '400': 'Datos inválidos', '401': 'No autenticado', '403': 'Consentimiento vigente requerido',
    '404': 'Evaluación o resultado no encontrado', '409': 'Estado incompatible, instrumento no disponible o conflicto concurrente',
    '500': 'Error interno',
  } as Record<string, string>)[code] ?? 'Error',
  content: { 'application/json': { schema: errorSchema } },
}]));
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const pagination = [
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 99, default: 20 } },
  { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 } },
];

const answerResource = z.object({
  assessmentId: z.string().uuid(), instrumentVersionId: z.string().uuid(), questionId: z.string().uuid(),
  status: z.enum(['pending', 'answered']), answer: assessmentAnswerSchema.nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const assessmentResource = z.object({
  id: z.string().uuid(), assessmentType: z.string(), mode: z.enum(['conversational_contextual', 'structured_instrument']),
  status: z.enum(['in_progress', 'paused', 'completed', 'withdrawn', 'expired']), instrumentVersionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  withdrawnAt: z.string().datetime().nullable(), updatedAt: z.string().datetime(), responses: z.array(answerResource),
}).strict();
const unavailable = z.object({ status: z.literal('not_available'), reason: z.enum(['no_approved_instrument', 'no_approved_scoring_rules', 'not_assessed']) }).strict();
const resultResource = z.object({
  schemaVersion: z.literal('1.0'), assessmentId: z.string().uuid(), instrumentVersionId: z.string().uuid().nullable(),
  calculatedAt: z.string().datetime(), instrumentScores: unavailable, interpretation: unavailable,
  attentionPriority: unavailable, safetyState: z.object({ status: z.literal('not_available'), reason: z.literal('not_assessed') }).strict(),
}).strict();
const pageSchema = (item: z.ZodType) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: toSchema(item) },
    pagination: { type: 'object', properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, hasMore: { type: 'boolean' } }, required: ['limit', 'offset', 'hasMore'], additionalProperties: false },
  },
  required: ['items', 'pagination'], additionalProperties: false,
});
const response = (description: string, ref: string) => ({ description, content: { 'application/json': { schema: { $ref: ref } } } });

export const preliminaryAssessmentSchemas = {
  StartAssessmentRequest: toSchema(startAssessmentBodySchema),
  SubmitAssessmentResponseRequest: toSchema(submitAssessmentResponseBodySchema),
  AssessmentPaginationQuery: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 99, default: 20 }, offset: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 } }, additionalProperties: false },
  AssessmentResponse: toSchema(assessmentResource),
  AssessmentResponseItem: toSchema(answerResource),
  AssessmentPage: pageSchema(assessmentResource),
  AssessmentResult: toSchema(resultResource),
  AssessmentInfo: {
    type: 'object',
    properties: {
      assessmentAvailable: { type: 'boolean' }, mode: { type: 'string', enum: ['structured_instrument'] },
      instruments: { type: 'array', items: {
        type: 'object', properties: {
          instrumentId: { type: 'string', format: 'uuid' }, instrumentVersionId: { type: 'string', format: 'uuid' },
          version: { type: 'string' }, effectiveAt: { type: 'string', format: 'date-time' },
          questions: { type: 'array', items: toSchema(instrumentQuestionSchema) },
        }, required: ['instrumentId', 'instrumentVersionId', 'version', 'effectiveAt', 'questions'], additionalProperties: false,
      } },
    }, required: ['assessmentAvailable', 'mode', 'instruments'], additionalProperties: false,
  },
};

const standardErrors = errorResponses(['400', '401', '403', '404', '409', '500']);
export const preliminaryAssessmentPaths = {
  '/api/v1/preliminary-assessments/info': {
    get: {
      tags: ['Preliminary Assessment'], summary: 'Consultar disponibilidad de instrumentos aprobados y vigentes', security,
      responses: {
        '200': response('Disponibilidad; instruments vacío significa que no hay instrumento utilizable', '#/components/schemas/AssessmentInfo'),
        ...errorResponses(['401', '500']),
      },
    },
  },
  '/api/v1/preliminary-assessments': {
    post: {
      tags: ['Preliminary Assessment'], summary: 'Iniciar evaluación con instrumento aprobado',
      description: 'Requiere consentimiento vigente para preliminary_assessment. No se crean evaluaciones cuando no hay instrumento disponible.',
      security,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/StartAssessmentRequest' } } } },
      responses: { '201': response('Evaluación iniciada', '#/components/schemas/AssessmentResponse'), ...standardErrors },
    },
    get: {
      tags: ['Preliminary Assessment'], summary: 'Listar evaluaciones propias', security, parameters: pagination,
      responses: { '200': response('Historial paginado', '#/components/schemas/AssessmentPage'), ...errorResponses(['400', '401', '500']) },
    },
  },
  '/api/v1/preliminary-assessments/{id}': {
    get: {
      tags: ['Preliminary Assessment'], summary: 'Consultar una evaluación propia', security, parameters: [idParam],
      responses: { '200': response('Evaluación', '#/components/schemas/AssessmentResponse'), ...errorResponses(['400', '401', '404', '500']) },
    },
  },
  '/api/v1/preliminary-assessments/{id}/responses': {
    post: {
      tags: ['Preliminary Assessment'], summary: 'Guardar o actualizar una respuesta',
      description: 'Revalida el consentimiento vigente y solo acepta preguntas de la versión asignada.', security, parameters: [idParam],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitAssessmentResponseRequest' } } } },
      responses: { '200': response('Respuesta validada', '#/components/schemas/AssessmentResponseItem'), ...standardErrors },
    },
  },
  '/api/v1/preliminary-assessments/{id}/pause': {
    post: { tags: ['Preliminary Assessment'], summary: 'Pausar evaluación', security, parameters: [idParam], responses: { '200': response('Evaluación pausada', '#/components/schemas/AssessmentResponse'), ...standardErrors } },
  },
  '/api/v1/preliminary-assessments/{id}/resume': {
    post: { tags: ['Preliminary Assessment'], summary: 'Reanudar evaluación', description: 'Requiere consentimiento vigente para preliminary_assessment.', security, parameters: [idParam], responses: { '200': response('Evaluación reanudada', '#/components/schemas/AssessmentResponse'), ...standardErrors } },
  },
  '/api/v1/preliminary-assessments/{id}/withdraw': {
    post: { tags: ['Preliminary Assessment'], summary: 'Retirar participación en evaluación', security, parameters: [idParam], responses: { '200': response('Evaluación retirada', '#/components/schemas/AssessmentResponse'), ...standardErrors } },
  },
  '/api/v1/preliminary-assessments/{id}/complete': {
    post: {
      tags: ['Preliminary Assessment'], summary: 'Finalizar evaluación',
      description: 'Guarda el estado final y el resultado no puntuado de forma atómica e idempotente.', security, parameters: [idParam],
      responses: {
        '200': {
          description: 'Evaluación completada y resultado no clínico',
          content: { 'application/json': { schema: {
            type: 'object',
            properties: { assessment: { $ref: '#/components/schemas/AssessmentResponse' }, result: { $ref: '#/components/schemas/AssessmentResult' } },
            required: ['assessment', 'result'], additionalProperties: false,
          } } },
        },
        ...standardErrors,
      },
    },
  },
  '/api/v1/preliminary-assessments/{id}/result': {
    get: {
      tags: ['Preliminary Assessment'], summary: 'Consultar resultado propio',
      description: 'Puntuaciones, interpretación y prioridad se indican como no disponibles; el resultado no constituye diagnóstico.', security, parameters: [idParam],
      responses: { '200': response('Resultado orientativo no clínico', '#/components/schemas/AssessmentResult'), ...errorResponses(['401', '404', '500']) },
    },
  },
} as const;
