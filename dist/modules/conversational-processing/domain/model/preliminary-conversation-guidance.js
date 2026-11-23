import { z } from 'zod';
import { missingInformationSchema } from './signal-observation.js';
export const preliminaryConversationGuidanceContractVersion = '1.0';
const guidanceFields = ['manifestation', 'duration', 'frequency', 'intensity', 'context', 'functional_impact'];
const guidanceObservationSchema = z.object({
    sourceObservationIndex: z.number().int().nonnegative(),
    field: z.enum(guidanceFields),
    contextDomain: z.enum(['academic', 'family', 'economic', 'social', 'personal']).optional(),
    text: z.string().trim().min(1).max(1000),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(10).refine(ids => new Set(ids).size === ids.length),
}).strict();
const generalGuidance = 'Puedes revisar o corregir estas observaciones. Si algo importante no aparece, puedes compartirlo solo si así lo deseas.';
const guidanceLimitations = [
    'Este resumen se basa únicamente en los mensajes seleccionados.',
    'Las observaciones pueden no representar todo lo que quisiste expresar; puedes corregirlas.',
    'No es una evaluación ni un diagnóstico clínico y no calcula puntuaciones o niveles de severidad.',
    'No evalúa seguridad; una respuesta vacía o incompleta no demuestra ausencia de dificultades ni de riesgo.',
];
export const preliminaryConversationGuidanceSchema = z.object({
    contractVersion: z.literal(preliminaryConversationGuidanceContractVersion),
    conversationId: z.string().uuid(),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
    observations: z.array(guidanceObservationSchema).max(220),
    informationGaps: z.array(missingInformationSchema).max(20),
    suggestedFollowUpQuestions: z.array(z.string().trim().min(1).max(300)).max(8),
    generalGuidance: z.literal(generalGuidance),
    limitations: z.tuple([
        z.literal(guidanceLimitations[0]),
        z.literal(guidanceLimitations[1]),
        z.literal(guidanceLimitations[2]),
        z.literal(guidanceLimitations[3]),
    ]),
}).strict().superRefine((guidance, context) => {
    const allowedSources = new Set(guidance.sourceMessageIds.map(id => id.toLowerCase()));
    guidance.observations.forEach((observation, index) => {
        if (observation.sourceMessageIds.some(id => !allowedSources.has(id.toLowerCase()))) {
            context.addIssue({ code: 'custom', path: ['observations', index, 'sourceMessageIds'], message: 'Observation references must belong to the selected messages' });
        }
    });
});
/** Maps only facts already marked `reported`; wording is copied without another model call. */
export function createPreliminaryConversationGuidance(result) {
    return preliminaryConversationGuidanceSchema.parse({
        contractVersion: preliminaryConversationGuidanceContractVersion,
        conversationId: result.conversationId,
        sourceMessageIds: result.sourceMessageIds,
        observations: result.summary.reportedFacts.map(fact => ({
            sourceObservationIndex: fact.observationIndex,
            field: fact.field,
            ...(fact.contextDomain ? { contextDomain: fact.contextDomain } : {}),
            text: fact.value,
            sourceMessageIds: fact.sourceMessageIds,
        })),
        informationGaps: result.missingInformation,
        suggestedFollowUpQuestions: result.clarificationQuestions,
        generalGuidance,
        limitations: [...guidanceLimitations],
    });
}
