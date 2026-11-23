import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ChangeMonitoringEnrollmentState } from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/change-monitoring-enrollment-state.js';
import { CreateMonitoringSession } from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/create-monitoring-session.js';
import { AssociateConversationWithMonitoringSession } from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/associate-conversation-with-monitoring-session.js';
import { StartMonitoringEnrollment } from '../../../src/modules/longitudinal-monitoring/application/internal/command-services/start-monitoring-enrollment.js';
import { GetMonitoringInfo } from '../../../src/modules/longitudinal-monitoring/application/internal/query-services/get-monitoring-info.js';
import { GetMyMonitoringEnrollment } from '../../../src/modules/longitudinal-monitoring/application/internal/query-services/get-my-monitoring-enrollment.js';
import { ListMyMonitoringSessions } from '../../../src/modules/longitudinal-monitoring/application/internal/query-services/list-my-monitoring-sessions.js';
import type { MonitoringConsentAuthorizer } from '../../../src/modules/longitudinal-monitoring/application/ports/monitoring-consent-authorizer.js';
import type { MonitoringConversationAssociationScope } from '../../../src/modules/longitudinal-monitoring/application/ports/monitoring-conversation-association-scope.js';
import { MonitoringError } from '../../../src/modules/longitudinal-monitoring/domain/model/monitoring-errors.js';
import { createMonitoringEnrollment, monitoringConsentPurpose, monitoringContractVersion, pauseMonitoring, startMonitoringSession, withdrawMonitoring, type MonitoringEnrollment, type MonitoringSession } from '../../../src/modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';
import type { MonitoringEnrollmentRepository } from '../../../src/modules/longitudinal-monitoring/domain/repositories/monitoring-enrollment-repository.js';
import type { MonitoringSessionRepository } from '../../../src/modules/longitudinal-monitoring/domain/repositories/monitoring-session-repository.js';
import type { MonitoringConversationAssociationRepository } from '../../../src/modules/longitudinal-monitoring/domain/repositories/monitoring-conversation-association-repository.js';
import { associateMonitoringConversationBodySchema, monitoringEnrollmentIdParamsSchema, monitoringPaginationSchema, monitoringSessionConversationParamsSchema, startMonitoringEnrollmentBodySchema } from '../../../src/modules/longitudinal-monitoring/interfaces/rest/validation/monitoring-request-schemas.js';
import { openApiDocument } from '../../../src/shared/infrastructure/http/openapi-document.js';
import { monitoringPaths } from '../../../src/modules/longitudinal-monitoring/interfaces/rest/openapi.js';
import { DenyUnapprovedMonitoringConversationAssociation } from '../../../src/modules/longitudinal-monitoring/infrastructure/persistence/deny-unapproved-monitoring-conversation-association.js';

const accountId = randomUUID();
const noticeId = randomUUID();
const time = new Date('2026-10-01T10:00:00.000Z');
const granted = { purpose: monitoringConsentPurpose, state: 'granted', noticeVersionId: noticeId, grantedAt: time, checkedAt: time } as const;

function enrollment(): MonitoringEnrollment {
  return createMonitoringEnrollment({
    contractVersion: monitoringContractVersion, enrollmentId: randomUUID(), accountId,
    consentNoticeVersionId: noticeId, enrolledAt: time, explicitOptIn: true,
  }, granted);
}

function enrollmentRepository(overrides: Partial<MonitoringEnrollmentRepository> = {}): MonitoringEnrollmentRepository {
  return {
    create: vi.fn(async (value) => value),
    createWithCurrentConsent: vi.fn(async (value) => value),
    findByIdForOwner: vi.fn(async () => null),
    listByOwner: vi.fn(async () => []),
    saveStatusForOwner: vi.fn(async () => true),
    saveStatusForOwnerWithCurrentConsent: vi.fn(async () => true),
    ...overrides,
  };
}

function consent(overrides: Partial<MonitoringConsentAuthorizer> = {}): MonitoringConsentAuthorizer {
  return { getCurrentAuthorization: vi.fn(async () => granted), ...overrides };
}

function associationScope(allowed = true): MonitoringConversationAssociationScope {
  return { isNoticeApprovedForAssociation: vi.fn(async () => allowed) };
}

describe('LongitudinalMonitoring application and REST contracts', () => {
  it('starts only after explicit current consent for the dedicated purpose', async () => {
    const repository = enrollmentRepository();
    const authorizer = consent();
    const start = new StartMonitoringEnrollment(repository, authorizer, () => time, () => 'f4c2b39d-5036-4492-8f23-23dc9a9b2b62');
    const result = await start.execute(accountId, true);
    expect(result).toMatchObject({ accountId, status: 'active', consentNoticeVersionId: noticeId, revision: 1 });
    expect(repository.createWithCurrentConsent).toHaveBeenCalledWith(result);
    expect(repository.create).not.toHaveBeenCalled();
    expect(authorizer.getCurrentAuthorization).toHaveBeenCalledWith(accountId);
  });

  it.each([
    ['absent', null],
    ['declined', { ...granted, state: 'declined' as const }],
    ['withdrawn', { ...granted, state: 'withdrawn' as const }],
    ['replaced notice', { ...granted, state: 'renewal_required' as const, noticeVersionId: null }],
  ])('fails closed when consent is %s', async (_label, authorization) => {
    const repository = enrollmentRepository();
    const start = new StartMonitoringEnrollment(repository, consent({ getCurrentAuthorization: vi.fn(async () => authorization) }), () => time);
    await expect(start.execute(accountId, true)).rejects.toMatchObject({ code: 'consent_required' });
    expect(repository.createWithCurrentConsent).not.toHaveBeenCalled();
  });

  it('maps consent service failure to a safe unavailable error without persistence', async () => {
    const repository = enrollmentRepository();
    const start = new StartMonitoringEnrollment(repository, consent({ getCurrentAuthorization: vi.fn(async () => { throw new Error('private backend detail'); }) }));
    await expect(start.execute(accountId, true)).rejects.toMatchObject({ code: 'consent_unavailable' });
    expect(repository.createWithCurrentConsent).not.toHaveBeenCalled();
  });

  it('scopes enrollment reads to the owner and does not disclose foreign records', async () => {
    const repository = enrollmentRepository();
    const get = new GetMyMonitoringEnrollment(repository);
    await expect(get.execute(randomUUID(), accountId)).rejects.toBeInstanceOf(MonitoringError);
    expect(repository.findByIdForOwner).toHaveBeenCalledWith(expect.any(String), accountId);
  });

  it('uses optimistic revisions and makes repeated pause/withdraw operations idempotent', async () => {
    let stored = enrollment();
    const repository = enrollmentRepository({
      findByIdForOwner: vi.fn(async () => stored),
      saveStatusForOwner: vi.fn(async (next) => { stored = next; return true; }),
    });
    const state = new ChangeMonitoringEnrollmentState(repository, consent(), () => new Date(time.getTime() + 1000));
    const paused = await state.execute(stored.enrollmentId, accountId, 'pause');
    expect(paused).toMatchObject({ status: 'paused', revision: 2 });
    expect(await state.execute(stored.enrollmentId, accountId, 'pause')).toEqual(paused);
    const withdrawn = await state.execute(stored.enrollmentId, accountId, 'withdraw');
    expect(withdrawn).toMatchObject({ status: 'withdrawn', revision: 3 });
    expect(await state.execute(stored.enrollmentId, accountId, 'withdraw')).toEqual(withdrawn);
    expect(repository.saveStatusForOwner).toHaveBeenCalledTimes(2);
  });

  it('requires the enrollment consent version to resume and reports CAS conflicts', async () => {
    const paused = pauseMonitoring(enrollment(), new Date(time.getTime() + 1000));
    const repository = enrollmentRepository({ findByIdForOwner: vi.fn(async () => paused), saveStatusForOwnerWithCurrentConsent: vi.fn(async () => false) });
    const changedConsent = consent({ getCurrentAuthorization: vi.fn(async () => ({ ...granted, noticeVersionId: randomUUID() })) });
    await expect(new ChangeMonitoringEnrollmentState(repository, changedConsent).execute(paused.enrollmentId, accountId, 'resume'))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(repository.saveStatusForOwnerWithCurrentConsent).not.toHaveBeenCalled();

    const validConsent = consent({ getCurrentAuthorization: vi.fn(async () => ({ ...granted, checkedAt: new Date(time.getTime() + 2000) })) });
    await expect(new ChangeMonitoringEnrollmentState(repository, validConsent, () => new Date(time.getTime() + 3000))
      .execute(paused.enrollmentId, accountId, 'resume')).rejects.toMatchObject({ code: 'concurrent_modification' });
  });

  it('revalidates consent before resuming and completes idempotently', async () => {
    let stored = pauseMonitoring(enrollment(), new Date(time.getTime() + 1000));
    const repository = enrollmentRepository({
      findByIdForOwner: vi.fn(async () => stored),
      saveStatusForOwnerWithCurrentConsent: vi.fn(async (next) => { stored = next; return true; }),
      saveStatusForOwner: vi.fn(async (next) => { stored = next; return true; }),
    });
    const authorizer = consent({ getCurrentAuthorization: vi.fn(async () => ({ ...granted, checkedAt: new Date(time.getTime() + 2000) })) });
    const state = new ChangeMonitoringEnrollmentState(repository, authorizer, () => new Date(time.getTime() + 3000));
    const resumed = await state.execute(stored.enrollmentId, accountId, 'resume');
    expect(resumed).toMatchObject({ status: 'active', revision: 3 });
    expect(authorizer.getCurrentAuthorization).toHaveBeenCalledOnce();
    const completed = await state.execute(stored.enrollmentId, accountId, 'complete');
    expect(completed).toMatchObject({ status: 'completed', revision: 4 });
    expect(await state.execute(stored.enrollmentId, accountId, 'complete')).toEqual(completed);
    expect(repository.saveStatusForOwnerWithCurrentConsent).toHaveBeenCalledOnce();
    expect(repository.saveStatusForOwner).toHaveBeenCalledOnce();
  });

  it('creates sessions only for an active owner enrollment with current matching consent', async () => {
    const active = enrollment();
    const session = startMonitoringSession(active, randomUUID(), new Date(time.getTime() + 1000));
    const enrollments = enrollmentRepository({ findByIdForOwner: vi.fn(async () => active) });
    const sessions: MonitoringSessionRepository = {
      create: vi.fn(async () => session), findByIdForOwner: vi.fn(async () => session),
      createWithCurrentConsent: vi.fn(async () => session),
      listByEnrollmentForOwner: vi.fn(async () => [session]), saveStatusForOwner: vi.fn(async () => true),
    };
    const result = await new CreateMonitoringSession(enrollments, sessions, consent(), () => new Date(time.getTime() + 1000), () => session.sessionId)
      .execute(active.enrollmentId, accountId);
    expect(result).toEqual(session);
    expect(sessions.createWithCurrentConsent).toHaveBeenCalledWith(session, noticeId);
    expect(sessions.create).not.toHaveBeenCalled();

    const wrongVersion = consent({ getCurrentAuthorization: vi.fn(async () => ({ ...granted, noticeVersionId: randomUUID() })) });
    await expect(new CreateMonitoringSession(enrollments, sessions, wrongVersion).execute(active.enrollmentId, accountId))
      .rejects.toMatchObject({ code: 'consent_required' });
    expect(sessions.createWithCurrentConsent).toHaveBeenCalledOnce();
  });

  it('does not persist a session for a paused or withdrawn enrollment', async () => {
    const inactive = withdrawMonitoring(enrollment(), new Date(time.getTime() + 1000));
    const enrollments = enrollmentRepository({ findByIdForOwner: vi.fn(async () => inactive) });
    const sessions: MonitoringSessionRepository = {
      create: vi.fn(async (value) => value), findByIdForOwner: vi.fn(async () => null),
      createWithCurrentConsent: vi.fn(async (value) => value),
      listByEnrollmentForOwner: vi.fn(async () => []), saveStatusForOwner: vi.fn(async () => true),
    };
    await expect(new CreateMonitoringSession(enrollments, sessions, consent(), () => new Date(time.getTime() + 2000))
      .execute(inactive.enrollmentId, accountId)).rejects.toMatchObject({ code: 'enrollment_inactive' });
    expect(sessions.createWithCurrentConsent).not.toHaveBeenCalled();
  });

  it('associates one explicitly selected conversation to an owner session using metadata only', async () => {
    const active = enrollment();
    const session = startMonitoringSession(active, randomUUID(), new Date(time.getTime() + 1000));
    const conversationId = randomUUID();
    const association = {
      contractVersion: '1.0' as const, associationId: randomUUID(), enrollmentId: active.enrollmentId,
      monitoringSessionId: session.sessionId, conversationId, accountId, createdAt: new Date(time.getTime() + 2000),
    };
    const enrollments = enrollmentRepository({ findByIdForOwner: vi.fn(async () => active) });
    const associations: MonitoringConversationAssociationRepository = {
      createWithCurrentConsent: vi.fn(async () => association),
    };
    const authorizer = consent({ getCurrentAuthorization: vi.fn(async () => ({ ...granted, checkedAt: new Date(time.getTime() + 1500) })) });
    const useCase = new AssociateConversationWithMonitoringSession(enrollments, associations, authorizer, associationScope(), () => new Date(time.getTime() + 2000), () => association.associationId);

    await expect(useCase.execute(accountId, {
      enrollmentId: active.enrollmentId, monitoringSessionId: session.sessionId,
      conversationId, explicitAssociation: true,
    })).resolves.toEqual(association);
    expect(associations.createWithCurrentConsent).toHaveBeenCalledWith({
      associationId: association.associationId,
      enrollmentId: active.enrollmentId,
      monitoringSessionId: session.sessionId,
      conversationId,
      accountId,
      consentNoticeVersionId: noticeId,
      createdAt: new Date(time.getTime() + 2000),
    });
    expect(enrollments.findByIdForOwner).toHaveBeenCalledWith(active.enrollmentId, accountId);
    expect(authorizer.getCurrentAuthorization).toHaveBeenCalledWith(accountId);
  });

  it.each([
    ['missing', null],
    ['withdrawn', { ...granted, state: 'withdrawn' as const }],
    ['declined', { ...granted, state: 'declined' as const }],
    ['superseded notice', { ...granted, state: 'renewal_required' as const, noticeVersionId: null }],
    ['different notice version', { ...granted, noticeVersionId: randomUUID() }],
  ])('does not write a conversation link when monitoring consent is %s', async (_label, authorization) => {
    const active = enrollment();
    const associations: MonitoringConversationAssociationRepository = { createWithCurrentConsent: vi.fn(async () => { throw new Error('must not be called'); }) };
    const useCase = new AssociateConversationWithMonitoringSession(
      enrollmentRepository({ findByIdForOwner: vi.fn(async () => active) }),
      associations,
      consent({ getCurrentAuthorization: vi.fn(async () => authorization) }),
      associationScope(),
    );
    await expect(useCase.execute(accountId, {
      enrollmentId: active.enrollmentId, monitoringSessionId: randomUUID(), conversationId: randomUUID(), explicitAssociation: true,
    })).rejects.toMatchObject({ code: 'consent_required' });
    expect(associations.createWithCurrentConsent).not.toHaveBeenCalled();
  });

  it('fails closed on consent lookup failure and rejects foreign enrollment or implicit association requests', async () => {
    const associations: MonitoringConversationAssociationRepository = { createWithCurrentConsent: vi.fn() };
    const request = { enrollmentId: randomUUID(), monitoringSessionId: randomUUID(), conversationId: randomUUID(), explicitAssociation: true };
    const missing = new AssociateConversationWithMonitoringSession(enrollmentRepository(), associations, consent(), associationScope());
    await expect(missing.execute(accountId, request)).rejects.toMatchObject({ code: 'enrollment_not_found' });
    expect(associations.createWithCurrentConsent).not.toHaveBeenCalled();

    const active = enrollment();
    const brokenConsent = new AssociateConversationWithMonitoringSession(
      enrollmentRepository({ findByIdForOwner: vi.fn(async () => active) }), associations,
      consent({ getCurrentAuthorization: vi.fn(async () => { throw new Error('private consent detail'); }) }),
      associationScope(),
    );
    await expect(brokenConsent.execute(accountId, request)).rejects.toMatchObject({ code: 'consent_unavailable' });
    await expect(brokenConsent.execute(accountId, { ...request, accountId })).rejects.toThrow();
    await expect(brokenConsent.execute(accountId, { ...request, explicitAssociation: false })).rejects.toThrow();
    expect(associations.createWithCurrentConsent).not.toHaveBeenCalled();
  });

  it('blocks an otherwise current grant unless that exact notice version is reviewed for association', async () => {
    const active = enrollment();
    const repository: MonitoringConversationAssociationRepository = { createWithCurrentConsent: vi.fn() };
    const scope = associationScope(false);
    const useCase = new AssociateConversationWithMonitoringSession(
      enrollmentRepository({ findByIdForOwner: vi.fn(async () => active) }), repository, consent(), scope,
    );
    await expect(useCase.execute(accountId, {
      enrollmentId: active.enrollmentId, monitoringSessionId: randomUUID(), conversationId: randomUUID(), explicitAssociation: true,
    })).rejects.toMatchObject({ code: 'conversation_association_not_authorized' });
    expect(scope.isNoticeApprovedForAssociation).toHaveBeenCalledWith(noticeId);
    expect(repository.createWithCurrentConsent).not.toHaveBeenCalled();
    await expect(new DenyUnapprovedMonitoringConversationAssociation().isNoticeApprovedForAssociation(noticeId)).resolves.toBe(false);
  });

  it('requires owner scope before listing sessions and reports monitoring capabilities honestly', async () => {
    const enrollments = enrollmentRepository({ findByIdForOwner: vi.fn(async () => null) });
    const sessions: MonitoringSessionRepository = {
      create: vi.fn(async (value) => value), findByIdForOwner: vi.fn(async () => null),
      createWithCurrentConsent: vi.fn(async (value) => value),
      listByEnrollmentForOwner: vi.fn(async () => []), saveStatusForOwner: vi.fn(async () => true),
    };
    await expect(new ListMyMonitoringSessions(enrollments, sessions).execute(randomUUID(), accountId, 20, 0))
      .rejects.toMatchObject({ code: 'enrollment_not_found' });
    expect(sessions.listByEnrollmentForOwner).not.toHaveBeenCalled();
    expect(new GetMonitoringInfo().execute()).toMatchObject({ automatedCollection: false, measurementsAvailable: false, trendsAvailable: false, clinicalAssessment: false });
  });

  it('rejects invalid, extra, or unbounded HTTP input and documents all routes as protected', () => {
    expect(startMonitoringEnrollmentBodySchema.safeParse({ explicitOptIn: true, accountId }).success).toBe(false);
    expect(startMonitoringEnrollmentBodySchema.safeParse({ explicitOptIn: false }).success).toBe(false);
    expect(monitoringEnrollmentIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(monitoringSessionConversationParamsSchema.safeParse({ id: randomUUID(), sessionId: randomUUID() }).success).toBe(true);
    expect(monitoringSessionConversationParamsSchema.safeParse({ id: randomUUID(), sessionId: 'bad' }).success).toBe(false);
    expect(associateMonitoringConversationBodySchema.safeParse({ conversationId: randomUUID(), explicitAssociation: true }).success).toBe(true);
    expect(associateMonitoringConversationBodySchema.safeParse({ conversationId: randomUUID(), explicitAssociation: true, accountId }).success).toBe(false);
    expect(monitoringPaginationSchema.parse({}).limit).toBe(20);
    expect(monitoringPaginationSchema.safeParse({ limit: '100' }).success).toBe(false);
    expect(monitoringPaginationSchema.safeParse({ limit: '2', unexpected: 'x' }).success).toBe(false);
    expect(Object.keys(openApiDocument.paths).filter((path) => path.startsWith('/api/v1/monitoring/'))).toHaveLength(9);
    const operations = Object.values(monitoringPaths).flatMap((path) => Object.values(path));
    expect(operations).toHaveLength(11);
    for (const operation of operations) expect(operation).toHaveProperty('security', [{ bearerAuth: [] }]);
  });
});
