import { z } from 'zod';
import { PreliminaryAssessmentError } from '../../../domain/model/assessment-errors.js';
import { createDass21AssessmentScore } from '../../../domain/model/dass21-assessment-score.js';
import { Dass21ScoringError } from '../../../domain/model/dass21-scoring.js';
const commandSchema = z.object({
    assessmentId: z.string().uuid(),
    /** Explicit internal configuration; no public request can select a scoring map. */
    mappingVersion: z.string().trim().min(1).max(40),
}).strict();
/**
 * Internal orchestration only. It is intentionally not registered in REST,
 * background jobs, chat flows, or application composition in this increment.
 */
export class ScoreCompletedDass21Assessment {
    assessments;
    instruments;
    mappings;
    scores;
    consent;
    clock;
    constructor(assessments, instruments, mappings, scores, consent, clock = () => new Date()) {
        this.assessments = assessments;
        this.instruments = instruments;
        this.mappings = mappings;
        this.scores = scores;
        this.consent = consent;
        this.clock = clock;
    }
    async execute(accountId, commandValue) {
        const command = commandSchema.parse(commandValue);
        if (!z.string().uuid().safeParse(accountId).success)
            throw new PreliminaryAssessmentError('assessment_not_found');
        const initialNoticeId = await this.currentNoticeId(accountId);
        const assessment = await this.assessments.findByIdForOwner(command.assessmentId, accountId);
        if (!assessment)
            throw new PreliminaryAssessmentError('assessment_not_found');
        if (assessment.status !== 'completed') {
            if (assessment.status === 'in_progress' || assessment.status === 'paused')
                throw new PreliminaryAssessmentError('responses_incomplete');
            throw new PreliminaryAssessmentError('assessment_closed');
        }
        if (!assessment.instrumentVersionId)
            throw new PreliminaryAssessmentError('instrument_version_mismatch');
        if (assessment.consentNoticeVersionId !== initialNoticeId)
            throw new PreliminaryAssessmentError('consent_required');
        const now = this.clock();
        const instrument = await this.instruments.findAvailableByVersionId(assessment.instrumentVersionId, now);
        if (!instrument)
            throw new PreliminaryAssessmentError('instrument_unavailable');
        if (instrument.instrumentVersionId !== assessment.instrumentVersionId)
            throw new PreliminaryAssessmentError('instrument_version_mismatch');
        const mapping = await this.mappings.findFrozen(assessment.instrumentVersionId, command.mappingVersion);
        if (!mapping)
            throw new Dass21ScoringError('mapping_not_found');
        if (mapping.mappingVersion !== command.mappingVersion || mapping.instrumentVersionId !== assessment.instrumentVersionId) {
            throw new PreliminaryAssessmentError('instrument_version_mismatch');
        }
        // Recheck before in-process handling of the response set. The score repository
        // then locks/revalidates consent again in its write transaction.
        const calculationNoticeId = await this.currentNoticeId(accountId);
        if (assessment.consentNoticeVersionId !== calculationNoticeId)
            throw new PreliminaryAssessmentError('consent_required');
        const calculatedAt = new Date(Math.max(now.getTime(), assessment.completedAt?.getTime() ?? 0));
        const score = createDass21AssessmentScore({ assessment, instrument, mapping, calculatedAt });
        return this.scores.saveForCompletedOwner(score, accountId);
    }
    async currentNoticeId(accountId) {
        try {
            const noticeId = await this.consent.getCurrentNoticeVersionId(accountId);
            if (noticeId)
                return noticeId;
        }
        catch {
            // Do not propagate adapter/database details into the application boundary.
        }
        throw new PreliminaryAssessmentError('consent_required');
    }
}
