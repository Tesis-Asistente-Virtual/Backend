import { z } from 'zod';
import { conversationSignalExtractionSchema, signalSchemaVersion, } from './signal-observation.js';
export const resultInterpretationLimits = [
    'descriptive_only',
    'not_a_diagnosis',
    'clinical_severity_not_calculated',
    'not_a_safety_assessment',
];
const reportedFactSchema = z.object({
    observationIndex: z.number().int().nonnegative(),
    field: z.enum(['manifestation', 'duration', 'frequency', 'intensity', 'context', 'functional_impact']),
    contextDomain: z.enum(['academic', 'family', 'economic', 'social', 'personal']).optional(),
    value: z.string().trim().min(1).max(1000),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(10),
}).strict();
export const conversationSignalSummarySchema = z.object({
    descriptiveStatus: z.enum(['observations_available', 'no_observations']),
    reportedFacts: z.array(reportedFactSchema).max(220),
    /** Empty observations do not imply that symptoms or risk are absent. */
    emptyObservationsMeaning: z.literal('not_evidence_of_absence'),
    interpretationLimits: z.array(z.enum(resultInterpretationLimits)).length(resultInterpretationLimits.length),
}).strict();
export const conversationSignalResultSchema = z.object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    /** Internal ownership key; omitted from the public HTTP response. */
    accountId: z.string().uuid(),
    generatedAt: z.string().datetime(),
    schemaVersion: z.literal(signalSchemaVersion),
    extractorVersion: z.string().trim().min(1).max(40),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(20),
    observations: conversationSignalExtractionSchema.shape.observations,
    missingInformation: conversationSignalExtractionSchema.shape.missingInformation,
    clarificationQuestions: conversationSignalExtractionSchema.shape.clarificationQuestions,
    summary: conversationSignalSummarySchema,
}).strict();
function reportedValue(value) {
    return value.status === 'reported' ? value.value : null;
}
export function createConversationSignalResult(input) {
    const sourceMessageIds = [...new Set(input.sourceMessageIds.map(id => id.toLowerCase()))].sort();
    const validSources = new Set(sourceMessageIds);
    const reportedFacts = [];
    const addFact = (observationIndex, field, value, messageIds, contextDomain) => {
        const text = reportedValue(value);
        if (text === null)
            return;
        const references = [...new Set(messageIds.map(id => id.toLowerCase()))].sort();
        if (references.length === 0 || references.some(id => !validSources.has(id))) {
            throw new Error('Reported fact has an invalid source reference');
        }
        reportedFacts.push({ observationIndex, field, ...(contextDomain ? { contextDomain } : {}), value: text, sourceMessageIds: references });
    };
    input.extraction.observations.forEach((observation, observationIndex) => {
        addFact(observationIndex, 'manifestation', observation.manifestation, observation.sourceMessageIds);
        addFact(observationIndex, 'duration', observation.duration, observation.sourceMessageIds);
        addFact(observationIndex, 'frequency', observation.frequency, observation.sourceMessageIds);
        addFact(observationIndex, 'intensity', observation.intensity, observation.sourceMessageIds);
        for (const context of observation.contexts) {
            addFact(observationIndex, 'context', context.evidence, observation.sourceMessageIds, context.domain);
        }
        addFact(observationIndex, 'functional_impact', observation.functionalImpact, observation.sourceMessageIds);
    });
    return conversationSignalResultSchema.parse({
        id: input.id,
        conversationId: input.conversationId.toLowerCase(),
        accountId: input.accountId.toLowerCase(),
        generatedAt: input.generatedAt.toISOString(),
        schemaVersion: input.extraction.schemaVersion,
        extractorVersion: input.extractorVersion,
        sourceMessageIds,
        observations: input.extraction.observations,
        missingInformation: input.extraction.missingInformation,
        clarificationQuestions: input.extraction.clarificationQuestions,
        summary: {
            descriptiveStatus: input.extraction.observations.length > 0 ? 'observations_available' : 'no_observations',
            reportedFacts,
            emptyObservationsMeaning: 'not_evidence_of_absence',
            interpretationLimits: [...resultInterpretationLimits],
        },
    });
}
