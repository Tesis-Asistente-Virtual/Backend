import { z } from 'zod';
export const longitudinalConversationComparisonContractVersion = '1.1';
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const uniqueUuids = z.array(uuid).min(1).max(20).refine(values => new Set(values).size === values.length);
const comparisonFields = ['manifestation', 'duration', 'frequency', 'intensity', 'context', 'functional_impact'];
const contextDomains = ['academic', 'family', 'economic', 'social', 'personal'];
const reportedObservationSchema = z.object({
    observationIndex: z.number().int().nonnegative(),
    evidenceStatus: z.literal('reported'),
    field: z.enum(comparisonFields),
    contextDomain: z.enum(contextDomains).optional(),
    /** Ephemeral reported wording. The comparator never returns this text. */
    text: z.string().trim().min(1).max(1000),
    sourceMessageIds: uniqueUuids,
}).strict();
const explicitTemporalContextSchema = z.object({
    explicitlyReported: z.literal(true),
    relation: z.enum(['change', 'continuity']),
    earlierSessionId: uuid,
    earlierConversationId: uuid,
    laterSessionId: uuid,
    laterConversationId: uuid,
    earlierObservationIndex: z.number().int().nonnegative(),
    laterObservationIndex: z.number().int().nonnegative(),
    /** Messages in the later snapshot that explicitly link the two periods. */
    comparisonMessageIds: uniqueUuids,
}).strict();
export const longitudinalConversationSnapshotSchema = z.object({
    contractVersion: z.literal(longitudinalConversationComparisonContractVersion),
    sessionId: uuid,
    conversationId: uuid,
    observedAt: z.string().datetime({ offset: true }),
    selectedMessageIds: uniqueUuids,
    reportedObservations: z.array(reportedObservationSchema).max(220),
    /** Only the later snapshot may carry an explicit link to the earlier period. */
    temporalContext: explicitTemporalContextSchema.nullable(),
}).strict().superRefine((snapshot, context) => {
    const messageIds = new Set(snapshot.selectedMessageIds);
    const observationIndexes = new Set();
    snapshot.reportedObservations.forEach((observation, index) => {
        if (observationIndexes.has(observation.observationIndex)) {
            context.addIssue({ code: 'custom', path: ['reportedObservations', index, 'observationIndex'], message: 'Observation indexes must be unique within a snapshot' });
        }
        observationIndexes.add(observation.observationIndex);
        if (observation.sourceMessageIds.some(id => !messageIds.has(id))) {
            context.addIssue({ code: 'custom', path: ['reportedObservations', index, 'sourceMessageIds'], message: 'Observation references must belong to the snapshot selected messages' });
        }
    });
    if (snapshot.temporalContext?.comparisonMessageIds.some(id => !messageIds.has(id))) {
        context.addIssue({ code: 'custom', path: ['temporalContext', 'comparisonMessageIds'], message: 'Temporal evidence must belong to the later snapshot selected messages' });
    }
});
const evidencePeriodSchema = z.object({
    period: z.enum(['earlier', 'later']),
    evidenceStatus: z.literal('reported'),
    sessionId: uuid,
    conversationId: uuid,
    observationIndex: z.number().int().nonnegative(),
    messageIds: uniqueUuids,
}).strict();
const comparisonEvidenceSchema = z.object({
    earlier: evidencePeriodSchema,
    later: evidencePeriodSchema,
    temporalLink: z.object({
        explicitlyReported: z.literal(true),
        period: z.literal('later'),
        sessionId: uuid,
        conversationId: uuid,
        observationIndex: z.number().int().nonnegative(),
        messageIds: uniqueUuids,
    }).strict(),
}).strict();
const limitationTexts = [
    'Comparación descriptiva estructural; no es una evaluación clínica ni un diagnóstico.',
    'La falta de menciones no demuestra ausencia, continuidad, mejoría ni deterioro.',
    'El comparador no verifica el significado del texto fuente; requiere una relación temporal explícita validada por su futuro llamador.',
];
export const longitudinalConversationComparisonSchema = z.object({
    contractVersion: z.literal(longitudinalConversationComparisonContractVersion),
    sessionIds: z.tuple([uuid, uuid]),
    conversationIds: z.tuple([uuid, uuid]),
    comparisonStatus: z.enum(['explicit_change_reported', 'explicit_continuity_reported', 'insufficient_information']),
    descriptiveComparisons: z.array(z.object({
        field: z.enum(comparisonFields),
        contextDomain: z.enum(contextDomains).optional(),
        relation: z.enum(['change', 'continuity']),
        evidence: comparisonEvidenceSchema,
    }).strict()).max(1),
    informationGaps: z.array(z.enum([
        'no_reported_observations',
        'only_one_period_has_reported_observations',
        'no_explicit_temporal_link',
        'temporal_evidence_does_not_match_both_periods',
        'period_order_is_not_verifiable',
        'period_identity_conflict',
        'message_references_overlap_between_periods',
    ])).max(1),
    limitations: z.tuple([
        z.literal(limitationTexts[0]),
        z.literal(limitationTexts[1]),
        z.literal(limitationTexts[2]),
    ]),
}).strict().superRefine((result, context) => {
    const hasComparison = result.descriptiveComparisons.length === 1;
    if (hasComparison !== (result.comparisonStatus !== 'insufficient_information') || hasComparison === (result.informationGaps.length > 0)) {
        context.addIssue({ code: 'custom', path: ['comparisonStatus'], message: 'Comparison status, evidence, and information gaps must agree' });
    }
});
function insufficient(earlier, later, reason) {
    return longitudinalConversationComparisonSchema.parse({
        contractVersion: longitudinalConversationComparisonContractVersion,
        sessionIds: [earlier.sessionId, later.sessionId],
        conversationIds: [earlier.conversationId, later.conversationId],
        comparisonStatus: 'insufficient_information',
        descriptiveComparisons: [],
        informationGaps: [reason],
        limitations: [...limitationTexts],
    });
}
/** Pure structural comparison. It does not infer relations from differences in wording or observation counts. */
export function compareLongitudinalConversationSnapshots(earlierValue, laterValue) {
    const earlier = longitudinalConversationSnapshotSchema.parse(earlierValue);
    const later = longitudinalConversationSnapshotSchema.parse(laterValue);
    if (earlier.sessionId === later.sessionId || earlier.conversationId === later.conversationId) {
        return insufficient(earlier, later, 'period_identity_conflict');
    }
    const earlierMessageIds = new Set(earlier.selectedMessageIds);
    if (later.selectedMessageIds.some(id => earlierMessageIds.has(id))) {
        return insufficient(earlier, later, 'message_references_overlap_between_periods');
    }
    if (Date.parse(earlier.observedAt) >= Date.parse(later.observedAt)) {
        return insufficient(earlier, later, 'period_order_is_not_verifiable');
    }
    if (earlier.reportedObservations.length === 0 && later.reportedObservations.length === 0) {
        return insufficient(earlier, later, 'no_reported_observations');
    }
    if (earlier.reportedObservations.length === 0 || later.reportedObservations.length === 0) {
        return insufficient(earlier, later, 'only_one_period_has_reported_observations');
    }
    const temporal = later.temporalContext;
    if (!temporal)
        return insufficient(earlier, later, 'no_explicit_temporal_link');
    if (earlier.temporalContext !== null) {
        return insufficient(earlier, later, 'temporal_evidence_does_not_match_both_periods');
    }
    const earlierObservation = earlier.reportedObservations.find(item => item.observationIndex === temporal.earlierObservationIndex);
    const laterObservation = later.reportedObservations.find(item => item.observationIndex === temporal.laterObservationIndex);
    const sameField = earlierObservation?.field === laterObservation?.field &&
        earlierObservation?.contextDomain === laterObservation?.contextDomain;
    if (temporal.earlierSessionId !== earlier.sessionId || temporal.earlierConversationId !== earlier.conversationId ||
        temporal.laterSessionId !== later.sessionId || temporal.laterConversationId !== later.conversationId ||
        !earlierObservation || !laterObservation || !sameField ||
        temporal.comparisonMessageIds.length === 0 ||
        temporal.comparisonMessageIds.some(id => !later.selectedMessageIds.includes(id))) {
        return insufficient(earlier, later, 'temporal_evidence_does_not_match_both_periods');
    }
    const relation = temporal.relation;
    return longitudinalConversationComparisonSchema.parse({
        contractVersion: longitudinalConversationComparisonContractVersion,
        sessionIds: [earlier.sessionId, later.sessionId],
        conversationIds: [earlier.conversationId, later.conversationId],
        comparisonStatus: relation === 'change' ? 'explicit_change_reported' : 'explicit_continuity_reported',
        descriptiveComparisons: [{
                field: laterObservation.field,
                ...(laterObservation.contextDomain ? { contextDomain: laterObservation.contextDomain } : {}),
                relation,
                evidence: {
                    earlier: {
                        period: 'earlier',
                        evidenceStatus: 'reported',
                        sessionId: earlier.sessionId,
                        conversationId: earlier.conversationId,
                        observationIndex: earlierObservation.observationIndex,
                        messageIds: [...earlierObservation.sourceMessageIds].sort(),
                    },
                    later: {
                        period: 'later',
                        evidenceStatus: 'reported',
                        sessionId: later.sessionId,
                        conversationId: later.conversationId,
                        observationIndex: laterObservation.observationIndex,
                        messageIds: [...laterObservation.sourceMessageIds].sort(),
                    },
                    temporalLink: {
                        explicitlyReported: true,
                        period: 'later',
                        sessionId: later.sessionId,
                        conversationId: later.conversationId,
                        observationIndex: laterObservation.observationIndex,
                        messageIds: [...temporal.comparisonMessageIds].sort(),
                    },
                },
            }],
        informationGaps: [],
        limitations: [...limitationTexts],
    });
}
