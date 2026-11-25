import { db } from '../../../../shared/infrastructure/database/client.js';
import { env } from '../../../../config/env.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzlePsychologicalReferralRepository } from '../../infrastructure/persistence/drizzle-psychological-referral-repository.js';
import { ImplicitTlsSmtpReferralMailer } from '../../infrastructure/email/implicit-tls-smtp-referral-mailer.js';
import { PsychologicalReferralService } from '../../application/internal/psychological-referral-service.js';
import { createPsychologicalReferralRouter } from './create-psychological-referral-router.js';
export { createPsychologicalReferralRouter } from './create-psychological-referral-router.js';

function productionService() {
  if (!db) return null;
  const selectedTestRecipient = env.psychologicalReferralTestRecipient;
  let mailer: ImplicitTlsSmtpReferralMailer | null = null;
  try {
    mailer = new ImplicitTlsSmtpReferralMailer({
      host: env.psychologicalReferralSmtpHost,
      port: env.psychologicalReferralSmtpPort,
      username: env.psychologicalReferralSmtpUsername,
      password: env.psychologicalReferralSmtpPassword,
      from: env.psychologicalReferralSmtpFrom,
    });
  } catch (error) {
    console.error('[psychological-referrals] SMTP mailer not created:', error instanceof Error ? error.message : 'unknown error');
    mailer = null;
  }
  return new PsychologicalReferralService(
    new DrizzlePsychologicalReferralRepository(db), mailer,
    { selectedTestRecipient },
  );
}

export const psychologicalReferralRouter = createPsychologicalReferralRouter(JwtAccessTokenService.fromEnvironment(), productionService());
