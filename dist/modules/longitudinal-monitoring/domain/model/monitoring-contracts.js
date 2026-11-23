import { z } from 'zod';
/** Versioned, provider-neutral contracts; not evidence of clinical validation. */
export const monitoringContractVersion = '1.0';
export const monitoringConsentPurpose = 'longitudinal_monitoring';
export const monitoringDimensions = ['depression', 'anxiety', 'stress'];
export const monitoringEnrollmentStatuses = ['active', 'paused', 'withdrawn', 'completed'];
export const monitoringSessionStatuses = ['in_progress', 'completed', 'abandoned'];
export const monitoringEvidenceStatuses = ['reported', 'ambiguous', 'not_reported', 'not_assessed'];
export const monitoringTrendUnavailableReasons = [
    'no_approved_rules',
    'insufficient_comparable_measurements',
    'source_not_persisted',
    'not_assessed',
];
const uuid = z.string().uuid();
const finiteDate = z.date();
/** Snapshot from a future Consent adapter. Only the dedicated purpose can authorize enrollment. */
export const currentMonitoringAuthorizationSchema = z.object({
    purpose: z.literal(monitoringConsentPurpose),
    state: z.enum(['granted', 'declined', 'withdrawn', 'not_decided', 'renewal_required']),
    noticeVersionId: uuid.nullable(),
    grantedAt: finiteDate.nullable(),
    checkedAt: finiteDate,
}).strict();
export const monitoringEnrollmentSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    enrollmentId: uuid,
    accountId: uuid,
    status: z.enum(monitoringEnrollmentStatuses),
    consentPurpose: z.literal(monitoringConsentPurpose),
    consentNoticeVersionId: uuid,
    consentedAt: finiteDate,
    enrolledAt: finiteDate,
    statusChangedAt: finiteDate,
    updatedAt: finiteDate,
    revision: z.number().int().min(1),
}).strict().superRefine((enrollment, context) => {
    if (enrollment.consentedAt > enrollment.enrolledAt || enrollment.enrolledAt > enrollment.updatedAt || enrollment.statusChangedAt > enrollment.updatedAt) {
        context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Enrollment timestamps must be chronologically consistent' });
    }
});
export function parseMonitoringEnrollment(value) {
    const parsed = monitoringEnrollmentSchema.safeParse(value);
    if (!parsed.success)
        throw new LongitudinalMonitoringDomainError('invalid_enrollment');
    return parsed.data;
}
export const newMonitoringEnrollmentSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    enrollmentId: uuid,
    accountId: uuid,
    consentNoticeVersionId: uuid,
    enrolledAt: finiteDate,
    explicitOptIn: z.literal(true),
}).strict();
export const monitoringSessionSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    sessionId: uuid,
    enrollmentId: uuid,
    accountId: uuid,
    status: z.enum(monitoringSessionStatuses),
    openedAt: finiteDate,
    updatedAt: finiteDate,
    closedAt: finiteDate.nullable(),
    revision: z.number().int().min(1),
}).strict().superRefine((session, context) => {
    if (session.updatedAt < session.openedAt || (session.closedAt !== null && session.closedAt < session.openedAt)) {
        context.addIssue({ code: 'custom', path: ['closedAt'], message: 'Session timestamps are inconsistent' });
    }
    if ((session.status === 'in_progress') !== (session.closedAt === null)) {
        context.addIssue({ code: 'custom', path: ['closedAt'], message: 'Open sessions have no closedAt; terminal sessions require it' });
    }
});
const studentReportReferenceSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    source: z.literal('student_report'),
    reportId: uuid,
    observedAt: finiteDate,
}).strict();
const validatedInstrumentReferenceSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    source: z.literal('validated_instrument'),
    assessmentId: uuid,
    resultId: uuid,
    instrumentVersionId: uuid,
    approvalReference: z.string().trim().min(1).max(300),
    observedAt: finiteDate,
}).strict();
const tentativeConversationReferenceSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    source: z.literal('tentative_conversational_observation'),
    observationId: uuid,
    conversationId: uuid,
    messageIds: z.array(uuid).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
    extractionContractVersion: z.string().trim().min(1).max(40),
    observedAt: finiteDate,
}).strict();
const monitoringCheckInReferenceSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    source: z.literal('monitoring_check_in'),
    sessionId: uuid,
    observedAt: finiteDate,
}).strict();
/** References only; source content and answers are deliberately not copied into monitoring. */
export const monitoringObservationReferenceSchema = z.discriminatedUnion('source', [
    studentReportReferenceSchema,
    validatedInstrumentReferenceSchema,
    tentativeConversationReferenceSchema,
    monitoringCheckInReferenceSchema,
]);
export const monitoringMeasurementSchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    measurementId: uuid,
    enrollmentId: uuid,
    sessionId: uuid,
    accountId: uuid,
    dimension: z.enum(monitoringDimensions),
    evidenceStatus: z.enum(monitoringEvidenceStatuses),
    sourceReference: monitoringObservationReferenceSchema,
    observedAt: finiteDate,
    recordedAt: finiteDate,
}).strict().superRefine((measurement, context) => {
    if (measurement.observedAt > measurement.recordedAt) {
        context.addIssue({ code: 'custom', path: ['recordedAt'], message: 'A measurement cannot be recorded before it was observed' });
    }
    if (measurement.observedAt.getTime() !== measurement.sourceReference.observedAt.getTime()) {
        context.addIssue({ code: 'custom', path: ['observedAt'], message: 'Measurement time must match its source reference' });
    }
});
/** No trend calculation is currently approved; this contract can only report unavailability. */
export const monitoringTrendSummarySchema = z.object({
    contractVersion: z.literal(monitoringContractVersion),
    summaryId: uuid,
    enrollmentId: uuid,
    accountId: uuid,
    status: z.literal('not_available'),
    reason: z.enum(monitoringTrendUnavailableReasons),
    periodStart: finiteDate,
    periodEnd: finiteDate,
    sourceMeasurementIds: z.array(uuid).max(100).refine((ids) => new Set(ids).size === ids.length),
    calculatedAt: finiteDate,
    approvedRulesVersion: z.null(),
}).strict().superRefine((summary, context) => {
    if (summary.periodStart > summary.periodEnd || summary.periodEnd > summary.calculatedAt) {
        context.addIssue({ code: 'custom', path: ['periodEnd'], message: 'Trend summary period timestamps are inconsistent' });
    }
});
export class LongitudinalMonitoringDomainError extends Error {
    code;
    constructor(code) {
        super('Longitudinal monitoring domain validation failed');
        this.code = code;
        this.name = 'LongitudinalMonitoringDomainError';
    }
}
function currentGrant(value, at) {
    const parsed = currentMonitoringAuthorizationSchema.safeParse(value);
    if (!parsed.success || parsed.data.state !== 'granted' || parsed.data.noticeVersionId === null || parsed.data.grantedAt === null ||
        parsed.data.grantedAt > parsed.data.checkedAt || parsed.data.checkedAt > at) {
        throw new LongitudinalMonitoringDomainError('consent_required');
    }
    return parsed.data;
}
export function createMonitoringEnrollment(inputValue, authorizationValue) {
    const parsed = newMonitoringEnrollmentSchema.safeParse(inputValue);
    if (!parsed.success)
        throw new LongitudinalMonitoringDomainError('invalid_enrollment');
    const input = parsed.data;
    const authorization = currentGrant(authorizationValue, input.enrolledAt);
    if (authorization.noticeVersionId !== input.consentNoticeVersionId) {
        throw new LongitudinalMonitoringDomainError('consent_required');
    }
    return parseMonitoringEnrollment({
        contractVersion: monitoringContractVersion,
        enrollmentId: input.enrollmentId,
        accountId: input.accountId,
        status: 'active',
        consentPurpose: monitoringConsentPurpose,
        consentNoticeVersionId: input.consentNoticeVersionId,
        consentedAt: authorization.grantedAt,
        enrolledAt: input.enrolledAt,
        statusChangedAt: input.enrolledAt,
        updatedAt: input.enrolledAt,
        revision: 1,
    });
}
function changeEnrollmentStatus(enrollment, status, at) {
    if (enrollment.status === 'withdrawn' || enrollment.status === 'completed' || at < enrollment.updatedAt) {
        throw new LongitudinalMonitoringDomainError('invalid_transition');
    }
    return monitoringEnrollmentSchema.parse({ ...enrollment, status, statusChangedAt: at, updatedAt: at, revision: enrollment.revision + 1 });
}
export function pauseMonitoring(enrollment, at) {
    if (enrollment.status !== 'active')
        throw new LongitudinalMonitoringDomainError('invalid_transition');
    return changeEnrollmentStatus(enrollment, 'paused', at);
}
export function resumeMonitoring(enrollment, authorizationValue, at) {
    if (enrollment.status !== 'paused')
        throw new LongitudinalMonitoringDomainError('invalid_transition');
    currentGrant(authorizationValue, at);
    return changeEnrollmentStatus(enrollment, 'active', at);
}
export function withdrawMonitoring(enrollment, at) {
    if (enrollment.status !== 'active' && enrollment.status !== 'paused')
        throw new LongitudinalMonitoringDomainError('invalid_transition');
    return changeEnrollmentStatus(enrollment, 'withdrawn', at);
}
export function completeMonitoring(enrollment, at) {
    if (enrollment.status !== 'active' && enrollment.status !== 'paused')
        throw new LongitudinalMonitoringDomainError('invalid_transition');
    return changeEnrollmentStatus(enrollment, 'completed', at);
}
export function startMonitoringSession(enrollment, sessionId, at) {
    if (enrollment.status !== 'active' || !uuid.safeParse(sessionId).success || at < enrollment.enrolledAt || at < enrollment.updatedAt) {
        throw new LongitudinalMonitoringDomainError('enrollment_inactive');
    }
    return monitoringSessionSchema.parse({
        contractVersion: monitoringContractVersion,
        sessionId,
        enrollmentId: enrollment.enrollmentId,
        accountId: enrollment.accountId,
        status: 'in_progress',
        openedAt: at,
        updatedAt: at,
        closedAt: null,
        revision: 1,
    });
}
export function closeMonitoringSession(enrollment, session, status, at) {
    if (session.enrollmentId !== enrollment.enrollmentId || session.accountId !== enrollment.accountId || session.status !== 'in_progress' || at < session.updatedAt) {
        throw new LongitudinalMonitoringDomainError('invalid_session');
    }
    return monitoringSessionSchema.parse({ ...session, status, updatedAt: at, closedAt: at, revision: session.revision + 1 });
}
export function parseMonitoringSession(value) {
    const parsed = monitoringSessionSchema.safeParse(value);
    if (!parsed.success)
        throw new LongitudinalMonitoringDomainError('invalid_session');
    return parsed.data;
}
export function createMonitoringMeasurement(enrollment, session, inputValue) {
    const parsed = monitoringMeasurementSchema.safeParse(inputValue);
    if (!parsed.success)
        throw new LongitudinalMonitoringDomainError('invalid_measurement');
    const measurement = parsed.data;
    if (enrollment.status !== 'active')
        throw new LongitudinalMonitoringDomainError('enrollment_inactive');
    if (session.status !== 'in_progress' || session.enrollmentId !== enrollment.enrollmentId || session.accountId !== enrollment.accountId ||
        measurement.enrollmentId !== enrollment.enrollmentId || measurement.sessionId !== session.sessionId || measurement.accountId !== enrollment.accountId ||
        measurement.observedAt < enrollment.enrolledAt || measurement.observedAt < session.openedAt) {
        throw new LongitudinalMonitoringDomainError('invalid_measurement');
    }
    return measurement;
}
export function createUnavailableTrendSummary(inputValue) {
    const parsed = monitoringTrendSummarySchema.safeParse(inputValue);
    if (!parsed.success)
        throw new LongitudinalMonitoringDomainError('invalid_trend_summary');
    return parsed.data;
}
