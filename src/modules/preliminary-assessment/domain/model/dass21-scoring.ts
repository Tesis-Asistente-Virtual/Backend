import { z } from 'zod';

/** Version of the deterministic subscale sum and DASS-21 x2 conversion rules. */
export const DASS21_SCORING_VERSION = 'dass21-score-1.0' as const;

const instrumentMetadataSchema = z.object({
  instrumentCode: z.literal('DASS-21'),
  instrumentId: z.string().uuid(),
  instrumentVersionId: z.string().uuid(),
  version: z.string().trim().min(1).max(40),
  status: z.enum(['draft', 'approved', 'retired']),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']),
  licenseStatus: z.enum(['not_reviewed', 'authorized', 'restricted', 'not_applicable']),
}).strict();

const itemAnswerSchema = z.object({
  instrumentVersionId: z.string().uuid(),
  itemNumber: z.number().int().min(1).max(21),
  value: z.number().int().min(0).max(3),
}).strict();

export const dass21ScoreSchema = z.object({
  schemaVersion: z.literal('1.0'),
  scoringVersion: z.literal(DASS21_SCORING_VERSION),
  instrumentVersionId: z.string().uuid(),
  dimensions: z.object({
    depression: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
    anxiety: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
    stress: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
  }).strict(),
}).strict();

export type Dass21Score = z.infer<typeof dass21ScoreSchema>;
export type Dass21InstrumentMetadata = z.infer<typeof instrumentMetadataSchema>;
export type Dass21ItemAnswer = z.infer<typeof itemAnswerSchema>;

export type Dass21ScoringErrorCode =
  | 'invalid_instrument'
  | 'instrument_not_approved'
  | 'invalid_answers'
  | 'incomplete_answers'
  | 'instrument_version_mismatch'
  | 'mapping_conflict'
  | 'mapping_not_found'
  | 'mapping_not_frozen';

/** Safe scoring failure. It intentionally omits the received payload and answer values. */
export class Dass21ScoringError extends Error {
  constructor(readonly code: Dass21ScoringErrorCode) {
    super('DASS-21 scoring could not be completed');
    this.name = 'Dass21ScoringError';
  }
}

const itemsByDimension = {
  depression: [3, 5, 10, 13, 16, 17, 21],
  anxiety: [2, 4, 7, 9, 15, 19, 20],
  stress: [1, 6, 8, 11, 12, 14, 18],
} as const;

/**
 * Pure scoring engine. `itemNumber` is an internal synthetic/test mapping; this
 * function is not wired to HTTP or persistence until an approved instrument
 * version can provide and validate that mapping.
 */
export function scoreDass21(value: {
  instrument: unknown;
  answers: unknown;
}): Dass21Score {
  const instrument = instrumentMetadataSchema.safeParse(value.instrument);
  if (!instrument.success) throw new Dass21ScoringError('invalid_instrument');
  if (instrument.data.status !== 'approved' || instrument.data.approvalStatus !== 'approved' ||
      !['authorized', 'not_applicable'].includes(instrument.data.licenseStatus)) {
    throw new Dass21ScoringError('instrument_not_approved');
  }

  if (!Array.isArray(value.answers) || value.answers.length !== 21) {
    throw new Dass21ScoringError('incomplete_answers');
  }
  const answers: Dass21ItemAnswer[] = [];
  for (const candidate of value.answers) {
    const parsed = itemAnswerSchema.safeParse(candidate);
    if (!parsed.success) throw new Dass21ScoringError('invalid_answers');
    if (parsed.data.instrumentVersionId !== instrument.data.instrumentVersionId) {
      throw new Dass21ScoringError('instrument_version_mismatch');
    }
    answers.push(parsed.data);
  }
  const byItem = new Map<number, number>();
  for (const answer of answers) {
    if (byItem.has(answer.itemNumber)) throw new Dass21ScoringError('invalid_answers');
    byItem.set(answer.itemNumber, answer.value);
  }
  if (byItem.size !== 21) throw new Dass21ScoringError('incomplete_answers');

  const dimensions = Object.fromEntries(
    Object.entries(itemsByDimension).map(([dimension, itemNumbers]) => {
      const rawScore = itemNumbers.reduce((sum, itemNumber) => sum + (byItem.get(itemNumber) ?? 0), 0);
      return [dimension, { rawScore, equivalentScore: rawScore * 2 }];
    }),
  ) as Dass21Score['dimensions'];

  return dass21ScoreSchema.parse({
    schemaVersion: '1.0',
    scoringVersion: DASS21_SCORING_VERSION,
    instrumentVersionId: instrument.data.instrumentVersionId,
    dimensions,
  });
}
