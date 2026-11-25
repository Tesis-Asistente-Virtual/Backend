import { db } from '../../../../shared/infrastructure/database/client.js';
import { env } from '../../../../config/env.js';
import { JwtAccessTokenService } from '../../../authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzlePsychologicalReferralRepository } from '../../infrastructure/persistence/drizzle-psychological-referral-repository.js';
import { ImplicitTlsSmtpReferralMailer } from '../../infrastructure/email/implicit-tls-smtp-referral-mailer.js';
import { PsychologicalReferralService } from '../../application/internal/psychological-referral-service.js';
import { isSafeReferralTestDatabaseUrl } from '../../application/referral-policy.js';
import { createPsychologicalReferralRouter } from './create-psychological-referral-router.js';
export { createPsychologicalReferralRouter } from './create-psychological-referral-router.js';

function productionService() {
  if (!db) return null;
  const selectedTestRecipient = env.psychologicalReferralTestRecipient;
  const allowedTestRecipients = env.psychologicalReferralTestRecipients;
  const enabled = env.psychologicalReferralsEnabled && process.env.NODE_ENV !== 'production' &&
    env.psychologicalReferralsDeployment === 'synthetic_test' &&
    isSafeReferralTestDatabaseUrl(env.databaseUrl) &&
    env.psychologicalReferralsAllowedAccountIds.length > 0 && Boolean(selectedTestRecipient) &&
    allowedTestRecipients.includes(selectedTestRecipient ?? '');
  let mailer: ImplicitTlsSmtpReferralMailer | null = null;
  if (enabled) {
    try {
      mailer = new ImplicitTlsSmtpReferralMailer({
        host: env.psychologicalReferralSmtpHost,
        port: env.psychologicalReferralSmtpPort,
        username: env.psychologicalReferralSmtpUsername,
        password: env.psychologicalReferralSmtpPassword,
        from: env.psychologicalReferralSmtpFrom,
      });
    } catch {
      mailer = null;
    }
  }
  return new PsychologicalReferralService(
    new DrizzlePsychologicalReferralRepository(db), mailer,
    {
      enabled: enabled && mailer !== null,
      deployment: env.psychologicalReferralsDeployment,
      allowedAccountIds: env.psychologicalReferralsAllowedAccountIds,
      selectedTestRecipient,
      allowedTestRecipients,
      smtpConfigured: mailer !== null,
    },
  );
}

export const psychologicalReferralRouter = createPsychologicalReferralRouter(JwtAccessTokenService.fromEnvironment(), productionService());
