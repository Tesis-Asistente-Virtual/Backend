import { z } from 'zod';
import { dass21InternalResultSchema, type Dass21InternalResult } from '../../../domain/model/dass21-internal-result.js';

export const DASS21_PARTICIPANT_RESULT_CONTRACT_VERSION = 'dass21-participant-result-1.0' as const;

const publicDimensionSchema = z.object({
  rawScore: z.number().int().min(0).max(21),
  equivalentScore: z.number().int().min(0).max(42),
  category: z.enum(['normal', 'mild', 'moderate', 'severe', 'extremely_severe']),
}).strict().superRefine((value, context) => {
  if (value.equivalentScore !== value.rawScore * 2) {
    context.addIssue({ code: 'custom', path: ['equivalentScore'], message: 'Equivalent score must equal raw score multiplied by two' });
  }
});

const participantLimitations = z.tuple([
  z.literal('not_a_diagnosis'),
  z.literal('conventional_categories_are_not_clinical_severity'),
  z.literal('not_derived_from_conversation'),
  z.literal('not_for_automated_treatment_or_safety_decisions'),
]);

/** Future public DTO. It is deliberately not referenced by the current /result route. */
export const dass21ParticipantResultSchema = z.discriminatedUnion('status', [
  z.object({
    contractVersion: z.literal(DASS21_PARTICIPANT_RESULT_CONTRACT_VERSION),
    status: z.literal('available'),
    assessmentId: z.string().uuid(),
    instrument: z.object({
      code: z.literal('DASS-21'),
      instrumentId: z.string().uuid(),
      instrumentVersionId: z.string().uuid(),
      version: z.string().trim().min(1).max(40),
    }).strict(),
    scoringVersion: z.string().trim().min(1).max(40),
    interpretationVersion: z.string().trim().min(1).max(40),
    dimensions: z.object({
      depression: publicDimensionSchema,
      anxiety: publicDimensionSchema,
      stress: publicDimensionSchema,
    }).strict(),
    isDiagnostic: z.literal(false),
    limitations: participantLimitations,
  }).strict(),
  z.object({
    contractVersion: z.literal(DASS21_PARTICIPANT_RESULT_CONTRACT_VERSION),
    status: z.literal('not_available'),
    assessmentId: z.string().uuid(),
    reason: z.literal('result_not_available'),
    isDiagnostic: z.literal(false),
    limitations: z.tuple([
      z.literal('not_a_diagnosis'),
      z.literal('result_not_available_until_authorized'),
    ]),
  }).strict(),
]);

export type Dass21ParticipantResult = z.infer<typeof dass21ParticipantResultSchema>;

/**
 * Pure DTO projection only. It does not authorize publication; no HTTP handler
 * currently calls it. Internal denial reasons are intentionally collapsed.
 */
export function toDass21ParticipantResult(value: Dass21InternalResult): Dass21ParticipantResult {
  const internal = dass21InternalResultSchema.parse(value);
  if (internal.status === 'not_available') {
    return dass21ParticipantResultSchema.parse({
      contractVersion: DASS21_PARTICIPANT_RESULT_CONTRACT_VERSION,
      status: 'not_available', assessmentId: internal.assessmentId,
      reason: 'result_not_available', isDiagnostic: false,
      limitations: ['not_a_diagnosis', 'result_not_available_until_authorized'],
    });
  }

  return dass21ParticipantResultSchema.parse({
    contractVersion: DASS21_PARTICIPANT_RESULT_CONTRACT_VERSION,
    status: 'available', assessmentId: internal.assessmentId,
    instrument: internal.instrument,
    scoringVersion: internal.scoringVersion,
    interpretationVersion: internal.interpretationVersion,
    dimensions: internal.dimensions,
    isDiagnostic: false,
    limitations: [
      'not_a_diagnosis',
      'conventional_categories_are_not_clinical_severity',
      'not_derived_from_conversation',
      'not_for_automated_treatment_or_safety_decisions',
    ],
  });
}
