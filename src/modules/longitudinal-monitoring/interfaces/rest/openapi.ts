import { z } from 'zod';
import { startMonitoringEnrollmentBodySchema } from './validation/monitoring-request-schemas.js';

const toSchema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const security = [{ bearerAuth: [] }];
const error = { $ref: '#/components/schemas/ErrorResponse' };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const pagination = [
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 99, default: 20 } },
  { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 } },
];
const response = (description: string, ref: string) => ({ description, content: { 'application/json': { schema: { $ref: ref } } } });
const errors = (codes: readonly string[]) => Object.fromEntries(codes.map((code) => [code, {
  description: ({
    '400': 'Solicitud inválida', '401': 'JWT ausente o inválido', '403': 'Consentimiento vigente requerido',
    '404': 'Inscripción no encontrada', '409': 'Estado incompatible, duplicado o conflicto concurrente',
    '500': 'Error interno', '503': 'Consent no disponible; operación bloqueada',
  } as Record<string, string>)[code] ?? 'Error', content: { 'application/json': { schema: error } },
}]));

const enrollment = z.object({
  id: z.string().uuid(), status: z.enum(['active', 'paused', 'withdrawn', 'completed']), contractVersion: z.literal('1.0'),
  consentedAt: z.string().datetime(), enrolledAt: z.string().datetime(), statusChangedAt: z.string().datetime(),
  updatedAt: z.string().datetime(), revision: z.number().int().positive(),
}).strict();
const session = z.object({
  id: z.string().uuid(), enrollmentId: z.string().uuid(), status: z.enum(['in_progress', 'completed', 'abandoned']),
  openedAt: z.string().datetime(), updatedAt: z.string().datetime(), closedAt: z.string().datetime().nullable(), revision: z.number().int().positive(),
}).strict();
const page = (item: z.ZodType) => ({
  type: 'object', properties: {
    items: { type: 'array', items: toSchema(item) },
    pagination: { type: 'object', properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, hasMore: { type: 'boolean' } }, required: ['limit', 'offset', 'hasMore'], additionalProperties: false },
  }, required: ['items', 'pagination'], additionalProperties: false,
});

export const monitoringSchemas = {
  StartMonitoringEnrollmentRequest: toSchema(startMonitoringEnrollmentBodySchema),
  MonitoringEnrollment: toSchema(enrollment),
  MonitoringSession: toSchema(session),
  MonitoringEnrollmentPage: page(enrollment),
  MonitoringSessionPage: page(session),
  MonitoringInfo: {
    type: 'object', properties: {
      purpose: { type: 'string', enum: ['longitudinal_monitoring'] }, voluntary: { type: 'boolean', enum: [true] },
      consentRequired: { type: 'boolean', enum: [true] }, automatedCollection: { type: 'boolean', enum: [false] },
      measurementsAvailable: { type: 'boolean', enum: [false] }, trendsAvailable: { type: 'boolean', enum: [false] },
      clinicalAssessment: { type: 'boolean', enum: [false] },
    }, required: ['purpose', 'voluntary', 'consentRequired', 'automatedCollection', 'measurementsAvailable', 'trendsAvailable', 'clinicalAssessment'], additionalProperties: false,
  },
};

const standardErrors = errors(['400', '401', '403', '404', '409', '500', '503']);
export const monitoringPaths = {
  '/api/v1/monitoring/info': {
    get: { tags: ['Longitudinal Monitoring'], summary: 'Consultar alcance del seguimiento voluntario', description: 'No recopila síntomas ni mediciones automáticamente. No es una evaluación clínica.', security, responses: { '200': response('Capacidades y límites actuales', '#/components/schemas/MonitoringInfo'), ...errors(['401', '500']) } },
  },
  '/api/v1/monitoring/enrollments': {
    post: {
      tags: ['Longitudinal Monitoring'], summary: 'Iniciar una inscripción voluntaria', description: 'Requiere opt-in explícito y consentimiento vigente para longitudinal_monitoring. No crea mediciones.', security,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/StartMonitoringEnrollmentRequest' }, example: { explicitOptIn: true } } } },
      responses: { '201': response('Inscripción creada', '#/components/schemas/MonitoringEnrollment'), ...standardErrors },
    },
    get: { tags: ['Longitudinal Monitoring'], summary: 'Listar inscripciones propias', security, parameters: pagination, responses: { '200': response('Historial paginado', '#/components/schemas/MonitoringEnrollmentPage'), ...errors(['400', '401', '500']) } },
  },
  '/api/v1/monitoring/enrollments/{id}': {
    get: { tags: ['Longitudinal Monitoring'], summary: 'Consultar una inscripción propia', security, parameters: [idParam], responses: { '200': response('Metadatos de inscripción', '#/components/schemas/MonitoringEnrollment'), ...errors(['400', '401', '404', '500']) } },
  },
  '/api/v1/monitoring/enrollments/{id}/pause': {
    post: { tags: ['Longitudinal Monitoring'], summary: 'Pausar una inscripción', security, parameters: [idParam], responses: { '200': response('Inscripción pausada', '#/components/schemas/MonitoringEnrollment'), ...standardErrors } },
  },
  '/api/v1/monitoring/enrollments/{id}/resume': {
    post: { tags: ['Longitudinal Monitoring'], summary: 'Reanudar una inscripción pausada', description: 'Requiere consentimiento vigente y la misma versión de aviso asociada a la inscripción. Si cambió, debe retirarse y realizar una nueva inscripción.', security, parameters: [idParam], responses: { '200': response('Inscripción reanudada', '#/components/schemas/MonitoringEnrollment'), ...standardErrors } },
  },
  '/api/v1/monitoring/enrollments/{id}/withdraw': {
    post: { tags: ['Longitudinal Monitoring'], summary: 'Retirar una inscripción', description: 'Detiene el seguimiento futuro; no elimina datos existentes.', security, parameters: [idParam], responses: { '200': response('Inscripción retirada', '#/components/schemas/MonitoringEnrollment'), ...standardErrors } },
  },
  '/api/v1/monitoring/enrollments/{id}/complete': {
    post: { tags: ['Longitudinal Monitoring'], summary: 'Finalizar una inscripción', security, parameters: [idParam], responses: { '200': response('Inscripción finalizada', '#/components/schemas/MonitoringEnrollment'), ...standardErrors } },
  },
  '/api/v1/monitoring/enrollments/{id}/sessions': {
    post: { tags: ['Longitudinal Monitoring'], summary: 'Abrir una sesión explícita de monitoreo', description: 'Requiere inscripción activa y consentimiento vigente. No crea preguntas ni mediciones.', security, parameters: [idParam], responses: { '201': response('Sesión abierta', '#/components/schemas/MonitoringSession'), ...standardErrors } },
    get: { tags: ['Longitudinal Monitoring'], summary: 'Listar sesiones propias de una inscripción', security, parameters: [idParam, ...pagination], responses: { '200': response('Sesiones paginadas', '#/components/schemas/MonitoringSessionPage'), ...errors(['400', '401', '404', '500']) } },
  },
} as const;
