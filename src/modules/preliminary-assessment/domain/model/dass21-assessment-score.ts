import { z } from 'zod';
import type { AssessmentResponse } from './assessment-response.js';
import type { InstrumentVersion } from './instrument.js';
import type { PreliminaryAssessment } from './preliminary-assessment.js';
import { PreliminaryAssessmentError } from './assessment-errors.js';
import { Dass21ScoringError, scoreDass21 } from './dass21-scoring.js';
import { validateDass21QuestionMapping, type Dass21QuestionMapping } from './dass21-question-mapping.js';

const dimensionsSchema = z.object({
  depression: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
  anxiety: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
  stress: z.object({ rawScore: z.number().int().min(0).max(21), equivalentScore: z.number().int().min(0).max(42) }).strict(),
}).strict().superRefine((dimensions, context) => {
  for (const [name, score] of Object.entries(dimensions)) {
    if (score.equivalentScore !== score.rawScore * 2) {
      context.addIssue({ code: 'custom', path: [name, 'equivalentScore'], message: 'Equivalent score must be raw score multiplied by two' });
    }
  }
});

/** Internal psychometric record. This contract is intentionally not the public /result DTO. */
export const dass21AssessmentScoreSchema = z.object({
  schemaVersion: z.literal('1.0'),
  status: z.literal('calculated'),
  assessmentId: z.string().uuid(),
  accountId: z.string().uuid(),
  instrumentCode: z.literal('DASS-21'),
  instrumentId: z.string().uuid(),
  instrumentVersionId: z.string().uuid(),
  mappingId: z.string().uuid(),
  mappingVersion: z.string().trim().min(1).max(40),
  scoringVersion: z.string().trim().min(1).max(40),
  calculatedAt: z.date(),
  dimensions: dimensionsSchema,
}).strict();

export type Dass21AssessmentScore = z.infer<typeof dass21AssessmentScoreSchema>;

export function assertDass21ScoreWriteAuthorization(input: {
  score: Dass21AssessmentScore;
  requestedAccountId: string;
  assessment: { accountId: string; status: string; instrumentVersionId: string | null; consentNoticeVersionId: string };
  currentNoticeVersionId: string | null;
  latestDecision: { action: string; noticeVersionId: string } | null;
  mapping: { mappingId: string; instrumentId: string; instrumentVersionId: string; mappingVersion: string; status: string } | null;
}): void {
  const { score, assessment } = input;
  if (score.accountId !== input.requestedAccountId || assessment.accountId !== input.requestedAccountId) {
    throw new PreliminaryAssessmentError('assessment_not_found');
  }
  if (assessment.status !== 'completed') throw new PreliminaryAssessmentError('assessment_closed');
  if (assessment.instrumentVersionId !== score.instrumentVersionId) throw new PreliminaryAssessmentError('instrument_version_mismatch');
  if (!input.currentNoticeVersionId || assessment.consentNoticeVersionId !== input.currentNoticeVersionId ||
      input.latestDecision?.action !== 'granted' || input.latestDecision.noticeVersionId !== input.currentNoticeVersionId) {
    throw new PreliminaryAssessmentError('consent_required');
  }
  const mapping = input.mapping;
  if (!mapping || mapping.status !== 'frozen' || mapping.mappingId !== score.mappingId ||
      mapping.instrumentId !== score.instrumentId || mapping.instrumentVersionId !== score.instrumentVersionId ||
      mapping.mappingVersion !== score.mappingVersion) {
    throw new Dass21ScoringError('mapping_not_frozen');
  }
}

export function createDass21AssessmentScore(input: {
  assessment: PreliminaryAssessment;
  instrument: InstrumentVersion;
  mapping: Dass21QuestionMapping;
  calculatedAt: Date;
}): Dass21AssessmentScore {
  const { assessment, instrument } = input;
  if (assessment.status !== 'completed' || assessment.mode !== 'structured_instrument' ||
      assessment.instrumentVersionId !== instrument.instrumentVersionId ||
      Number.isNaN(input.calculatedAt.getTime()) || !assessment.completedAt || input.calculatedAt < assessment.completedAt) {
    throw new Dass21ScoringError('invalid_answers');
  }
  const mapping = validateDass21QuestionMapping(input.mapping, instrument);
  const responseByQuestion = new Map<string, AssessmentResponse>();
  for (const response of assessment.responses as readonly AssessmentResponse[]) {
    if (response.assessmentId !== assessment.assessmentId || response.instrumentVersionId !== instrument.instrumentVersionId ||
        responseByQuestion.has(response.questionId)) throw new Dass21ScoringError('invalid_answers');
    responseByQuestion.set(response.questionId, response);
  }
  if (responseByQuestion.size !== 21) throw new Dass21ScoringError('incomplete_answers');

  const answers = mapping.entries.map(entry => {
    const response = responseByQuestion.get(entry.questionId);
    if (!response || response.status !== 'answered' || response.answer?.type !== 'number' ||
        !Number.isInteger(response.answer.value) || response.answer.value < 0 || response.answer.value > 3) {
      throw new Dass21ScoringError('incomplete_answers');
    }
    return { instrumentVersionId: response.instrumentVersionId, itemNumber: entry.itemNumber, value: response.answer.value };
  });
  const score = scoreDass21({
    instrument: {
      instrumentCode: 'DASS-21',
      instrumentId: instrument.instrumentId,
      instrumentVersionId: instrument.instrumentVersionId,
      version: instrument.version,
      status: instrument.status,
      approvalStatus: instrument.approval.status,
      licenseStatus: instrument.license.status,
    },
    answers,
  });
  return dass21AssessmentScoreSchema.parse({
    schemaVersion: '1.0', status: 'calculated', assessmentId: assessment.assessmentId,
    accountId: assessment.accountId, instrumentCode: 'DASS-21', instrumentId: instrument.instrumentId,
    instrumentVersionId: instrument.instrumentVersionId, mappingId: mapping.mappingId, mappingVersion: mapping.mappingVersion,
    scoringVersion: score.scoringVersion, calculatedAt: input.calculatedAt, dimensions: score.dimensions,
  });
}
