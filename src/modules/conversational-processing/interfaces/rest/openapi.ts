import { z } from 'zod';
import {
  extractConversationSignalsRequestSchema,
  extractConversationSignalsResponseSchema,
  generateConversationSignalResultResponseSchema,
} from './conversation-signal-extraction-controller.js';
import {
  analyzeConversationSignalsRequestSchema,
  conversationalSignalsHistoryResponseSchema,
  latestConversationalSignalsResponseSchema,
} from './conversation-signal-analysis-controller.js';
import { conversationalSignalAnalysisSchema } from '../../domain/model/conversational-signal-analysis.js';

const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0' });
const security = [{ bearerAuth: [] }];
const error = { $ref: '#/components/schemas/ErrorResponse' };

const descriptiveResultExample = {
  status: 'completed',
  id: '550e8400-e29b-41d4-a716-446655440099',
  conversationId: '550e8400-e29b-41d4-a716-446655440001',
  generatedAt: '2026-11-22T12:00:00.000Z',
  schemaVersion: '1.0',
  extractorVersion: '1.0.0',
  sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'],
  observations: [{
    evidence: 'reported',
    manifestation: { status: 'reported', value: 'En un ejemplo ficticio, la persona mencionó cansancio durante una semana de exámenes.' },
    possibleDimensions: ['stress'],
    duration: { status: 'not_reported' },
    frequency: { status: 'not_assessed' },
    intensity: { status: 'not_assessed' },
    contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Semana de exámenes ficticia.' } }],
    functionalImpact: { status: 'not_assessed' },
    sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'],
  }],
  missingInformation: [{ field: 'duration', reason: 'not_reported' }],
  clarificationQuestions: ['¿Desde cuándo notas esta situación?'],
  summary: {
    descriptiveStatus: 'observations_available',
    reportedFacts: [
      { observationIndex: 0, field: 'manifestation', value: 'En un ejemplo ficticio, la persona mencionó cansancio durante una semana de exámenes.', sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'] },
      { observationIndex: 0, field: 'context', contextDomain: 'academic', value: 'Semana de exámenes ficticia.', sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'] },
    ],
    emptyObservationsMeaning: 'not_evidence_of_absence',
    interpretationLimits: ['descriptive_only', 'not_a_diagnosis', 'clinical_severity_not_calculated', 'not_a_safety_assessment'],
  },
  preliminaryGuidance: {
    contractVersion: '1.0',
    conversationId: '550e8400-e29b-41d4-a716-446655440001',
    sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'],
    observations: [
      { sourceObservationIndex: 0, field: 'manifestation', text: 'En un ejemplo ficticio, la persona mencionó cansancio durante una semana de exámenes.', sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'] },
      { sourceObservationIndex: 0, field: 'context', contextDomain: 'academic', text: 'Semana de exámenes ficticia.', sourceMessageIds: ['550e8400-e29b-41d4-a716-446655440010'] },
    ],
    informationGaps: [{ field: 'duration', reason: 'not_reported' }],
    suggestedFollowUpQuestions: ['¿Desde cuándo notas esta situación?'],
    generalGuidance: 'Puedes revisar o corregir estas observaciones. Si algo importante no aparece, puedes compartirlo solo si así lo deseas.',
    limitations: [
      'Este resumen se basa únicamente en los mensajes seleccionados.',
      'Las observaciones pueden no representar todo lo que quisiste expresar; puedes corregirlas.',
      'No es una evaluación ni un diagnóstico clínico y no calcula puntuaciones o niveles de severidad.',
      'No evalúa seguridad; una respuesta vacía o incompleta no demuestra ausencia de dificultades ni de riesgo.',
    ],
  },
} as const;

export const conversationSignalExtractionSchemas = {
  ExtractConversationSignalsRequest: schema(extractConversationSignalsRequestSchema),
  ConversationSignalExtractionResponse: schema(extractConversationSignalsResponseSchema),
  GenerateConversationSignalResultResponse: schema(generateConversationSignalResultResponseSchema),
  AnalyzeConversationSignalsRequest: schema(analyzeConversationSignalsRequestSchema),
  ConversationalSignalAnalysis: schema(conversationalSignalAnalysisSchema.omit({ accountId: true })),
  LatestConversationalSignalAnalysisResponse: schema(latestConversationalSignalsResponseSchema),
  ConversationalSignalAnalysisHistoryResponse: schema(conversationalSignalsHistoryResponseSchema),
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
      description: 'Solicitud explícita. Requiere los consentimientos vigentes ai_conversation_processing y structured_signal_extraction. Devuelve el resultado directamente, sin persistirlo ni ofrecer consulta posterior por ID. Incluye preliminaryGuidance, contrato versionado de orientación preliminar no diagnóstica mapeado de hechos reportados, brechas, preguntas opcionales y límites explícitos. No añade otra llamada al modelo ni transforma observaciones tentativas en conclusiones clínicas; no calcula severidad ni evalúa seguridad.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ExtractConversationSignalsRequest' }, example: { messageIds: ['550e8400-e29b-41d4-a716-446655440010'] } } },
      },
      responses: {
        '200': { description: 'Resultado descriptivo efímero con referencias verificables a los mensajes seleccionados. preliminaryGuidance separa observaciones reportadas, brechas, preguntas opcionales, orientación general y límites.', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateConversationSignalResultResponse' }, example: descriptiveResultExample } } },
        '400': { description: 'UUID, referencias o solicitud inválidos', content: { 'application/json': { schema: error } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta uno de los consentimientos vigentes requeridos', content: { 'application/json': { schema: error } } },
        '404': { description: 'Conversación inexistente o no perteneciente a la cuenta', content: { 'application/json': { schema: error } } },
        '503': { description: 'Autorización o extracción temporalmente no disponible', content: { 'application/json': { schema: error } } },
      },
    },
  },
  '/api/v1/conversations/{id}/signals/analyze': {
    post: {
      tags: ['Conversational Processing'],
      summary: 'Solicitar análisis exploratorio y persistirlo bajo consentimiento específico',
      description: 'Operación explícita; no se ejecuta en cada mensaje. Requiere ai_conversation_processing, structured_signal_extraction y conversational_signal_analysis vigentes. El análisis clasifica solo evidencia textual seleccionada, no gravedad clínica, diagnóstico, riesgo ni DASS-21. Está deshabilitado por defecto hasta que se aprueben consentimiento y retención.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyzeConversationSignalsRequest' } } } },
      responses: {
        '200': { description: 'Análisis estructurado persistido y validado con referencias a mensajes seleccionados', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationalSignalAnalysis' } } } },
        '400': { description: 'Referencias de mensaje inválidas', content: { 'application/json': { schema: error } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Falta consentimiento vigente para alguna finalidad requerida', content: { 'application/json': { schema: error } } },
        '404': { description: 'Conversación ajena o inexistente', content: { 'application/json': { schema: error } } },
        '503': { description: 'Función deshabilitada, autorización no disponible o proveedor no disponible', content: { 'application/json': { schema: error } } },
      },
    },
  },
  '/api/v1/me/conversational-signals/latest': {
    get: {
      tags: ['Conversational Processing'],
      summary: 'Consultar el último análisis propio vigente',
      description: 'No vuelve a llamar al proveedor. Requiere JWT y los consentimientos vigentes para procesamiento, extracción y análisis. Devuelve not_available cuando no existe análisis vigente; los registros caducados no se devuelven.',
      security,
      responses: {
        '200': { description: 'Último análisis propio o estado explícito sin resultados', content: { 'application/json': { schema: { $ref: '#/components/schemas/LatestConversationalSignalAnalysisResponse' } } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Consentimiento ausente, retirado o desactualizado', content: { 'application/json': { schema: error } } },
        '503': { description: 'Función deshabilitada o autorización no disponible', content: { 'application/json': { schema: error } } },
      },
    },
  },
  '/api/v1/me/conversational-signals/history': {
    get: {
      tags: ['Conversational Processing'],
      summary: 'Consultar historial propio de análisis vigentes',
      description: 'No vuelve a llamar al proveedor. Requiere JWT y consentimientos vigentes. Limit opcional de 1 a 20; no devuelve registros de otras cuentas.',
      security,
      parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }],
      responses: {
        '200': { description: 'Historial propio vigente; puede ser una lista vacía', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationalSignalAnalysisHistoryResponse' } } } },
        '401': { description: 'JWT ausente o inválido', content: { 'application/json': { schema: error } } },
        '403': { description: 'Consentimiento ausente, retirado o desactualizado', content: { 'application/json': { schema: error } } },
        '503': { description: 'Función deshabilitada o autorización no disponible', content: { 'application/json': { schema: error } } },
      },
    },
  },
} as const;
