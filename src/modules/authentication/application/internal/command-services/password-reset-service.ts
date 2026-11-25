import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from 'argon2';
import { z } from 'zod';
import { normalizeEmail } from '../../../domain/model/auth-account.js';
import type { PasswordResetRepository } from '../../../domain/repositories/password-reset-repository.js';

export const PASSWORD_RESET_CODE_TTL_MS = 10 * 60_000;
export const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60_000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const emailSchema = z.string().trim().email().max(320);
export const requestPasswordResetSchema = z.object({ email: emailSchema }).strict();
export const verifyPasswordResetCodeSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{5}$/u) }).strict();
export const completePasswordResetSchema = z.object({
  email: emailSchema,
  resetToken: z.string().min(32).max(128),
  newPassword: z.string().min(12).max(256),
}).strict();

export class InvalidPasswordResetCode extends Error {}

export interface PasswordResetMail { readonly recipient: string; readonly subject: string; readonly bodyText: string }
export interface PasswordResetMailer { send(email: PasswordResetMail): Promise<unknown> }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export class PasswordResetService {
  constructor(
    private readonly repository: PasswordResetRepository,
    private readonly mailer: PasswordResetMailer | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Always resolves the same way for unknown emails, so the response does not reveal which accounts exist. */
  async requestCode(input: unknown): Promise<void> {
    const { email: rawEmail } = requestPasswordResetSchema.parse(input);
    const email = normalizeEmail(rawEmail);
    const now = this.clock();
    const account = await this.repository.findActiveAccountByEmail(email);
    if (!account) return;
    const latest = await this.repository.findLatestCodeCreatedAt(account.id);
    if (latest && now.getTime() - latest.getTime() < PASSWORD_RESET_RESEND_COOLDOWN_MS) return;

    const code = randomInt(0, 100_000).toString().padStart(5, '0');
    await this.repository.consumeOpenCodes(account.id, now);
    await this.repository.createCode({
      accountId: account.id,
      codeHash: await hash(code, { type: 2 }),
      createdAt: now,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_CODE_TTL_MS),
    });

    if (!this.mailer) {
      console.error('[password-reset] send skipped: SMTP mailer is not configured');
      return;
    }
    try {
      await this.mailer.send({
        recipient: email,
        subject: 'Codigo para restablecer tu contrasena',
        bodyText: `Tu codigo para restablecer la contrasena es: ${code}\n\nVence en 10 minutos. Si no lo solicitaste, ignora este mensaje: tu contrasena no cambiara.`,
      });
    } catch (error) {
      const diagnostics = typeof error === 'object' && error !== null && 'diagnostics' in error
        ? (error as { diagnostics?: object }).diagnostics : undefined;
      console.error('[password-reset] email delivery failed', {
        errorName: error instanceof Error ? error.name : 'unknown', ...(diagnostics ?? {}),
      });
    }
  }

  async verifyCode(input: unknown): Promise<{ resetToken: string; expiresIn: number }> {
    const data = verifyPasswordResetCodeSchema.parse(input);
    const now = this.clock();
    const account = await this.repository.findActiveAccountByEmail(normalizeEmail(data.email));
    if (!account) throw new InvalidPasswordResetCode();
    const code = await this.repository.findOpenCode(account.id, now);
    if (!code || code.verifiedAt || code.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) throw new InvalidPasswordResetCode();
    if (!(await verify(code.codeHash, data.code))) {
      await this.repository.incrementAttempts(code.id);
      throw new InvalidPasswordResetCode();
    }
    const resetToken = randomBytes(32).toString('base64url');
    await this.repository.markVerified(code.id, sha256(resetToken), now);
    return { resetToken, expiresIn: Math.floor(PASSWORD_RESET_CODE_TTL_MS / 1000) };
  }

  async completePasswordReset(input: unknown): Promise<void> {
    const data = completePasswordResetSchema.parse(input);
    const now = this.clock();
    const account = await this.repository.findActiveAccountByEmail(normalizeEmail(data.email));
    if (!account) throw new InvalidPasswordResetCode();
    const code = await this.repository.findVerifiedCodeByTokenHash(account.id, sha256(data.resetToken), now);
    if (!code) throw new InvalidPasswordResetCode();
    const changed = await this.repository.completePasswordReset({
      accountId: account.id, codeId: code.id, passwordHash: await hash(data.newPassword, { type: 2 }), now,
    });
    if (!changed) throw new InvalidPasswordResetCode();
  }
}
