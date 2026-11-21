import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  closeMonitoringSession,
  completeMonitoring,
  createMonitoringEnrollment,
  createMonitoringMeasurement,
  createUnavailableTrendSummary,
  LongitudinalMonitoringDomainError,
  monitoringContractVersion,
  monitoringConsentPurpose,
  monitoringObservationReferenceSchema,
  parseMonitoringEnrollment,
  monitoringTrendSummarySchema,
  pauseMonitoring,
  resumeMonitoring,
  startMonitoringSession,
  withdrawMonitoring,
} from '../../../src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';

const accountId = randomUUID();
const noticeVersionId = randomUUID();
const enrolledAt = new Date('2026-01-01T00:00:00.000Z');
const authorization = {
  purpose: monitoringConsentPurpose,
  state: 'granted',
  noticeVersionId,
  grantedAt: enrolledAt,
  checkedAt: enrolledAt,
};

function enrollment(authorizationOverride: Record<string, unknown> = {}) {
  return createMonitoringEnrollment({
    contractVersion: monitoringContractVersion,
    enrollmentId: randomUUID(), accountId, consentNoticeVersionId: noticeVersionId,
    enrolledAt, explicitOptIn: true,
  }, { ...authorization, ...authorizationOverride });
}

function measurementInput(overrides: Record<string, unknown> = {}) {
  const observedAt = new Date('2026-01-02T00:00:00.000Z');
  return {
    contractVersion: monitoringContractVersion,
    measurementId: randomUUID(), enrollmentId: randomUUID(), sessionId: randomUUID(), accountId,
    dimension: 'stress', evidenceStatus: 'reported',
    sourceReference: { contractVersion: monitoringContractVersion, source: 'student_report', reportId: randomUUID(), observedAt },
    observedAt, recordedAt: new Date('2026-01-02T00:01:00.000Z'),
    ...overrides,
  };
}

describe('Longitudinal monitoring domain contracts', () => {
  it('creates enrollment only after explicit opt-in for the dedicated current consent purpose', () => {
    const created = enrollment();
    expect(created).toMatchObject({ status: 'active', consentPurpose: 'longitudinal_monitoring', consentNoticeVersionId: noticeVersionId });
    expect(created.revision).toBe(1);
    expect(() => createMonitoringEnrollment({
      contractVersion: monitoringContractVersion, enrollmentId: randomUUID(), accountId,
      consentNoticeVersionId: noticeVersionId, enrolledAt, explicitOptIn: false,
    }, authorization)).toThrow(LongitudinalMonitoringDomainError);
  });

  it.each(['declined', 'withdrawn', 'not_decided', 'renewal_required'] as const)(
    'rejects enrollment when consent state is %s', (state) => {
      expect(() => createMonitoringEnrollment({
        contractVersion: monitoringContractVersion, enrollmentId: randomUUID(), accountId,
        consentNoticeVersionId: noticeVersionId, enrolledAt, explicitOptIn: true,
      }, { ...authorization, state })).toThrowError(expect.objectContaining({ code: 'consent_required' }));
    },
  );

  it('rejects consent from a different purpose, notice version, or a check performed after enrollment', () => {
    const input = { contractVersion: monitoringContractVersion, enrollmentId: randomUUID(), accountId, consentNoticeVersionId: noticeVersionId, enrolledAt, explicitOptIn: true };
    expect(() => createMonitoringEnrollment(input, { ...authorization, purpose: 'ai_conversation_processing' })).toThrow(LongitudinalMonitoringDomainError);
    expect(() => createMonitoringEnrollment(input, { ...authorization, noticeVersionId: randomUUID() })).toThrow(LongitudinalMonitoringDomainError);
    expect(() => createMonitoringEnrollment(input, { ...authorization, checkedAt: new Date(enrolledAt.getTime() + 1) })).toThrow(LongitudinalMonitoringDomainError);
    expect(() => createMonitoringEnrollment(input, { ...authorization, grantedAt: new Date(enrolledAt.getTime() + 1) })).toThrow(LongitudinalMonitoringDomainError);
  });

  it('supports pause and only resumes with a currently granted monitoring authorization', () => {
    const created = enrollment();
    const paused = pauseMonitoring(created, new Date('2026-01-02T00:00:00.000Z'));
    expect(paused).toMatchObject({ status: 'paused', revision: 2 });
    expect(() => resumeMonitoring(paused, { ...authorization, state: 'withdrawn' }, new Date('2026-01-03T00:00:00.000Z'))).toThrow(LongitudinalMonitoringDomainError);
    const resumed = resumeMonitoring(paused, { ...authorization, checkedAt: new Date('2026-01-03T00:00:00.000Z') }, new Date('2026-01-03T00:00:00.000Z'));
    expect(resumed.status).toBe('active');
  });

  it('makes withdrawal and completion terminal and forbids later transitions', () => {
    const created = enrollment();
    const withdrawn = withdrawMonitoring(created, new Date('2026-01-02T00:00:00.000Z'));
    expect(withdrawn.status).toBe('withdrawn');
    expect(() => resumeMonitoring(withdrawn, authorization, new Date('2026-01-03T00:00:00.000Z'))).toThrow(LongitudinalMonitoringDomainError);
    const completed = completeMonitoring(created, new Date('2026-01-02T00:00:00.000Z'));
    expect(completed.status).toBe('completed');
    expect(() => pauseMonitoring(completed, new Date('2026-01-03T00:00:00.000Z'))).toThrow(LongitudinalMonitoringDomainError);
  });

  it('opens and closes a session only within an active enrollment', () => {
    const created = enrollment();
    const opened = startMonitoringSession(created, randomUUID(), new Date('2026-01-02T00:00:00.000Z'));
    expect(opened).toMatchObject({ status: 'in_progress', revision: 1 });
    const closed = closeMonitoringSession(created, opened, 'completed', new Date('2026-01-02T00:10:00.000Z'));
    expect(closed).toMatchObject({ status: 'completed', closedAt: new Date('2026-01-02T00:10:00.000Z'), revision: 2 });
    expect(() => closeMonitoringSession(created, closed, 'abandoned', new Date('2026-01-02T00:11:00.000Z'))).toThrow(LongitudinalMonitoringDomainError);
    expect(() => startMonitoringSession(withdrawMonitoring(created, new Date('2026-01-02T00:00:00.000Z')), randomUUID(), new Date('2026-01-03T00:00:00.000Z'))).toThrow(LongitudinalMonitoringDomainError);
  });

  it('keeps student reports, approved instrument results, and tentative conversation observations distinct', () => {
    const at = enrolledAt;
    expect(monitoringObservationReferenceSchema.parse({
      contractVersion: monitoringContractVersion, source: 'student_report', reportId: randomUUID(), observedAt: at,
    }).source).toBe('student_report');
    expect(monitoringObservationReferenceSchema.parse({
      contractVersion: monitoringContractVersion, source: 'validated_instrument', assessmentId: randomUUID(),
      resultId: randomUUID(), instrumentVersionId: randomUUID(), approvalReference: 'synthetic-approval', observedAt: at,
    }).source).toBe('validated_instrument');
    expect(monitoringObservationReferenceSchema.parse({
      contractVersion: monitoringContractVersion, source: 'tentative_conversational_observation', observationId: randomUUID(),
      conversationId: randomUUID(), messageIds: [randomUUID()], extractionContractVersion: '1.0', observedAt: at,
    }).source).toBe('tentative_conversational_observation');
    expect(monitoringObservationReferenceSchema.parse({
      contractVersion: monitoringContractVersion, source: 'monitoring_check_in', sessionId: randomUUID(), observedAt: at,
    }).source).toBe('monitoring_check_in');
    expect(monitoringObservationReferenceSchema.safeParse({
      contractVersion: monitoringContractVersion, source: 'tentative_conversational_observation',
      conversationId: randomUUID(), messageIds: [randomUUID()], extractionContractVersion: '1.0', observedAt: at,
    }).success).toBe(false);
  });

  it('rejects missing, duplicate, malformed, or mixed-source references', () => {
    const at = enrolledAt;
    expect(monitoringObservationReferenceSchema.safeParse({ contractVersion: monitoringContractVersion, source: 'student_report', reportId: 'bad', observedAt: at }).success).toBe(false);
    expect(monitoringObservationReferenceSchema.safeParse({ contractVersion: monitoringContractVersion, source: 'student_report', reportId: randomUUID(), assessmentId: randomUUID(), observedAt: at }).success).toBe(false);
    expect(monitoringObservationReferenceSchema.safeParse({
      contractVersion: monitoringContractVersion, source: 'tentative_conversational_observation', observationId: randomUUID(),
      conversationId: randomUUID(), messageIds: [accountId, accountId], extractionContractVersion: '1.0', observedAt: at,
    }).success).toBe(false);
  });

  it('requires measurement ownership, active enrollment, open session, and matching source time', () => {
    const created = enrollment();
    const opened = startMonitoringSession(created, randomUUID(), new Date('2026-01-02T00:00:00.000Z'));
    const base = measurementInput({ enrollmentId: created.enrollmentId, sessionId: opened.sessionId, observedAt: new Date('2026-01-02T00:01:00.000Z') });
    const valid = { ...base, sourceReference: { ...base.sourceReference, observedAt: base.observedAt } };
    expect(createMonitoringMeasurement(created, opened, valid).dimension).toBe('stress');
    expect(() => createMonitoringMeasurement(created, opened, { ...valid, accountId: randomUUID() })).toThrow(LongitudinalMonitoringDomainError);
    expect(() => createMonitoringMeasurement(created, opened, { ...valid, observedAt: new Date('2026-01-02T00:02:00.000Z') })).toThrow(LongitudinalMonitoringDomainError);
  });

  it('allows explicit missing evidence without treating it as absence, but still requires provenance', () => {
    const created = enrollment();
    const opened = startMonitoringSession(created, randomUUID(), new Date('2026-01-02T00:00:00.000Z'));
    const observedAt = new Date('2026-01-02T00:01:00.000Z');
    const input = measurementInput({
      enrollmentId: created.enrollmentId, sessionId: opened.sessionId,
      evidenceStatus: 'not_assessed', observedAt,
      sourceReference: { contractVersion: monitoringContractVersion, source: 'monitoring_check_in', sessionId: opened.sessionId, observedAt },
    });
    expect(createMonitoringMeasurement(created, opened, input).evidenceStatus).toBe('not_assessed');
    expect(() => createMonitoringMeasurement(created, opened, { ...input, sourceReference: null })).toThrow(LongitudinalMonitoringDomainError);
  });

  it('prevents creating measurements after withdrawal or pause', () => {
    const created = enrollment();
    const opened = startMonitoringSession(created, randomUUID(), new Date('2026-01-02T00:00:00.000Z'));
    const input = measurementInput({ enrollmentId: created.enrollmentId, sessionId: opened.sessionId });
    expect(() => createMonitoringMeasurement(withdrawMonitoring(created, new Date('2026-01-03T00:00:00.000Z')), opened, input)).toThrowError(expect.objectContaining({ code: 'enrollment_inactive' }));
    expect(() => createMonitoringMeasurement(pauseMonitoring(created, new Date('2026-01-03T00:00:00.000Z')), opened, input)).toThrowError(expect.objectContaining({ code: 'enrollment_inactive' }));
  });

  it('accepts only explicitly unavailable trend summaries until comparable data and approved rules exist', () => {
    const summary = createUnavailableTrendSummary({
      contractVersion: monitoringContractVersion, summaryId: randomUUID(), enrollmentId: randomUUID(), accountId,
      status: 'not_available', reason: 'no_approved_rules', periodStart: enrolledAt,
      periodEnd: new Date('2026-01-10T00:00:00.000Z'), sourceMeasurementIds: [],
      calculatedAt: new Date('2026-01-11T00:00:00.000Z'), approvedRulesVersion: null,
    });
    expect(summary.status).toBe('not_available');
    expect(() => createUnavailableTrendSummary({ ...summary, status: 'available', direction: 'improving', score: 0 })).toThrow(LongitudinalMonitoringDomainError);
    expect(monitoringTrendSummarySchema.safeParse({ ...summary, diagnosis: 'depression' }).success).toBe(false);
  });

  it('rejects invalid date ordering and unknown clinical fields', () => {
    expect(() => createMonitoringEnrollment({
      contractVersion: monitoringContractVersion, enrollmentId: randomUUID(), accountId, consentNoticeVersionId: noticeVersionId,
      enrolledAt: new Date(Number.NaN), explicitOptIn: true,
    }, authorization)).toThrow(LongitudinalMonitoringDomainError);
    const created = enrollment();
    expect(() => parseMonitoringEnrollment({ ...created, diagnosis: 'anxiety' })).toThrow(LongitudinalMonitoringDomainError);
    expect(() => pauseMonitoring(created, new Date('2025-12-31T00:00:00.000Z'))).toThrow(LongitudinalMonitoringDomainError);
  });
});
