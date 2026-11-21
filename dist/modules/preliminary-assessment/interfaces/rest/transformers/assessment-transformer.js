export function toAssessmentResponseResource(value) {
    return {
        assessmentId: value.assessmentId,
        instrumentVersionId: value.instrumentVersionId,
        questionId: value.questionId,
        status: value.status,
        answer: value.answer,
        createdAt: value.createdAt.toISOString(),
        updatedAt: value.updatedAt.toISOString(),
    };
}
export function toAssessmentResource(value) {
    return {
        id: value.assessmentId,
        assessmentType: value.assessmentType,
        mode: value.mode,
        status: value.status,
        instrumentVersionId: value.instrumentVersionId,
        createdAt: value.createdAt.toISOString(),
        startedAt: value.startedAt.toISOString(),
        completedAt: value.completedAt?.toISOString() ?? null,
        withdrawnAt: value.withdrawnAt?.toISOString() ?? null,
        updatedAt: value.updatedAt.toISOString(),
        responses: value.responses.map(toAssessmentResponseResource),
    };
}
export function toAssessmentResultResource(value) {
    return {
        schemaVersion: value.schemaVersion,
        assessmentId: value.assessmentId,
        instrumentVersionId: value.instrumentVersionId,
        calculatedAt: value.calculatedAt.toISOString(),
        instrumentScores: value.instrumentScores,
        interpretation: value.interpretation,
        attentionPriority: value.attentionPriority,
        safetyState: value.safetyState,
    };
}
export function toAssessmentPageResource(items, limit, offset, hasMore) {
    return { items: items.map(toAssessmentResource), pagination: { limit, offset, hasMore } };
}
