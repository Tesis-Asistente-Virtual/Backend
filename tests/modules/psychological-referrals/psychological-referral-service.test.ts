import { describe, expect, it } from 'vitest';
import { PsychologicalReferralService } from '../../../src/modules/psychological-referrals/application/internal/psychological-referral-service.js';
import type { PsychologicalReferralPolicy } from '../../../src/modules/psychological-referrals/application/referral-policy.js';
import type { PsychologicalReferralRepository, ReferralRecord } from '../../../src/modules/psychological-referrals/application/ports/referral-repository.js';
import { ReferralMailerError, type ReferralMailer } from '../../../src/modules/psychological-referrals/application/ports/referral-mailer.js';
import { ReferralConfirmationInvalid, ReferralFeatureUnavailable, ReferralStateConflict } from '../../../src/modules/psychological-referrals/application/referral-errors.js';
import { ReferralDeliveryUnavailable } from '../../../src/modules/psychological-referrals/application/referral-errors.js';
import { createReferralReport } from '../../../src/modules/psychological-referrals/domain/model/psychological-referral.js';

const accountId = '9d5e2cc2-145d-4e52-b3c0-e3e2b02041a5';
const referralId = 'e3b90ad0-21ed-4fcf-80b0-47c89f5cf070';
const createKey = 'b0107f08-6bbd-47d4-94f2-88ad422e6b23';
const sendKey = '2f3f9221-ed68-4c1f-9044-901e96d63eef';
const time = new Date('2026-11-24T12:00:00.000Z');
const policy: PsychologicalReferralPolicy = {
  enabled: true, deployment: 'synthetic_test', allowedAccountIds: [accountId],
  selectedTestRecipient: 'u20181g752@upc.edu.pe',
  allowedTestRecipients: ['u20181g752@upc.edu.pe', 'pieroms25@gmail.com'], smtpConfigured: true,
};

function harness(customMailer?: ReferralMailer) {
  let record: ReferralRecord | null = null;
  let sentCount = 0;
  const repository: PsychologicalReferralRepository = {
    async createDraft(input) {
      if (record) return { created: false, record };
      const report = input.report(null);
      record = {
        referralId, accountId, recipient: input.recipient, previewHash: input.previewHash(null), report,
        status: 'draft', createdAt: time, sentAt: null, deliveryReference: null, sendIdempotencyKey: null,
      };
      return { created: true, record };
    },
    async getForOwner({ accountId: owner, referralId: id }) { return owner === accountId && id === referralId ? record : null; },
    async reserveSend(input) {
      if (!record || input.accountId !== accountId || input.referralId !== referralId) return null;
      if (record.status === 'sent' && record.sendIdempotencyKey === input.idempotencyKey && record.previewHash === input.previewHash) return { kind: 'already_sent', record };
      if (record.status !== 'draft') throw new ReferralStateConflict();
      if (record.previewHash !== input.previewHash) throw new ReferralConfirmationInvalid();
      record = { ...record, status: 'sending', sendIdempotencyKey: input.idempotencyKey };
      return { kind: 'reserved', record, attemptId: input.attemptId };
    },
    async markSent(input) {
      if (!record || record.status !== 'sending') throw new ReferralStateConflict();
      record = { ...record, status: 'sent', sentAt: input.now, deliveryReference: input.messageId };
    },
    async markDeliveryFailed(input) {
      if (record) record = { ...record, status: input.outcome };
    },
    async cancelDraft() {
      if (!record || record.status !== 'draft') return false;
      record = { ...record, status: 'cancelled', report: null, previewHash: null };
      return true;
    },
  };
  const mailer: ReferralMailer = customMailer ?? { async send() { sentCount += 1; return { messageId: '<synthetic@unit.test>' }; } };
  const service = new PsychologicalReferralService(repository, mailer, policy, () => time, () => referralId);
  return { service, getRecord: () => record, sentCount: () => sentCount };
}

describe('PsychologicalReferralService', () => {
  it('creates a voluntary no-analysis draft with explicit absence and exact test recipient', async () => {
    const { service } = harness();
    const result = await service.create(accountId, {}, createKey);
    expect(result.created).toBe(true);
    expect(result.preview).toMatchObject({ status: 'draft', recipient: policy.selectedTestRecipient, report: {
      findingsAvailability: 'no_analysis_attached', absenceOfFindings: true, signals: null, isDiagnostic: false,
    } });
  });

  it('requires the exact preview hash and an explicit confirmation before one mail send', async () => {
    const { service, sentCount } = harness();
    const draft = await service.create(accountId, { reason: 'Quiero conversar con alguien' }, createKey);
    const common = { referralId, idempotencyKey: sendKey, confirmed: true as const };
    await expect(service.send(accountId, { ...common, previewHash: '0'.repeat(64) })).rejects.toBeInstanceOf(ReferralConfirmationInvalid);
    expect(sentCount()).toBe(0);
    const sent = await service.send(accountId, { ...common, previewHash: draft.preview.previewHash as string });
    expect(sent.preview.status).toBe('sent');
    expect(sent.duplicate).toBe(false);
    expect(sentCount()).toBe(1);
    const duplicate = await service.send(accountId, { ...common, previewHash: draft.preview.previewHash as string });
    expect(duplicate.duplicate).toBe(true);
    expect(sentCount()).toBe(1);
  });

  it('cancels a draft and removes its report from subsequent views', async () => {
    const { service, getRecord } = harness();
    await service.create(accountId, {}, createKey);
    await service.cancel(accountId, referralId);
    expect(getRecord()?.report).toBeNull();
    await expect(service.get(accountId, referralId)).resolves.toMatchObject({ status: 'cancelled', report: null, recipient: null });
  });

  it('marks an uncertain SMTP result and never retries automatically', async () => {
    const unavailableMailer: ReferralMailer = { async send() { throw new ReferralMailerError('delivery_unknown'); } };
    const h = harness(unavailableMailer);
    const draft = await h.service.create(accountId, {}, createKey);
    await expect(h.service.send(accountId, {
      referralId, previewHash: draft.preview.previewHash as string, idempotencyKey: sendKey, confirmed: true,
    })).rejects.toBeInstanceOf(ReferralDeliveryUnavailable);
  });

  it('fails closed for disabled policy and for a different account', async () => {
    const { service } = harness();
    const disabled = new PsychologicalReferralService({} as PsychologicalReferralRepository, null, { ...policy, enabled: false });
    await expect(disabled.create(accountId, {}, createKey)).rejects.toBeInstanceOf(ReferralFeatureUnavailable);
    await expect(service.create('077e60f1-d601-49d0-a7c1-ed6df34be125', {}, createKey)).rejects.toBeInstanceOf(ReferralFeatureUnavailable);
  });
});

describe('referral report boundaries', () => {
  it('does not add chat text or clinical fields to a no-analysis report', () => {
    const report = createReferralReport({ referralId, createdAt: time, reason: null, source: null });
    expect(report).toMatchObject({ signals: null, absenceOfFindings: true, isDiagnostic: false });
    expect(Object.keys(report)).not.toContain('rawScore');
    expect(Object.keys(report)).not.toContain('equivalentScore');
    expect(report.limitations).toContain('not_a_diagnosis_or_clinical_assessment');
  });
});

