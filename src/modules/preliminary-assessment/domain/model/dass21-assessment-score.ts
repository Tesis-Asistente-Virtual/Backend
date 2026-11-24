import { z } from 'zod';
import { assessmentResponseSchema, type AssessmentResponse } from './assessment-response.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy, type InstrumentVersion } from './instrument.js';
import type { PreliminaryAssessment } from './preliminary-assessment.js';
import { PreliminaryAssessmentError } from './assessment-errors.js';
import { Dass21ScoringError, scoreDass21, scoreDass21ForSyntheticTechnicalTest } from './dass21-scoring.js';
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
  // Consent decision gate removed by request: only the bound notice must still be current.
  if (!input.currentNoticeVersionId || assessment.consentNoticeVersionId !== input.currentNoticeVersionId) {
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
  technicalTestOnly?: boolean;
  availability?: InstrumentAvailabilityPolicy;
}): Dass21AssessmentScore {
  const { assessment, instrument } = input;
  if (assessment.status !== 'completed' || assessment.mode !== 'structured_instrument' ||
      assessment.instrumentVersionId !== instrument.instrumentVersionId ||
      Number.isNaN(input.calculatedAt.getTime()) || !assessment.completedAt || input.calculatedAt < assessment.completedAt) {
    throw new Dass21ScoringError('invalid_answers');
  }
  const availability = input.availability ?? (value => isInstrumentAvailable(value));
  const mapping = validateDass21QuestionMapping(input.mapping, instrument, availability, input.calculatedAt);
  const responseByQuestion = new Map<string, AssessmentResponse>();
  for (const responseValue of assessment.responses as readonly unknown[]) {
    const parsedResponse = assessmentResponseSchema.safeParse(responseValue);
    if (!parsedResponse.success) throw new Dass21ScoringError('invalid_answers');
    const response = parsedResponse.data;
    if (response.assessmentId !== assessment.assessmentId || response.instrumentVersionId !== instrument.instrumentVersionId ||
        responseByQuestion.has(response.questionId)) throw new Dass21ScoringError('invalid_answers');
    responseByQuestion.set(response.questionId, response);
  }
  if (responseByQuestion.size !== 21) throw new Dass21ScoringError('incomplete_answers');

  const answers = mapping.entries.map(entry => {
    const response = responseByQuestion.get(entry.questionId);
    const question = instrument.questions.find(candidate => candidate.id === entry.questionId);
    const answer = response?.answer;
    if (!response || response.status !== 'answered' || answer === null || answer === undefined || !question) {
      throw new Dass21ScoringError('incomplete_answers');
    }

    let value: number;
    if (question.responseType === 'number' && answer.type === 'number') {
      value = answer.value;
    } else if (question.responseType === 'single_choice' && answer.type === 'single_choice') {
      const selectedOption = question.options.find(option => option.id === answer.optionId);
      if (selectedOption?.scoringValue === undefined) throw new Dass21ScoringError('invalid_answers');
      value = selectedOption.scoringValue;
    } else {
      throw new Dass21ScoringError('invalid_answers');
    }

    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Dass21ScoringError('invalid_answers');
    return { instrumentVersionId: response.instrumentVersionId, itemNumber: entry.itemNumber, value };
  });
  const scoreInput = {
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
  };
  const score = input.technicalTestOnly
    ? scoreDass21ForSyntheticTechnicalTest(scoreInput)
    : scoreDass21(scoreInput);
  return dass21AssessmentScoreSchema.parse({
    schemaVersion: '1.0', status: 'calculated', assessmentId: assessment.assessmentId,
    accountId: assessment.accountId, instrumentCode: 'DASS-21', instrumentId: instrument.instrumentId,
    instrumentVersionId: instrument.instrumentVersionId, mappingId: mapping.mappingId, mappingVersion: mapping.mappingVersion,
    scoringVersion: score.scoringVersion, calculatedAt: input.calculatedAt, dimensions: score.dimensions,
  });
}
