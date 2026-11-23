import { and, asc, desc, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as databaseSchema from '../../../../shared/infrastructure/database/schema.js';
import { authAccounts } from '../../../authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../../consent/infrastructure/persistence/schema.js';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { assessmentResponseSchema } from '../../domain/model/assessment-response.js';
import { dass21AssessmentScoreSchema } from '../../domain/model/dass21-assessment-score.js';
import { validateDass21QuestionMapping } from '../../domain/model/dass21-question-mapping.js';
import { isInstrumentAvailable, parseInstrumentVersion, type InstrumentAvailabilityPolicy } from '../../domain/model/instrument.js';
import { restorePreliminaryAssessment } from '../../domain/model/preliminary-assessment.js';
import type { Dass21InternalResultReadSession, Dass21InternalResultReadUnitOfWork } from '../../application/ports/dass21-internal-result-read-unit-of-work.js';
import { assessmentAnswers, assessmentInstrumentQuestions, assessmentInstrumentVersions, assessmentPsychometricScores, assessmentScoringItemMappings, assessmentScoringMappingVersions, preliminaryAssessments } from './schema.js';
import { requireCurrentPreliminaryAssessmentConsent } from './preliminary-assessment-consent-transaction.js';

type DrizzleTransaction = Parameters<Parameters<NodePgDatabase<typeof databaseSchema>['transaction']>[0]>[0];

/**
 * Keeps every source read in one transaction. Lock order is deliberately the
 * same as Consent and assessment writes: account -> current notice ->
 * assessment -> answers -> instrument -> score -> mapping. Score writers also
 * lock assessment before mapping, so they cannot pass this reader mid-snapshot.
 */
export class DrizzleDass21InternalResultReadUnitOfWork implements Dass21InternalResultReadUnitOfWork {
  constructor(
    private readonly db: NodePgDatabase<typeof databaseSchema>,
    private readonly availability: InstrumentAvailabilityPolicy = instrument => isInstrumentAvailable(instrument),
  ) {}

  execute<T>(work: (session: Dass21InternalResultReadSession) => Promise<T>): Promise<T> {
    return this.db.transaction(tx => work(new DrizzleDass21InternalResultReadSession(tx, this.availability)));
  }
}

class DrizzleDass21InternalResultReadSession implements Dass21InternalResultReadSession {
  constructor(private readonly tx: DrizzleTransaction, private readonly availability: InstrumentAvailabilityPolicy) {}

  requireCurrentConsentNotice(accountId: string, at: Date): Promise<string> {
    return requireCurrentPreliminaryAssessmentConsent(this.tx, accountId, undefined, at);
  }

  async findAssessmentForOwner(assessmentId: string, accountId: string) {
    const [row] = await this.tx.select().from(preliminaryAssessments).where(and(
      eq(preliminaryAssessments.assessmentId, assessmentId), eq(preliminaryAssessments.accountId, accountId),
    )).for('share').limit(1);
    if (!row) return null;

    const answers = await this.tx.select().from(assessmentAnswers)
      .where(eq(assessmentAnswers.assessmentId, row.assessmentId))
      .orderBy(asc(assessmentAnswers.createdAt), asc(assessmentAnswers.questionId)).for('share');
    const responses = answers.map(answer => {
      const parsed = assessmentResponseSchema.safeParse({
        assessmentId: answer.assessmentId, instrumentVersionId: answer.instrumentVersionId,
        questionId: answer.questionId, status: answer.status, answer: answer.answer,
        createdAt: answer.createdAt, updatedAt: answer.updatedAt,
      });
      if (!parsed.success) throw new PreliminaryAssessmentError('invalid_response');
      return parsed.data;
    });
    return restorePreliminaryAssessment({
      assessmentId: row.assessmentId, accountId: row.accountId, assessmentType: row.assessmentType,
      mode: row.mode, status: row.status, instrumentVersionId: row.instrumentVersionId,
      consentNoticeVersionId: row.consentNoticeVersionId, createdAt: row.createdAt,
      startedAt: row.startedAt, completedAt: row.completedAt, withdrawnAt: row.withdrawnAt,
      updatedAt: row.updatedAt, responses,
    });
  }

  async findAvailableInstrumentVersion(instrumentVersionId: string, at: Date) {
    const [row] = await this.tx.select().from(assessmentInstrumentVersions)
      .where(and(eq(assessmentInstrumentVersions.instrumentVersionId, instrumentVersionId),
        lte(assessmentInstrumentVersions.effectiveAt, at)))
      .for('share').limit(1);
    if (!row) return null;
    const questions = await this.tx.select().from(assessmentInstrumentQuestions)
      .where(eq(assessmentInstrumentQuestions.instrumentVersionId, instrumentVersionId))
      .orderBy(asc(assessmentInstrumentQuestions.displayOrder), asc(assessmentInstrumentQuestions.questionId)).for('share');
    const instrument = parseInstrumentVersion({
      instrumentId: row.instrumentId, instrumentVersionId: row.instrumentVersionId, version: row.version,
      effectiveAt: row.effectiveAt, status: row.status,
      questions: questions.map(question => ({
        ...(typeof question.definition === 'object' && question.definition !== null ? question.definition : {}),
        ...(question.displayOrder === null ? {} : { displayOrder: question.displayOrder }),
      })),
      approval: { status: row.approvalStatus, approvedAt: row.approvedAt, approvalReference: row.approvalReference },
      license: { status: row.licenseStatus, reference: row.licenseReference },
    });
    if (instrument.status === 'approved' && (!instrument.approval.approvedAt || instrument.approval.approvedAt > at)) return null;
    return this.availability(instrument, at) ? instrument : null;
  }

  async findFrozenMapping(instrumentVersionId: string, mappingVersion: string, instrument: import('../../domain/model/instrument.js').InstrumentVersion) {
    const [row] = await this.tx.select().from(assessmentScoringMappingVersions).where(and(
      eq(assessmentScoringMappingVersions.instrumentVersionId, instrumentVersionId),
      eq(assessmentScoringMappingVersions.mappingVersion, mappingVersion),
      eq(assessmentScoringMappingVersions.status, 'frozen'),
    )).for('share').limit(1);
    if (!row) return null;
    const items = await this.tx.select().from(assessmentScoringItemMappings)
      .where(eq(assessmentScoringItemMappings.mappingId, row.mappingId))
      .orderBy(asc(assessmentScoringItemMappings.itemNumber)).for('share');
    return validateDass21QuestionMapping({
      schemaVersion: '1.0', mappingId: row.mappingId, instrumentCode: 'DASS-21',
      instrumentId: row.instrumentId, instrumentVersionId: row.instrumentVersionId,
      mappingVersion: row.mappingVersion, status: row.status, createdAt: row.createdAt,
      frozenAt: row.frozenAt, entries: items.map(item => ({ questionId: item.questionId, itemNumber: item.itemNumber })),
    }, instrument, this.availability);
  }

  async findScoreForOwner(assessmentId: string, accountId: string) {
    const [row] = await this.tx.select().from(assessmentPsychometricScores).where(and(
      eq(assessmentPsychometricScores.assessmentId, assessmentId),
      eq(assessmentPsychometricScores.accountId, accountId),
    )).for('share').limit(1);
    if (!row) return null;
    return dass21AssessmentScoreSchema.parse({
      schemaVersion: row.schemaVersion, status: row.status, assessmentId: row.assessmentId, accountId: row.accountId,
      instrumentCode: 'DASS-21', instrumentId: row.instrumentId, instrumentVersionId: row.instrumentVersionId,
      mappingId: row.mappingId, mappingVersion: row.mappingVersion, scoringVersion: row.scoringVersion,
      calculatedAt: row.calculatedAt,
      dimensions: {
        depression: { rawScore: row.depressionRawScore, equivalentScore: row.depressionEquivalentScore },
        anxiety: { rawScore: row.anxietyRawScore, equivalentScore: row.anxietyEquivalentScore },
        stress: { rawScore: row.stressRawScore, equivalentScore: row.stressEquivalentScore },
      },
    });
  }
}
