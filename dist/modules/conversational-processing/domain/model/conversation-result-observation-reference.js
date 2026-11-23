import { z } from 'zod';
import { conversationResultObservationReferenceContractVersion, conversationResultObservationReferenceSchema, } from '../../../../shared/domain/conversation-result-observation-reference.js';
import { preliminaryConversationGuidanceSchema } from './preliminary-conversation-guidance.js';
import { signalObservationSchema } from './signal-observation.js';
const resultScopeSchema = z.object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
    observations: z.array(signalObservationSchema).max(20),
    preliminaryGuidance: preliminaryConversationGuidanceSchema,
}).strict();
export class ConversationResultObservationReferenceError extends Error {
    code;
    constructor(code) {
        super('Conversation result observation reference is unavailable or does not match');
        this.code = code;
        this.name = 'ConversationResultObservationReferenceError';
    }
}
function parseResultScope(value) {
    if (typeof value !== 'object' || value === null)
        throw new ConversationResultObservationReferenceError('result_unavailable');
    const candidate = value;
    const result = resultScopeSchema.parse({
        id: candidate.id,
        conversationId: candidate.conversationId,
        sourceMessageIds: candidate.sourceMessageIds,
        observations: candidate.observations,
        preliminaryGuidance: candidate.preliminaryGuidance,
    });
    if (result.preliminaryGuidance.conversationId.toLowerCase() !== result.conversationId.toLowerCase() ||
        JSON.stringify(sorted(result.preliminaryGuidance.sourceMessageIds)) !== JSON.stringify(sorted(result.sourceMessageIds))) {
        throw new ConversationResultObservationReferenceError('observation_mismatch');
    }
    for (const guidanceObservation of result.preliminaryGuidance.observations) {
        const sourceObservation = result.observations[guidanceObservation.sourceObservationIndex];
        const sourceMessageIdsMatch = sourceObservation !== undefined &&
            JSON.stringify(sorted(guidanceObservation.sourceMessageIds)) === JSON.stringify(sorted(sourceObservation.sourceMessageIds));
        const contextDomainMatchesField = (guidanceObservation.field === 'context') === (guidanceObservation.contextDomain !== undefined);
        const valueMatches = sourceObservation !== undefined && hasReportedSourceValue(sourceObservation, guidanceObservation);
        if (!sourceMessageIdsMatch || !contextDomainMatchesField || !valueMatches) {
            throw new ConversationResultObservationReferenceError('observation_mismatch');
        }
    }
    return result;
}
function sorted(ids) {
    return [...ids].map(id => id.toLowerCase()).sort();
}
function hasReportedSourceValue(observation, guidanceObservation) {
    const { field, contextDomain, text } = guidanceObservation;
    if (field === 'context') {
        return observation.contexts.some(context => context.domain === contextDomain &&
            context.evidence.status === 'reported' && context.evidence.value === text);
    }
    const value = field === 'manifestation' ? observation.manifestation
        : field === 'duration' ? observation.duration
            : field === 'frequency' ? observation.frequency
                : field === 'intensity' ? observation.intensity
                    : observation.functionalImpact;
    return value.status === 'reported' && value.value === text;
}
/** Builds a deterministic reference using the existing ephemeral result ID; it never creates an ID. */
export function createConversationResultObservationReference(resultValue, observationIndex) {
    const result = parseResultScope(resultValue);
    if (!Number.isSafeInteger(observationIndex) || observationIndex < 0) {
        throw new ConversationResultObservationReferenceError('observation_not_found');
    }
    const observation = result.preliminaryGuidance.observations[observationIndex];
    if (!observation)
        throw new ConversationResultObservationReferenceError('observation_not_found');
    return conversationResultObservationReferenceSchema.parse({
        contractVersion: conversationResultObservationReferenceContractVersion,
        resultId: result.id,
        conversationId: result.conversationId,
        observationIndex,
        sourceObservationIndex: observation.sourceObservationIndex,
        field: observation.field,
        ...(observation.contextDomain ? { contextDomain: observation.contextDomain } : {}),
        sourceMessageIds: sorted(observation.sourceMessageIds),
    });
}
/** Resolves only against the exact ephemeral result payload that issued the reference. */
export function resolveConversationResultObservationReference(referenceValue, resultValue) {
    const reference = conversationResultObservationReferenceSchema.parse(referenceValue);
    const result = parseResultScope(resultValue);
    if (reference.resultId !== result.id.toLowerCase() || reference.conversationId !== result.conversationId.toLowerCase()) {
        throw new ConversationResultObservationReferenceError('result_mismatch');
    }
    const observation = result.preliminaryGuidance.observations[reference.observationIndex];
    if (!observation)
        throw new ConversationResultObservationReferenceError('observation_not_found');
    const sameMessageIds = JSON.stringify(sorted(reference.sourceMessageIds)) === JSON.stringify(sorted(observation.sourceMessageIds));
    if (reference.sourceObservationIndex !== observation.sourceObservationIndex || reference.field !== observation.field ||
        reference.contextDomain !== observation.contextDomain || !sameMessageIds) {
        throw new ConversationResultObservationReferenceError('observation_mismatch');
    }
    return observation;
}
