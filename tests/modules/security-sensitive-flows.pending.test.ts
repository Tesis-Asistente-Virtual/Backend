import { describe, expect, it, vi } from 'vitest';
import { StartMonitoringEnrollment } from '../../src/modules/longitudinal-monitoring/application/internal/command-services/start-monitoring-enrollment.js';
import { ChangeMonitoringEnrollmentState } from '../../src/modules/longitudinal-monitoring/application/internal/command-services/change-monitoring-enrollment-state.js';
import { CreateMonitoringSession } from '../../src/modules/longitudinal-monitoring/application/internal/command-services/create-monitoring-session.js';
import type { MonitoringConsentAuthorizer } from '../../src/modules/longitudinal-monitoring/application/ports/monitoring-consent-authorizer.js';
import { MonitoringError } from '../../src/modules/longitudinal-monitoring/domain/model/monitoring-errors.js';
import { createMonitoringEnrollment, monitoringConsentPurpose, monitoringContractVersion, pauseMonitoring, startMonitoringSession, type MonitoringEnrollment } from '../../src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';
import type { MonitoringEnrollmentRepository } from '../../src/modules/longitudinal-monitoring/domain/repositories/monitoring-enrollment-repository.js';
import type { MonitoringSessionRepository } from '../../src/modules/longitudinal-monitoring/domain/repositories/monitoring-session-repository.js';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const noticeVersionId = '550e8400-e29b-41d4-a716-446655440001';
const now = new Date('2026-11-01T12:00:00.000Z');
const authorization = { purpose: monitoringConsentPurpose, state: 'granted', noticeVersionId, grantedAt: now, checkedAt: now } as const;

function makeEnrollment(): MonitoringEnrollment {
  return createMonitoringEnrollment({
    contractVersion: monitoringContractVersion,
    enrollmentId: '550e8400-e29b-41d4-a716-446655440002',
    accountId,
    consentNoticeVersionId: noticeVersionId,
    enrolledAt: now,
    explicitOptIn: true,
  }, authorization);
}

function consent(): MonitoringConsentAuthorizer {
  return { getCurrentAuthorization: vi.fn(async () => authorization) };
}

describe('security-sensitive monitoring writes', () => {
  it('uses transactional consent revalidation for enrollment, resume, and session writes', async () => {
    const denied = new MonitoringError('consent_required');
    const enrollmentRepository: MonitoringEnrollmentRepository = {
      create: vi.fn(async value => value),
      createWithCurrentConsent: vi.fn(async () => { throw denied; }),
      findByIdForOwner: vi.fn(async () => null),
      listByOwner: vi.fn(async () => []),
      saveStatusForOwner: vi.fn(async () => true),
      saveStatusForOwnerWithCurrentConsent: vi.fn(async () => { throw denied; }),
    };

    await expect(new StartMonitoringEnrollment(enrollmentRepository, consent(), () => now, () => '550e8400-e29b-41d4-a716-446655440003')
      .execute(accountId, true)).rejects.toMatchObject({ code: 'consent_required' });
    expect(enrollmentRepository.createWithCurrentConsent).toHaveBeenCalledOnce();
    expect(enrollmentRepository.create).not.toHaveBeenCalled();

    const active = makeEnrollment();
    const paused = pauseMonitoring(active, new Date(now.getTime() + 1000));
    vi.mocked(enrollmentRepository.findByIdForOwner).mockResolvedValue(paused);
    await expect(new ChangeMonitoringEnrollmentState(enrollmentRepository, consent(), () => new Date(now.getTime() + 2000))
      .execute(paused.enrollmentId, accountId, 'resume')).rejects.toMatchObject({ code: 'consent_required' });
    expect(enrollmentRepository.saveStatusForOwnerWithCurrentConsent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }), accountId, paused.revision, noticeVersionId,
    );
    expect(enrollmentRepository.saveStatusForOwner).not.toHaveBeenCalled();

    const session = startMonitoringSession(active, '550e8400-e29b-41d4-a716-446655440004', new Date(now.getTime() + 1000));
    vi.mocked(enrollmentRepository.findByIdForOwner).mockResolvedValue(active);
    const sessions: MonitoringSessionRepository = {
      create: vi.fn(async () => session),
      createWithCurrentConsent: vi.fn(async () => { throw denied; }),
      findByIdForOwner: vi.fn(async () => null),
      listByEnrollmentForOwner: vi.fn(async () => []),
      saveStatusForOwner: vi.fn(async () => true),
    };
    await expect(new CreateMonitoringSession(enrollmentRepository, sessions, consent(), () => new Date(now.getTime() + 1000), () => session.sessionId)
      .execute(active.enrollmentId, accountId)).rejects.toMatchObject({ code: 'consent_required' });
    expect(sessions.createWithCurrentConsent).toHaveBeenCalledWith(session, noticeVersionId);
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
