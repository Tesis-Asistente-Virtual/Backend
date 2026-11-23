import { z } from 'zod';
import { DASS21_ITEMS_BY_DIMENSION } from './dass21-scoring.js';

/** Technical descriptor version; this is not an instrumentVersion or approval. */
export const DASS21_SPANISH_CANDIDATE_VERSION = 'dass21-spanish-candidate-1.0' as const;

const itemNumbersByDimension = new Map<number, 'depression' | 'anxiety' | 'stress'>(
  Object.entries(DASS21_ITEMS_BY_DIMENSION).flatMap(([dimension, numbers]) =>
    numbers.map(number => [number, dimension as 'depression' | 'anxiety' | 'stress'] as const)),
);

const responseValues = Object.freeze([0, 1, 2, 3] as const);
const itemSlotSchema = z.object({
  itemNumber: z.number().int().min(1).max(21),
  displayOrder: z.number().int().min(1).max(21),
  dimension: z.enum(['depression', 'anxiety', 'stress']),
  responseValues: z.tuple([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
}).strict();

export const dass21SpanishCandidateSchema = z.object({
  schemaVersion: z.literal('1.0'),
  candidateVersion: z.literal(DASS21_SPANISH_CANDIDATE_VERSION),
  instrumentCode: z.literal('DASS-21'),
  language: z.literal('es'),
  candidateId: z.literal('daza-et-al-2002-spanish-candidate'),
  translation: z.object({
    citation: z.literal('Daza, Novy, Stanley & Averill (2002), The Depression Anxiety Stress Scale-21: Spanish translation and validation with a Hispanic sample, Journal of Psychopathology and Behavioral Assessment, 24(3), 195–205.'),
    sourceUrl: z.literal('https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm'),
    publicationUrl: z.literal('https://doi.org/10.1023/A:1016014818163'),
  }).strict(),
  populationEvidence: z.literal('A 2025 psychometric study in students at one public university in Lima cites the Daza Spanish adaptation; exact deployed text/version still requires source-to-version verification.'),
  itemTextStatus: z.literal('not_included_pending_source_cotejo'),
  professionalReviewStatus: z.literal('pending'),
  approvalStatus: z.literal('not_approved'),
  availability: z.literal('not_available'),
  items: z.array(itemSlotSchema).length(21),
}).strict().superRefine((candidate, context) => {
  const itemNumbers = candidate.items.map(item => item.itemNumber);
  const positions = candidate.items.map(item => item.displayOrder);
  if (new Set(itemNumbers).size !== 21 || new Set(positions).size !== 21 ||
      itemNumbers.some((number, index) => number !== index + 1) ||
      positions.some((position, index) => position !== index + 1)) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Candidate slots must cover item numbers and display order 1 through 21 exactly once and in order' });
  }
  candidate.items.forEach((item, index) => {
    if (item.dimension !== itemNumbersByDimension.get(index + 1)) {
      context.addIssue({ code: 'custom', path: ['items', index, 'dimension'], message: 'Item dimension must match the canonical DASS-21 scoring assignment' });
    }
  });
});

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type Dass21SpanishCandidate = DeepReadonly<z.infer<typeof dass21SpanishCandidateSchema>>;

const slots = Object.freeze(Array.from({ length: 21 }, (_, index) => Object.freeze({
  itemNumber: index + 1,
  displayOrder: index + 1,
  dimension: itemNumbersByDimension.get(index + 1)!,
  responseValues,
})));

/**
 * Non-loadable, non-publishable preparation metadata. It contains no translated
 * prompts, question UUIDs, instrument version UUID, or approval claims.
 */
const parsedCandidate = dass21SpanishCandidateSchema.parse(Object.freeze({
  schemaVersion: '1.0',
  candidateVersion: DASS21_SPANISH_CANDIDATE_VERSION,
  instrumentCode: 'DASS-21',
  language: 'es',
  candidateId: 'daza-et-al-2002-spanish-candidate',
  translation: Object.freeze({
    citation: 'Daza, Novy, Stanley & Averill (2002), The Depression Anxiety Stress Scale-21: Spanish translation and validation with a Hispanic sample, Journal of Psychopathology and Behavioral Assessment, 24(3), 195–205.',
    sourceUrl: 'https://www2.psy.unsw.edu.au/dass/Spanish/Daza.htm',
    publicationUrl: 'https://doi.org/10.1023/A:1016014818163',
  }),
  populationEvidence: 'A 2025 psychometric study in students at one public university in Lima cites the Daza Spanish adaptation; exact deployed text/version still requires source-to-version verification.',
  itemTextStatus: 'not_included_pending_source_cotejo',
  professionalReviewStatus: 'pending',
  approvalStatus: 'not_approved',
  availability: 'not_available',
  items: slots,
}));

export const DASS21_SPANISH_CANDIDATE: Dass21SpanishCandidate = Object.freeze({
  ...parsedCandidate,
  translation: Object.freeze({ ...parsedCandidate.translation }),
  items: Object.freeze(parsedCandidate.items.map(item => Object.freeze({
    ...item,
    responseValues: Object.freeze([...item.responseValues]) as unknown as typeof item.responseValues,
  }))),
});
