import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DASS21_INTERPRETATION_VERSION,
} from '../../../domain/model/dass21-interpretation.js';
import { DASS21_SCORING_VERSION } from '../../../domain/model/dass21-scoring.js';
import { DASS21_INSTRUMENT_ID, dass21VersionAuthorizationSchema } from './dass21-version-authorization-registry.js';

const evidenceDocumentSchema = z.object({
  reference: z.string().trim().min(1).max(500),
  file: z.string().trim().min(1).max(300),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

const decisionEvidenceSchema = z.object({
  evidenceReference: z.string().trim().min(1).max(500),
  scope: z.string().trim().min(1).max(300),
  responsible: z.string().trim().min(1).max(200),
  responsibleRole: z.string().trim().min(1).max(150),
  authorizedAt: z.string().datetime({ offset: true }),
  documents: z.array(evidenceDocumentSchema).min(1).max(10),
}).strict();

export const dass21PublicationManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  targetDatabase: z.string().trim().min(1).max(63),
  operator: z.object({
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(150),
  }).strict(),
  instrument: z.object({
    instrumentCode: z.literal('DASS-21'),
    instrumentId: z.string().uuid(),
    instrumentVersionId: z.string().uuid(),
    instrumentVersion: z.string().trim().min(1).max(40),
    questionSetSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }).strict(),
  administration: decisionEvidenceSchema,
  license: z.object({
    status: z.enum(['authorized', 'not_applicable']),
    reference: z.string().trim().min(1).max(300),
    evidence: decisionEvidenceSchema,
  }).strict(),
  scoring: decisionEvidenceSchema.extend({
    mappingVersion: z.string().trim().min(1).max(40),
    scoringVersion: z.literal(DASS21_SCORING_VERSION),
  }).strict().nullable(),
  interpretation: decisionEvidenceSchema.extend({
    scoringVersion: z.literal(DASS21_SCORING_VERSION),
    interpretationVersion: z.literal(DASS21_INTERPRETATION_VERSION),
  }).strict().nullable(),
  participantDisclosure: decisionEvidenceSchema.extend({
    resultContractVersion: z.literal('dass21-participant-result-1.0'),
  }).strict().nullable(),
  effectiveAt: z.string().datetime({ offset: true }),
}).strict().superRefine((manifest, context) => {
  if (manifest.instrument.instrumentId !== DASS21_INSTRUMENT_ID) {
    context.addIssue({ code: 'custom', path: ['instrument', 'instrumentId'], message: 'Instrument identity does not match the DASS-21 catalog identity' });
  }
  if (manifest.interpretation && !manifest.scoring) {
    context.addIssue({ code: 'custom', path: ['interpretation'], message: 'Interpretation authorization requires its exact scoring decision' });
  }
  if (manifest.participantDisclosure && (!manifest.scoring || !manifest.interpretation)) {
    context.addIssue({ code: 'custom', path: ['participantDisclosure'], message: 'Disclosure authorization requires separate scoring and interpretation decisions' });
  }
  const dates = [manifest.administration, manifest.license.evidence, manifest.scoring, manifest.interpretation, manifest.participantDisclosure]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map(item => new Date(item.authorizedAt).getTime());
  if (dates.some(date => !Number.isFinite(date) || date > Date.now())) {
    context.addIssue({ code: 'custom', path: [], message: 'Authorization dates must be valid and cannot be in the future' });
  }
}).transform(value => ({
  ...value,
  effectiveAt: new Date(value.effectiveAt),
  administration: { ...value.administration, authorizedAt: new Date(value.administration.authorizedAt) },
  license: { ...value.license, evidence: { ...value.license.evidence, authorizedAt: new Date(value.license.evidence.authorizedAt) } },
  scoring: value.scoring ? { ...value.scoring, authorizedAt: new Date(value.scoring.authorizedAt) } : null,
  interpretation: value.interpretation ? { ...value.interpretation, authorizedAt: new Date(value.interpretation.authorizedAt) } : null,
  participantDisclosure: value.participantDisclosure ? { ...value.participantDisclosure, authorizedAt: new Date(value.participantDisclosure.authorizedAt) } : null,
}));

export type Dass21PublicationManifest = z.infer<typeof dass21PublicationManifestSchema>;

export type Dass21QuestionSnapshot = readonly {
  readonly questionId: string;
  readonly displayOrder: number | null;
  readonly definition: unknown;
}[];

export type Dass21QuestionDatabaseRow = readonly {
  readonly question_id: string;
  readonly display_order: number | null;
  readonly definition: unknown;
}[];

/** Convert PostgreSQL's snake_case projection into the canonical hash input shape. */
export function toDass21QuestionSnapshot(rows: Dass21QuestionDatabaseRow): Dass21QuestionSnapshot {
  return rows.map(row => ({
    questionId: row.question_id,
    displayOrder: row.display_order,
    definition: row.definition,
  }));
}

export function hashDass21QuestionSnapshot(questions: Dass21QuestionSnapshot): string {
  const canonical = [...questions]
    .sort((left, right) => (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER))
    .map(question => ({ questionId: question.questionId, displayOrder: question.displayOrder, definition: sortObjectKeys(question.definition) }));
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function toDass21RuntimeAuthorization(manifest: Dass21PublicationManifest) {
  return dass21VersionAuthorizationSchema.parse({
    instrumentCode: manifest.instrument.instrumentCode,
    instrumentId: manifest.instrument.instrumentId,
    instrumentVersionId: manifest.instrument.instrumentVersionId,
    instrumentVersion: manifest.instrument.instrumentVersion,
    administration: runtimeEvidence(manifest.administration),
    scoring: manifest.scoring ? { ...runtimeEvidence(manifest.scoring), mappingVersion: manifest.scoring.mappingVersion, scoringVersion: manifest.scoring.scoringVersion } : null,
    interpretation: manifest.interpretation ? { ...runtimeEvidence(manifest.interpretation), scoringVersion: manifest.interpretation.scoringVersion, interpretationVersion: manifest.interpretation.interpretationVersion } : null,
    participantDisclosure: manifest.participantDisclosure ? { ...runtimeEvidence(manifest.participantDisclosure), resultContractVersion: manifest.participantDisclosure.resultContractVersion } : null,
  });
}

function runtimeEvidence(evidence: Dass21PublicationManifest['administration']) {
  return {
    evidenceReference: evidence.evidenceReference,
    scope: evidence.scope,
    responsible: `${evidence.responsible} (${evidence.responsibleRole})`,
    authorizedAt: evidence.authorizedAt,
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortObjectKeys(item)]));
  }
  return value;
}
