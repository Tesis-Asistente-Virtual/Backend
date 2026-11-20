import { z } from 'zod';
import { signUpSchema } from '../../../modules/authentication/application/internal/command-services/sign-up.js';
import { signInSchema } from '../../../modules/authentication/application/internal/command-services/sign-in.js';
import { refreshSessionSchema } from '../../../modules/authentication/application/internal/command-services/refresh-session.js';
import { signOutSchema } from '../../../modules/authentication/application/internal/command-services/sign-out.js';
import { updateMyProfileSchema } from '../../../modules/users/interfaces/rest/validation/update-my-profile-schema.js';
import { authenticationPaths } from '../../../modules/authentication/interfaces/rest/openapi.js';
import { usersPaths } from '../../../modules/users/interfaces/rest/openapi.js';
import { conversationsPaths, conversationsSchemas } from '../../../modules/conversations/interfaces/rest/openapi.js';
import { consentPaths, consentSchemas } from '../../../modules/consent/interfaces/rest/openapi.js';
const profile = z.object({ firstName: z.string().nullable(), lastName: z.string().nullable(), phone: z.string().nullable() });
const errorResponse = z.object({ error: z.string() });
const schema = (value) => z.toJSONSchema(value, { target: 'openapi-3.0' });
export const openApiDocument = {
    openapi: '3.0.3',
    info: {
        title: 'Backend API - Asistente Virtual de Tesis',
        version: '1.0.0',
        description: 'API REST para autenticación y gestión de perfiles de estudiantes universitarios.',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Servidor local' }],
    tags: [{ name: 'Authentication' }, { name: 'Users' }, { name: 'Conversations' }, { name: 'Consent & Privacy' }, { name: 'Health' }],
    paths: {
        ...authenticationPaths,
        ...usersPaths,
        ...conversationsPaths,
        ...consentPaths,
        '/health': { get: { tags: ['Health'], summary: 'Verificar disponibilidad del servicio', responses: { '200': { description: 'Servicio disponible', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } }, required: ['status'] } } } } } } },
    },
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        schemas: {
            SignUpRequest: schema(signUpSchema),
            SignUpResponse: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, message: { type: 'string', example: 'Cuenta registrada correctamente' } }, required: ['id', 'email', 'message'], additionalProperties: false },
            SignInRequest: schema(signInSchema),
            TokenResponse: { type: 'object', properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' }, tokenType: { type: 'string', enum: ['Bearer'] }, expiresIn: { type: 'integer', example: 900 } }, required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn'], additionalProperties: false },
            RefreshRequest: schema(refreshSessionSchema),
            SignOutRequest: schema(signOutSchema),
            UserProfileResponse: schema(profile),
            UpdateMyProfileRequest: schema(updateMyProfileSchema),
            ErrorResponse: schema(errorResponse),
            ...conversationsSchemas,
            ...consentSchemas,
        },
        responses: {
            BadRequest: { description: 'Solicitud inválida', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Invalid request data' } } } },
            Unauthorized: { description: 'Autenticación o token inválido', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            Conflict: { description: 'Email ya registrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Email is already registered' } } } },
            NotFound: { description: 'Perfil no encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            ConversationNotFound: { description: 'Conversación no encontrada', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Conversation not found' } } } },
            ConversationConflict: { description: 'Conversación archivada o turno en curso', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            AssistantUnavailable: { description: 'Generación temporalmente no disponible', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Text generation is temporarily unavailable' } } } },
            TooManyRequests: { description: 'Límite de solicitudes excedido', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Too many attempts' } } } },
            ServerError: { description: 'Error interno', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Internal server error' } } } },
        },
    },
};
