import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { db } from '../../../../shared/infrastructure/database/client.js';
import { env } from '../../../../config/env.js';
import { ImplicitTlsSmtpReferralMailer } from '../../../psychological-referrals/infrastructure/email/implicit-tls-smtp-referral-mailer.js';
import { DrizzlePasswordResetRepository } from '../../infrastructure/persistence/drizzle-password-reset-repository.js';
import { InvalidPasswordResetCode, PasswordResetService, type PasswordResetMailer } from '../../application/internal/command-services/password-reset-service.js';

function createMailer(): PasswordResetMailer | null {
  try {
    return new ImplicitTlsSmtpReferralMailer({
      host: env.psychologicalReferralSmtpHost,
      port: env.psychologicalReferralSmtpPort,
      username: env.psychologicalReferralSmtpUsername,
      password: env.psychologicalReferralSmtpPassword,
      from: env.psychologicalReferralSmtpFrom,
    });
  } catch (error) {
    console.error('[password-reset] SMTP mailer not created:', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

const limiter = (limit: number) => rateLimit({
  windowMs: 10 * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts' },
});

function handle(action: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    action(req, res).catch(error => {
      if (error instanceof InvalidPasswordResetCode) { res.status(400).json({ error: 'Invalid or expired code' }); return; }
      next(error);
    });
  };
}

const router = Router();
if (db) {
  const service = new PasswordResetService(new DrizzlePasswordResetRepository(db), createMailer());
  router.post('/password-reset/request', limiter(5), handle(async (req, res) => {
    await service.requestCode(req.body);
    res.status(202).json({ message: 'Si el correo esta registrado, enviamos un codigo.' });
  }));
  router.post('/password-reset/verify', limiter(10), handle(async (req, res) => {
    res.status(200).json(await service.verifyCode(req.body));
  }));
  router.post('/password-reset/complete', limiter(10), handle(async (req, res) => {
    await service.completePasswordReset(req.body);
    res.status(200).json({ status: 'password_changed' });
  }));
} else {
  router.use('/password-reset', (_req, _res, next) => next(new Error('Database is not configured')));
}

export const passwordResetRouter = router;
