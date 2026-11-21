import { isDeepStrictEqual } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { PreliminaryAssessmentError } from '../../domain/model/assessment-errors.js';
import { preliminaryAssessmentResultSchema } from '../../domain/model/assessment-result.js';
import { assessmentResults, preliminaryAssessments } from './schema.js';
function toDomain(row) {
    const parsed = preliminaryAssessmentResultSchema.safeParse({
        schemaVersion: row.schemaVersion,
        assessmentId: row.assessmentId,
        instrumentVersionId: row.instrumentVersionId,
        calculatedAt: row.createdAt,
        instrumentScores: row.instrumentScores,
        interpretation: row.interpretation,
        attentionPriority: row.attentionPriority,
        safetyState: row.safetyState,
    });
    if (!parsed.success)
        throw new PreliminaryAssessmentError('invalid_assessment');
    return parsed.data;
}
function resultValues(result) {
    return {
        assessmentId: result.assessmentId,
        instrumentVersionId: result.instrumentVersionId,
        schemaVersion: result.schemaVersion,
        instrumentScores: result.instrumentScores,
        interpretation: result.interpretation,
        attentionPriority: result.attentionPriority,
        safetyState: result.safetyState,
        createdAt: result.calculatedAt,
    };
}
export class DrizzleAssessmentResultRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async saveForCompletedOwner(resultValue, accountId) {
        const parsed = preliminaryAssessmentResultSchema.safeParse(resultValue);
        if (!parsed.success)
            throw new PreliminaryAssessmentError('invalid_assessment');
        const result = parsed.data;
        await this.db.transaction(async (tx) => {
            const [assessment] = await tx.select().from(preliminaryAssessments).where(and(eq(preliminaryAssessments.assessmentId, result.assessmentId), eq(preliminaryAssessments.accountId, accountId))).for('update').limit(1);
            if (!assessment)
                throw new PreliminaryAssessmentError('assessment_not_found');
            if (assessment.status !== 'completed')
                throw new PreliminaryAssessmentError('assessment_closed');
            if (assessment.instrumentVersionId !== result.instrumentVersionId)
                throw new PreliminaryAssessmentError('instrument_version_mismatch');
            const [inserted] = await tx.insert(assessmentResults).values(resultValues(result))
                .onConflictDoNothing({ target: assessmentResults.assessmentId }).returning({ id: assessmentResults.resultId });
            if (inserted)
                return;
            const [existing] = await tx.select().from(assessmentResults)
                .where(eq(assessmentResults.assessmentId, result.assessmentId)).limit(1);
            if (!existing || !isDeepStrictEqual(toDomain(existing), result)) {
                throw new PreliminaryAssessmentError('result_conflict');
            }
        });
    }
    async findByAssessmentForOwner(assessmentId, accountId) {
        const [row] = await this.db.select({ result: assessmentResults }).from(assessmentResults)
            .innerJoin(preliminaryAssessments, eq(preliminaryAssessments.assessmentId, assessmentResults.assessmentId))
            .where(and(eq(assessmentResults.assessmentId, assessmentId), eq(preliminaryAssessments.accountId, accountId))).limit(1);
        return row ? toDomain(row.result) : null;
    }
}
