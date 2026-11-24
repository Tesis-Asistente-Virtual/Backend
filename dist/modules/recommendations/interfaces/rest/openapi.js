import { z } from 'zod';
import { generateRecommendationsRequestSchema, latestRecommendationsResponseSchema } from './recommendations-controller.js';
const toSchema = (value) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const security = [{ bearerAuth: [] }];
const error = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false };
export const recommendationSchemas = {
    GenerateRecommendationsRequest: toSchema(generateRecommendationsRequestSchema),
    RecommendationResponse: toSchema(latestRecommendationsResponseSchema),
};
export const recommendationPaths = {
    '/api/v1/me/recommendations/generate': {
        post: {
            tags: ['Recommendations'], summary: 'Generar o recuperar recomendaciones para un análisis propio', security,
            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateRecommendationsRequest' }, example: {} } } },
            responses: {
                '201': { description: 'Nuevo conjunto generado', content: { 'application/json': { schema: { $ref: '#/components/schemas/RecommendationResponse' } } } },
                '200': { description: 'Conjunto existente idempotente', content: { 'application/json': { schema: { $ref: '#/components/schemas/RecommendationResponse' } } } },
                '400': { description: 'Cuerpo inválido', content: { 'application/json': { schema: error } } },
                '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
                '403': { description: 'Falta consentimiento vigente', content: { 'application/json': { schema: error } } },
                '404': { description: 'Análisis propio inexistente o vencido', content: { 'application/json': { schema: error } } },
                '409': { description: 'Generación ya en curso o conflicto de estado', content: { 'application/json': { schema: error } } },
                '502': { description: 'Salida del proveedor no válida', content: { 'application/json': { schema: error } } },
                '503': { description: 'Función o proveedor no disponible', content: { 'application/json': { schema: error } } },
            },
        },
    },
    '/api/v1/me/recommendations/latest': {
        get: {
            tags: ['Recommendations'], summary: 'Consultar mis recomendaciones vigentes', security,
            responses: {
                '200': { description: 'Conjunto vigente o estado vacío explícito', content: { 'application/json': { schema: { $ref: '#/components/schemas/RecommendationResponse' } } } },
                '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
                '403': { description: 'Falta consentimiento vigente', content: { 'application/json': { schema: error } } },
                '503': { description: 'Función no disponible', content: { 'application/json': { schema: error } } },
            },
        },
    },
};
