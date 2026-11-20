import { z } from 'zod';
export const signalSchemaVersion = '1.0';
export const signalDimensions = ['depression', 'anxiety', 'stress'];
export const evidenceStatuses = ['reported', 'ambiguous', 'not_reported', 'not_assessed'];
export const contextDomains = ['academic', 'family', 'economic', 'social', 'personal'];
export const missingInformationFields = [
    'manifestation', 'duration', 'frequency', 'intensity', 'context', 'functional_impact',
];
const briefTextSchema = z.string().trim().min(1).max(500);
const detailTextSchema = z.string().trim().min(1).max(1000);
// This is a structural safeguard, not a clinical classifier. Descriptive or tentative wording
// remains valid; conclusive diagnostic formulations are rejected from extraction text fields.
const clinicalConclusionPattern = /\b(?:diagn[oó]stico\s+(?:de|es)|diagnosticad[oa]\s+con|cumple\s+criterios\s+(?:para|de)|padece\s+(?:de\s+)?(?:depresi[oó]n|ansiedad|un\s+trastorno)|tiene\s+(?:depresi[oó]n|ansiedad\s+cl[ií]nica|un\s+trastorno))\b/i;
const nonConclusiveTextSchema = detailTextSchema.refine((value) => !clinicalConclusionPattern.test(value), 'Use descriptive, non-diagnostic language');
/** `not_reported` means no explicit report was found in the supplied messages; it never means absence. */
export const evidenceValueSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('reported'), value: nonConclusiveTextSchema }).strict(),
    z.object({ status: z.literal('ambiguous'), note: nonConclusiveTextSchema.nullable() }).strict(),
    z.object({ status: z.literal('not_reported') }).strict(),
    z.object({ status: z.literal('not_assessed') }).strict(),
]);
const uniqueUuidList = z.array(z.string().uuid()).min(1).max(10).refine((values) => new Set(values).size === values.length, 'Message references must be unique');
export const contextObservationSchema = z.object({
    domain: z.enum(contextDomains),
    evidence: evidenceValueSchema,
}).strict();
export const signalObservationSchema = z.object({
    evidence: z.enum(evidenceStatuses),
    manifestation: evidenceValueSchema,
    possibleDimensions: z.array(z.enum(signalDimensions)).max(3).refine((values) => new Set(values).size === values.length, 'Possible dimensions must be unique'),
    duration: evidenceValueSchema,
    frequency: evidenceValueSchema,
    intensity: evidenceValueSchema,
    contexts: z.array(contextObservationSchema).max(5),
    functionalImpact: evidenceValueSchema,
    sourceMessageIds: uniqueUuidList,
}).strict().superRefine((observation, context) => {
    if (observation.evidence !== observation.manifestation.status) {
        context.addIssue({ code: 'custom', path: ['manifestation', 'status'], message: 'Observation evidence must match manifestation evidence' });
    }
    if ((observation.evidence === 'not_reported' || observation.evidence === 'not_assessed') && observation.possibleDimensions.length > 0) {
        context.addIssue({ code: 'custom', path: ['possibleDimensions'], message: 'Unreported or unassessed observations cannot be associated with a dimension' });
    }
});
export const missingInformationSchema = z.object({
    field: z.enum(missingInformationFields),
    reason: z.enum(['not_reported', 'ambiguous', 'not_assessed']),
}).strict();
export const conversationSignalExtractionSchema = z.object({
    schemaVersion: z.literal(signalSchemaVersion),
    observations: z.array(signalObservationSchema).max(20),
    missingInformation: z.array(missingInformationSchema).max(20),
    clarificationQuestions: z.array(briefTextSchema.max(300)).max(8),
}).strict();
