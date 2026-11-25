import { describe, expect, it } from 'vitest';
import { verify } from 'argon2';
import { PasswordResetService, InvalidPasswordResetCode, PASSWORD_RESET_CODE_TTL_MS } from '../../../src/modules/authentication/application/internal/command-services/password-reset-service.js';
import type { PasswordResetRepository } from '../../../src/modules/authentication/domain/repositories/password-reset-repository.js';

const accountId = '9d5e2cc2-145d-4e52-b3c0-e3e2b02041a5';
const email = 'animoproyecto@gmail.com';
const newPassword = 'nueva-contrasena-segura-1';

interface Row { id: string; accountId: string; codeHash: string; attempts: number; verifiedAt: Date | null; resetTokenHash: string | null; expiresAt: Date; consumedAt: Date | null; createdAt: Date }

function harness() {
  const rows: Row[] = [];
  const sent: { recipient: string; subject: string; bodyText: string }[] = [];
  const state = { now: new Date('2026-11-24T12:00:00.000Z'), passwordHash: 'old-hash', sessionsRevoked: 0 };
  const repository: PasswordResetRepository = {
    async findActiveAccountByEmail(value) { return value === email ? { id: accountId } : null; },
    async findLatestCodeCreatedAt() { const last = rows.at(-1); return last ? last.createdAt : null; },
    async createCode(input) { rows.push({ id: `c${rows.length + 1}`, accountId: input.accountId, codeHash: input.codeHash, attempts: 0, verifiedAt: null, resetTokenHash: null, expiresAt: input.expiresAt, consumedAt: null, createdAt: input.createdAt }); },
    async consumeOpenCodes(id, now) { for (const row of rows) if (row.accountId === id && !row.consumedAt) row.consumedAt = now; },
    async findOpenCode(id, now) {
      const row = rows.filter(r => r.accountId === id && !r.consumedAt && r.expiresAt > now).at(-1);
      return row ? { id: row.id, codeHash: row.codeHash, attempts: row.attempts, verifiedAt: row.verifiedAt } : null;
    },
    async incrementAttempts(codeId) { rows.find(r => r.id === codeId)!.attempts += 1; },
    async markVerified(codeId, tokenHash, now) { const row = rows.find(r => r.id === codeId)!; row.verifiedAt = now; row.resetTokenHash = tokenHash; },
    async findVerifiedCodeByTokenHash(id, tokenHash, now) {
      const row = rows.find(r => r.accountId === id && r.resetTokenHash === tokenHash && r.verifiedAt && !r.consumedAt && r.expiresAt > now);
      return row ? { id: row.id } : null;
    },
    async completePasswordReset({ codeId, passwordHash, now }) {
      const row = rows.find(r => r.id === codeId)!;
      if (row.consumedAt) return false;
      row.consumedAt = now; state.passwordHash = passwordHash; state.sessionsRevoked += 1;
      return true;
    },
  };
  const mailer = { async send(mail: { recipient: string; subject: string; bodyText: string }) { sent.push(mail); return {}; } };
  const service = new PasswordResetService(repository, mailer, () => state.now);
  const codeFromMail = () => /(\d{5})/u.exec(sent.at(-1)!.bodyText)![1]!;
  return { service, rows, sent, state, codeFromMail };
}

describe('password reset', () => {
  it('sends a 5-digit code from the configured mail flow and stores only its hash', async () => {
    const { service, rows, sent, codeFromMail } = harness();
    await service.requestCode({ email });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipient).toBe(email);
    expect(codeFromMail()).toMatch(/^\d{5}$/u);
    expect(rows[0]!.codeHash).not.toContain(codeFromMail());
    expect(await verify(rows[0]!.codeHash, codeFromMail())).toBe(true);
  });

  it('does not send anything for an unknown email and does not reveal it', async () => {
    const { service, sent } = harness();
    await expect(service.requestCode({ email: 'nadie@example.com' })).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it('ignores a second request inside the resend cooldown', async () => {
    const { service, sent } = harness();
    await service.requestCode({ email });
    await service.requestCode({ email });
    expect(sent).toHaveLength(1);
  });

  it('rejects a wrong code, counts the attempt and accepts the right one', async () => {
    const { service, rows, codeFromMail } = harness();
    await service.requestCode({ email });
    const right = codeFromMail();
    const bad = right === '00000' ? '00001' : '00000';
    await expect(service.verifyCode({ email, code: bad })).rejects.toBeInstanceOf(InvalidPasswordResetCode);
    expect(rows[0]!.attempts).toBe(1);
    const { resetToken, expiresIn } = await service.verifyCode({ email, code: right });
    expect(resetToken.length).toBeGreaterThanOrEqual(32);
    expect(expiresIn).toBe(PASSWORD_RESET_CODE_TTL_MS / 1000);
  });

  it('blocks the code after five wrong attempts', async () => {
    const { service, codeFromMail } = harness();
    await service.requestCode({ email });
    const right = codeFromMail();
    const bad = right === '00000' ? '00001' : '00000';
    for (let i = 0; i < 5; i += 1) await expect(service.verifyCode({ email, code: bad })).rejects.toBeInstanceOf(InvalidPasswordResetCode);
    await expect(service.verifyCode({ email, code: right })).rejects.toBeInstanceOf(InvalidPasswordResetCode);
  });

  it('rejects an expired code', async () => {
    const { service, state, codeFromMail } = harness();
    await service.requestCode({ email });
    const code = codeFromMail();
    state.now = new Date(state.now.getTime() + PASSWORD_RESET_CODE_TTL_MS + 1);
    await expect(service.verifyCode({ email, code })).rejects.toBeInstanceOf(InvalidPasswordResetCode);
  });

  it('changes the password with the verified token, once, and revokes sessions', async () => {
    const { service, state, codeFromMail } = harness();
    await service.requestCode({ email });
    const { resetToken } = await service.verifyCode({ email, code: codeFromMail() });
    await service.completePasswordReset({ email, resetToken, newPassword });
    expect(await verify(state.passwordHash, newPassword)).toBe(true);
    expect(state.sessionsRevoked).toBe(1);
    await expect(service.completePasswordReset({ email, resetToken, newPassword: 'otra-contrasena-segura-2' })).rejects.toBeInstanceOf(InvalidPasswordResetCode);
  });

  it('rejects completion with a token that was never issued', async () => {
    const { service, codeFromMail } = harness();
    await service.requestCode({ email });
    await service.verifyCode({ email, code: codeFromMail() });
    await expect(service.completePasswordReset({ email, resetToken: 'x'.repeat(40), newPassword })).rejects.toBeInstanceOf(InvalidPasswordResetCode);
  });
});
