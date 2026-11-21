import type { PreliminaryAssessment } from '../../../domain/model/preliminary-assessment.js';
import type { AssessmentResponse } from '../../../domain/model/assessment-response.js';
import type { PreliminaryAssessmentResult } from '../../../domain/model/assessment-result.js';

export function toAssessmentResponseResource(value: AssessmentResponse) {
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

export function toAssessmentResource(value: PreliminaryAssessment) {
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

export function toAssessmentResultResource(value: PreliminaryAssessmentResult) {
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

export function toAssessmentPageResource(items: readonly PreliminaryAssessment[], limit: number, offset: number, hasMore: boolean) {
  return { items: items.map(toAssessmentResource), pagination: { limit, offset, hasMore } };
}
