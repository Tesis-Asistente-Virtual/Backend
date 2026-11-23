import type { Dass21AssessmentScore } from '../../domain/model/dass21-assessment-score.js';
import type { Dass21QuestionMapping } from '../../domain/model/dass21-question-mapping.js';
import type { InstrumentVersion } from '../../domain/model/instrument.js';
import type { PreliminaryAssessment } from '../../domain/model/preliminary-assessment.js';

/** Transaction-scoped reads used only to assemble an internal DASS-21 result. */
export interface Dass21InternalResultReadSession {
  requireCurrentConsentNotice(accountId: string, at: Date): Promise<string>;
  findAssessmentForOwner(assessmentId: string, accountId: string): Promise<PreliminaryAssessment | null>;
  findAvailableInstrumentVersion(instrumentVersionId: string, at: Date): Promise<InstrumentVersion | null>;
  findFrozenMapping(instrumentVersionId: string, mappingVersion: string, instrument: InstrumentVersion): Promise<Dass21QuestionMapping | null>;
  findScoreForOwner(assessmentId: string, accountId: string): Promise<Dass21AssessmentScore | null>;
}

export interface Dass21InternalResultReadUnitOfWork {
  execute<T>(work: (session: Dass21InternalResultReadSession) => Promise<T>): Promise<T>;
}
