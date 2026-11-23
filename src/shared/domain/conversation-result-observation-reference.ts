import { z } from 'zod';

export const conversationResultObservationReferenceContractVersion = '1.0' as const;

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const messageIds = z.array(uuid).min(1).max(10).refine(ids => new Set(ids).size === ids.length);

/** Ephemeral pointer into one exact conversation result; it is not a durable observation ID. */
export const conversationResultObservationReferenceSchema = z.object({
  contractVersion: z.literal(conversationResultObservationReferenceContractVersion),
  resultId: uuid,
  conversationId: uuid,
  /** Zero-based position in that result's preliminaryGuidance.observations. */
  observationIndex: z.number().int().nonnegative(),
  /** Index of the source extractor observation retained by preliminaryGuidance. */
  sourceObservationIndex: z.number().int().nonnegative(),
  field: z.enum(['manifestation', 'duration', 'frequency', 'intensity', 'context', 'functional_impact']),
  contextDomain: z.enum(['academic', 'family', 'economic', 'social', 'personal']).optional(),
  sourceMessageIds: messageIds,
}).strict();

export type ConversationResultObservationReference = z.infer<typeof conversationResultObservationReferenceSchema>;
