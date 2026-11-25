import { describe, expect, it, vi } from 'vitest';
import { createPsychologicalReferralRequestSchema } from '../../../src/modules/psychological-referrals/domain/model/psychological-referral.js';
import { sendPsychologicalReferralRequestSchema } from '../../../src/modules/psychological-referrals/interfaces/rest/psychological-referral-controller.js';
import { isPsychologicalReferralAllowed, isSafeReferralTestDatabaseUrl, type PsychologicalReferralPolicy } from '../../../src/modules/psychological-referrals/application/referral-policy.js';
import { ImplicitTlsSmtpReferralMailer } from '../../../src/modules/psychological-referrals/infrastructure/email/implicit-tls-smtp-referral-mailer.js';
import { ReferralMailerError } from '../../../src/modules/psychological-referrals/application/ports/referral-mailer.js';
import { runWithSmtpDeadline } from '../../../src/modules/psychological-referrals/infrastructure/email/implicit-tls-smtp-referral-mailer.js';

const accountId = '9d5e2cc2-145d-4e52-b3c0-e3e2b02041a5';
const policy: PsychologicalReferralPolicy = {
  enabled: true, deployment: 'synthetic_test', allowedAccountIds: [accountId],
  selectedTestRecipient: 'u20181g752@upc.edu.pe', allowedTestRecipients: ['u20181g752@upc.edu.pe'], smtpConfigured: true,
};

describe('psychological referral contracts and safety gate', () => {
  it('accepts only voluntary fields and rejects client-selected recipient or report data', () => {
    expect(createPsychologicalReferralRequestSchema.safeParse({ reason: 'Solicito orientación' }).success).toBe(true);
    expect(createPsychologicalReferralRequestSchema.safeParse({ recipient: 'other@example.com' }).success).toBe(false);
    expect(createPsychologicalReferralRequestSchema.safeParse({ levels: { depression: 'high' } }).success).toBe(false);
    expect(createPsychologicalReferralRequestSchema.safeParse({ reason: 'Contact me at name@example.com' }).success).toBe(false);
  });

  it('requires literal confirmation and a well-formed preview hash', () => {
    expect(sendPsychologicalReferralRequestSchema.safeParse({ confirmed: true, previewHash: 'a'.repeat(64) }).success).toBe(true);
    expect(sendPsychologicalReferralRequestSchema.safeParse({ confirmed: false, previewHash: 'a'.repeat(64) }).success).toBe(false);
    expect(sendPsychologicalReferralRequestSchema.safeParse({ confirmed: true, previewHash: 'a'.repeat(64), recipient: 'x@y.test' }).success).toBe(false);
  });

  it('allows only the explicitly configured synthetic test account and recipient', () => {
    expect(isPsychologicalReferralAllowed(policy, accountId)).toBe(true);
    expect(isPsychologicalReferralAllowed(policy, '077e60f1-d601-49d0-a7c1-ed6df34be125')).toBe(false);
    expect(isPsychologicalReferralAllowed({ ...policy, deployment: 'authorized_pilot' }, accountId)).toBe(false);
    expect(isPsychologicalReferralAllowed({ ...policy, selectedTestRecipient: 'arbitrary@example.com' }, accountId)).toBe(false);
  });

  it('rejects incomplete or non-implicit-TLS SMTP settings without connecting', () => {
    expect(() => new ImplicitTlsSmtpReferralMailer({ port: 25 })).toThrow('Referral SMTP is not securely configured');
    expect(() => new ImplicitTlsSmtpReferralMailer({ host: 'mail.example.test', port: 587, username: 'u', password: 'p', from: 'from@example.test' })).toThrow('Referral SMTP is not securely configured');
  });

  it('enables the composition only with the exact local test database URL', () => {
    expect(isSafeReferralTestDatabaseUrl('postgres://user:pass@127.0.0.1:5432/tesis_test_db')).toBe(true);
    expect(isSafeReferralTestDatabaseUrl('postgres://user:pass@localhost/tesis_test_db')).toBe(true);
    expect(isSafeReferralTestDatabaseUrl('postgres://user:pass@127.0.0.1/tesis_demo_db')).toBe(false);
    expect(isSafeReferralTestDatabaseUrl('postgres://user:pass@example.com/tesis_test_db')).toBe(false);
    expect(isSafeReferralTestDatabaseUrl(undefined)).toBe(false);
  });

  it('keeps safe SMTP failure metadata without exposing raw server text', () => {
    const failure = new ReferralMailerError('unavailable', {
      stage: 'authentication', smtpCode: 535, failureCode: 'smtp_rejected', durationMs: 812,
      acceptanceUncertain: false,
    });
    expect(failure.diagnostics).toEqual({
      stage: 'authentication', smtpCode: 535, failureCode: 'smtp_rejected', durationMs: 812,
      acceptanceUncertain: false,
    });
    expect(failure.message).not.toMatch(/password|secret|response text/i);
  });

  it('bounds a stalled SMTP transaction and marks post-DATA acceptance as uncertain', async () => {
    vi.useFakeTimers();
    try {
      const operation = runWithSmtpDeadline(new Promise<never>(() => undefined), 15_000, () => new ReferralMailerError('delivery_unknown', {
        stage: 'data_acceptance', failureCode: 'timeout', durationMs: 15_000, acceptanceUncertain: true,
      }));
      const assertion = expect(operation).rejects.toMatchObject({
        kind: 'delivery_unknown', diagnostics: { stage: 'data_acceptance', failureCode: 'timeout', acceptanceUncertain: true },
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
