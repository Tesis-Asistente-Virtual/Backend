import { z } from 'zod';
import { dass21AssessmentScoreSchema, type Dass21AssessmentScore } from './dass21-assessment-score.js';
import { DASS21_SCORING_VERSION } from './dass21-scoring.js';

/** Version for conventional adult DASS cutoffs applied to DASS-21 equivalent scores. */
export const DASS21_INTERPRETATION_VERSION = 'dass21-conventional-cutoffs-1.0' as const;
export const DASS21_INTERPRETATION_BASIS = 'dass-original-manual-conventional-ranges' as const;

export const dass21InterpretiveCategorySchema = z.enum([
  'normal', 'mild', 'moderate', 'severe', 'extremely_severe',
]);
export type Dass21InterpretiveCategory = z.infer<typeof dass21InterpretiveCategorySchema>;

const interpretedDimensionSchema = z.object({
  rawScore: z.number().int().min(0).max(21),
  equivalentScore: z.number().int().min(0).max(42),
  category: dass21InterpretiveCategorySchema,
}).strict().superRefine((value, context) => {
  if (value.equivalentScore !== value.rawScore * 2) {
    context.addIssue({ code: 'custom', path: ['equivalentScore'], message: 'Equivalent score must equal raw score multiplied by two' });
  }
});

export const dass21InterpretationSchema = z.object({
  schemaVersion: z.literal('1.0'),
  interpretationVersion: z.literal(DASS21_INTERPRETATION_VERSION),
  interpretationBasis: z.literal(DASS21_INTERPRETATION_BASIS),
  instrumentCode: z.literal('DASS-21'),
  instrumentVersionId: z.string().uuid(),
  scoringVersion: z.literal(DASS21_SCORING_VERSION),
  dimensions: z.object({
    depression: interpretedDimensionSchema,
    anxiety: interpretedDimensionSchema,
    stress: interpretedDimensionSchema,
  }).strict(),
}).strict();

/** Server-supplied support descriptor; it is not client input or an approval record. */
export const dass21InterpretationSupportSchema = z.object({
  instrumentVersionId: z.string().uuid(),
  scoringVersion: z.literal(DASS21_SCORING_VERSION),
  interpretationVersion: z.literal(DASS21_INTERPRETATION_VERSION),
  basis: z.literal(DASS21_INTERPRETATION_BASIS),
}).strict();
export type Dass21InterpretationSupport = z.infer<typeof dass21InterpretationSupportSchema>;

export type Dass21Interpretation = z.infer<typeof dass21InterpretationSchema>;

export type Dass21InterpretationErrorCode =
  | 'invalid_score'
  | 'unsupported_instrument'
  | 'unsupported_scoring_version'
  | 'normative_support_unavailable'
  | 'instrument_version_mismatch';

export class Dass21InterpretationError extends Error {
  constructor(readonly code: Dass21InterpretationErrorCode) {
    super('DASS-21 interpretation is unavailable');
    this.name = 'Dass21InterpretationError';
  }
}

type Dimension = keyof Dass21AssessmentScore['dimensions'];

// Cutoffs are conventional full DASS (42-item scale) scores. DASS-21 equivalentScore is rawScore × 2.
const equivalentScoreCutoffs: Record<Dimension, readonly [number, number, number, number]> = {
  depression: [9, 13, 20, 27],
  anxiety: [7, 9, 14, 19],
  stress: [14, 18, 25, 33],
};

function categoryForEquivalentScore(dimension: Dimension, equivalentScore: number): Dass21InterpretiveCategory {
  const [normalMax, mildMax, moderateMax, severeMax] = equivalentScoreCutoffs[dimension];
  if (equivalentScore <= normalMax) return 'normal';
  if (equivalentScore <= mildMax) return 'mild';
  if (equivalentScore <= moderateMax) return 'moderate';
  if (equivalentScore <= severeMax) return 'severe';
  return 'extremely_severe';
}

/**
 * Pure, versioned mapping for an already calculated internal score. It does not score answers,
 * persist interpretation, or expose results. Callers must separately gate use to a professionally
 * approved instrument/version; this module is intentionally not composed into HTTP or scoring flows.
 */
export function categorizeDass21Score(scoreValue: unknown, supportValue: unknown): Dass21Interpretation {
  if (typeof scoreValue === 'object' && scoreValue !== null && 'instrumentCode' in scoreValue &&
      scoreValue.instrumentCode !== 'DASS-21') {
    throw new Dass21InterpretationError('unsupported_instrument');
  }
  const parsed = dass21AssessmentScoreSchema.safeParse(scoreValue);
  if (!parsed.success) throw new Dass21InterpretationError('invalid_score');
  const score = parsed.data;
  if (score.scoringVersion !== DASS21_SCORING_VERSION) {
    throw new Dass21InterpretationError('unsupported_scoring_version');
  }
  const support = dass21InterpretationSupportSchema.safeParse(supportValue);
  if (!support.success) throw new Dass21InterpretationError('normative_support_unavailable');
  if (support.data.instrumentVersionId !== score.instrumentVersionId || support.data.scoringVersion !== score.scoringVersion) {
    throw new Dass21InterpretationError('instrument_version_mismatch');
  }

  const dimensions = Object.fromEntries(Object.entries(score.dimensions).map(([name, value]) => {
    const dimension = name as Dimension;
    return [dimension, { ...value, category: categoryForEquivalentScore(dimension, value.equivalentScore) }];
  })) as Dass21Interpretation['dimensions'];

  return dass21InterpretationSchema.parse({
    schemaVersion: '1.0',
    interpretationVersion: DASS21_INTERPRETATION_VERSION,
    interpretationBasis: DASS21_INTERPRETATION_BASIS,
    instrumentCode: score.instrumentCode,
    instrumentVersionId: score.instrumentVersionId,
    scoringVersion: score.scoringVersion,
    dimensions,
  });
}
