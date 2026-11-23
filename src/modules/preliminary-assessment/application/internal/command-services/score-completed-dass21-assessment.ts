import { z } from 'zod';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { createDass21AssessmentScore, type Dass21AssessmentScore } from '../../../domain/model/dass21-assessment-score.js';
import { Dass21ScoringError } from '../../../domain/model/dass21-scoring.js';
import { isInstrumentAvailable, type InstrumentAvailabilityPolicy } from '../../../domain/model/instrument.js';
import type { Dass21QuestionMappingRepository } from '../../../domain/repositories/dass21-question-mapping-repository.js';
import type { Dass21AssessmentScoreRepository } from '../../../domain/repositories/dass21-assessment-score-repository.js';
import type { InstrumentCatalog } from '../../../domain/repositories/instrument-catalog.js';
import type { PreliminaryAssessmentRepository } from '../../../domain/repositories/preliminary-assessment-repository.js';
import type { PreliminaryAssessmentConsentAuthorizer } from '../../ports/preliminary-assessment-consent-authorizer.js';

const commandSchema = z.object({
  assessmentId: z.string().uuid(),
  /** Explicit internal configuration; no public request can select a scoring map. */
  mappingVersion: z.string().trim().min(1).max(40),
}).strict();

export type ScoreCompletedDass21AssessmentCommand = z.infer<typeof commandSchema>;

/**
 * Internal orchestration only. It is intentionally not registered in REST,
 * background jobs, chat flows, or application composition in this increment.
 */
export class ScoreCompletedDass21Assessment {
  constructor(
    private readonly assessments: PreliminaryAssessmentRepository,
    private readonly instruments: InstrumentCatalog,
    private readonly mappings: Dass21QuestionMappingRepository,
    private readonly scores: Dass21AssessmentScoreRepository,
    private readonly consent: PreliminaryAssessmentConsentAuthorizer,
    private readonly clock: () => Date = () => new Date(),
    private readonly availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
    private readonly technicalTestOnly = false,
  ) {}

  async execute(accountId: string, commandValue: ScoreCompletedDass21AssessmentCommand): Promise<Dass21AssessmentScore> {
    const command = commandSchema.parse(commandValue);
    if (!z.string().uuid().safeParse(accountId).success) throw new PreliminaryAssessmentError('assessment_not_found');

    const initialNoticeId = await this.currentNoticeId(accountId);
    const assessment = await this.assessments.findByIdForOwner(command.assessmentId, accountId);
    if (!assessment) throw new PreliminaryAssessmentError('assessment_not_found');
    if (assessment.status !== 'completed') {
      if (assessment.status === 'in_progress' || assessment.status === 'paused') throw new PreliminaryAssessmentError('responses_incomplete');
      throw new PreliminaryAssessmentError('assessment_closed');
    }
    if (!assessment.instrumentVersionId) throw new PreliminaryAssessmentError('instrument_version_mismatch');
    if (assessment.consentNoticeVersionId !== initialNoticeId) throw new PreliminaryAssessmentError('consent_required');

    const now = this.clock();
    const instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, now);
    if (!instrument || !this.availability(instrument, now)) throw new PreliminaryAssessmentError('instrument_unavailable');
    if (instrument.instrumentVersionId !== assessment.instrumentVersionId) throw new PreliminaryAssessmentError('instrument_version_mismatch');

    const mapping = await this.mappings.findFrozen(assessment.instrumentVersionId, command.mappingVersion);
    if (!mapping) throw new Dass21ScoringError('mapping_not_found');
    if (mapping.mappingVersion !== command.mappingVersion || mapping.instrumentVersionId !== assessment.instrumentVersionId) {
      throw new PreliminaryAssessmentError('instrument_version_mismatch');
    }

    // Recheck before in-process handling of the response set. The score repository
    // then locks/revalidates consent again in its write transaction.
    const calculationNoticeId = await this.currentNoticeId(accountId);
    if (assessment.consentNoticeVersionId !== calculationNoticeId) throw new PreliminaryAssessmentError('consent_required');

    const calculatedAt = new Date(Math.max(now.getTime(), assessment.completedAt?.getTime() ?? 0));
    const score = createDass21AssessmentScore({
      assessment, instrument, mapping, calculatedAt,
      availability: this.availability,
      technicalTestOnly: this.technicalTestOnly,
    });
    return this.scores.saveForCompletedOwner(score, accountId);
  }

  private async currentNoticeId(accountId: string): Promise<string> {
    try {
      const noticeId = await this.consent.getCurrentNoticeVersionId(accountId);
      if (noticeId) return noticeId;
    } catch {
      // Do not propagate adapter/database details into the application boundary.
    }
    throw new PreliminaryAssessmentError('consent_required');
  }
}
