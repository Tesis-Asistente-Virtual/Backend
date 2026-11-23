import { z } from 'zod';
import { assessmentResponseSchema } from './assessment-response.js';
import { upsertAssessmentResponse, validateResponseForInstrument } from './assessment-response.js';
import { isInstrumentAvailable } from './instrument.js';
import { PreliminaryAssessmentError } from './assessment-errors.js';
export const assessmentStatuses = ['in_progress', 'paused', 'completed', 'withdrawn', 'expired'];
export const assessmentModes = ['conversational_contextual', 'structured_instrument'];
const assessmentSchema = z.object({
    assessmentId: z.string().uuid(),
    accountId: z.string().uuid(),
    assessmentType: z.string().trim().min(1).max(80),
    mode: z.enum(assessmentModes),
    status: z.enum(assessmentStatuses),
    instrumentVersionId: z.string().uuid().nullable(),
    consentNoticeVersionId: z.string().uuid(),
    createdAt: z.date(),
    startedAt: z.date(),
    completedAt: z.date().nullable(),
    withdrawnAt: z.date().nullable(),
    updatedAt: z.date(),
    responses: z.array(assessmentResponseSchema),
}).strict().superRefine((assessment, context) => {
    if ((assessment.mode === 'structured_instrument') !== (assessment.instrumentVersionId !== null)) {
        context.addIssue({ code: 'custom', path: ['instrumentVersionId'], message: 'Assessment mode and instrument version do not match' });
    }
    if (assessment.startedAt < assessment.createdAt || assessment.updatedAt < assessment.startedAt) {
        context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Assessment timestamps are inconsistent' });
    }
    if ((assessment.status === 'completed') !== (assessment.completedAt !== null)) {
        context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Completion timestamp must match status' });
    }
    if ((assessment.status === 'withdrawn') !== (assessment.withdrawnAt !== null)) {
        context.addIssue({ code: 'custom', path: ['withdrawnAt'], message: 'Withdrawal timestamp must match status' });
    }
    const questionKeys = assessment.responses.map(response => {
        if (typeof response !== 'object' || response === null || !('assessmentId' in response) || !('questionId' in response))
            return '';
        return `${String(response.assessmentId)}:${String(response.questionId)}`;
    });
    if (new Set(questionKeys).size !== questionKeys.length) {
        context.addIssue({ code: 'custom', path: ['responses'], message: 'Only one current response per question is allowed' });
    }
});
function freezeAssessment(value) {
    const parsed = assessmentSchema.safeParse(value);
    if (!parsed.success)
        throw new PreliminaryAssessmentError('invalid_assessment');
    return Object.freeze({ ...value, responses: Object.freeze([...value.responses]) });
}
export function createPreliminaryAssessment(input) {
    const instrumentVersionId = input.instrumentVersionId ?? null;
    return freezeAssessment({
        ...input,
        instrumentVersionId,
        consentNoticeVersionId: input.consentNoticeVersionId,
        status: 'in_progress',
        completedAt: null,
        withdrawnAt: null,
        updatedAt: input.startedAt,
        responses: [],
    });
}
/** Revalidates a persisted aggregate at the infrastructure boundary without exposing its schema. */
export function restorePreliminaryAssessment(value) {
    return freezeAssessment(value);
}
function requireOpen(assessment) {
    if (assessment.status === 'completed' || assessment.status === 'withdrawn' || assessment.status === 'expired') {
        throw new PreliminaryAssessmentError('assessment_closed');
    }
}
function transition(assessment, status, at) {
    requireOpen(assessment);
    if (Number.isNaN(at.getTime()) || at < assessment.createdAt || at < assessment.updatedAt) {
        throw new PreliminaryAssessmentError('invalid_transition');
    }
    return freezeAssessment({
        ...assessment,
        status,
        updatedAt: at,
        completedAt: status === 'completed' ? at : assessment.completedAt,
        withdrawnAt: status === 'withdrawn' ? at : assessment.withdrawnAt,
    });
}
export function pauseAssessment(assessment, at) {
    if (assessment.status !== 'in_progress')
        throw new PreliminaryAssessmentError('invalid_transition');
    return transition(assessment, 'paused', at);
}
export function resumeAssessment(assessment, at) {
    if (assessment.status !== 'paused')
        throw new PreliminaryAssessmentError('invalid_transition');
    return transition(assessment, 'in_progress', at);
}
/** Rebinds an open assessment only after the caller has observed a fresh explicit grant. */
export function reauthorizeAssessment(assessment, noticeVersionId, at) {
    if (assessment.status !== 'in_progress' && assessment.status !== 'paused') {
        throw new PreliminaryAssessmentError('assessment_closed');
    }
    if (!z.string().uuid().safeParse(noticeVersionId).success)
        throw new PreliminaryAssessmentError('consent_required');
    if (assessment.consentNoticeVersionId === noticeVersionId)
        return assessment;
    if (Number.isNaN(at.getTime()) || at < assessment.updatedAt)
        throw new PreliminaryAssessmentError('invalid_transition');
    return freezeAssessment({ ...assessment, consentNoticeVersionId: noticeVersionId, updatedAt: at });
}
export function withdrawAssessment(assessment, at) {
    if (assessment.status !== 'in_progress' && assessment.status !== 'paused')
        throw new PreliminaryAssessmentError('invalid_transition');
    return transition(assessment, 'withdrawn', at);
}
export function expireAssessment(assessment, at) {
    if (assessment.status !== 'in_progress' && assessment.status !== 'paused')
        throw new PreliminaryAssessmentError('invalid_transition');
    return transition(assessment, 'expired', at);
}
export function recordAssessmentResponse(assessment, responseValue, instrument, availability = instrumentValue => isInstrumentAvailable(instrumentValue)) {
    if (assessment.status !== 'in_progress')
        throw new PreliminaryAssessmentError('assessment_closed');
    if (assessment.instrumentVersionId === null || assessment.instrumentVersionId !== instrument.instrumentVersionId) {
        throw new PreliminaryAssessmentError('instrument_version_mismatch');
    }
    const response = validateResponseForInstrument(responseValue, instrument);
    if (!availability(instrument, response.updatedAt))
        throw new PreliminaryAssessmentError('instrument_unavailable');
    if (response.assessmentId !== assessment.assessmentId)
        throw new PreliminaryAssessmentError('invalid_response');
    if (response.updatedAt < assessment.updatedAt)
        throw new PreliminaryAssessmentError('invalid_response');
    const responses = upsertAssessmentResponse(assessment.responses, response);
    return freezeAssessment({ ...assessment, responses, updatedAt: response.updatedAt });
}
export function completeAssessment(assessment, at, instrument, availability = instrumentValue => isInstrumentAvailable(instrumentValue)) {
    if (assessment.status === 'completed')
        return assessment;
    if (assessment.status !== 'in_progress')
        throw new PreliminaryAssessmentError('invalid_transition');
    if (assessment.instrumentVersionId !== null) {
        if (!instrument || instrument.instrumentVersionId !== assessment.instrumentVersionId) {
            throw new PreliminaryAssessmentError('instrument_version_mismatch');
        }
        if (!availability(instrument, at))
            throw new PreliminaryAssessmentError('instrument_unavailable');
        const requiredIds = instrument.questions.filter(question => question.required).map(question => question.id);
        const answeredIds = new Set(assessment.responses.filter(response => response.status === 'answered').map(response => response.questionId));
        if (requiredIds.some(id => !answeredIds.has(id)))
            throw new PreliminaryAssessmentError('responses_incomplete');
    }
    return transition(assessment, 'completed', at);
}
