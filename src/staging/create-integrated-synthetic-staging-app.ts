import { Router, type Express } from 'express';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { errorHandler } from '../shared/infrastructure/http/error-handler.js';
import { createCorsMiddleware } from '../shared/infrastructure/http/cors-middleware.js';
import { JwtAccessTokenService } from '../modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { DrizzleSignUpUnitOfWork } from '../modules/authentication/infrastructure/persistence/drizzle-sign-up-unit-of-work.js';
import { DrizzleAuthAccountRepository } from '../modules/authentication/infrastructure/persistence/drizzle-auth-account-repository.js';
import { DrizzleAuthSessionRepository } from '../modules/authentication/infrastructure/persistence/drizzle-auth-session-repository.js';
import { OpaqueRefreshTokenGenerator } from '../modules/authentication/infrastructure/security/opaque-refresh-token-generator.js';
import { SignUp, signUpSchema } from '../modules/authentication/application/internal/command-services/sign-up.js';
import { SignIn, signInSchema } from '../modules/authentication/application/internal/command-services/sign-in.js';
import { RefreshSession } from '../modules/authentication/application/internal/command-services/refresh-session.js';
import { SignOut } from '../modules/authentication/application/internal/command-services/sign-out.js';
import { SignUpController } from '../modules/authentication/interfaces/rest/resources/sign-up-controller.js';
import { SignInController } from '../modules/authentication/interfaces/rest/resources/sign-in-controller.js';
import { RefreshController } from '../modules/authentication/interfaces/rest/resources/refresh-controller.js';
import { SignOutController } from '../modules/authentication/interfaces/rest/resources/sign-out-controller.js';
import { DrizzleConsentRepository } from '../modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { CheckConsentForPurpose } from '../modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import { createConsentRouter } from '../modules/consent/interfaces/rest/create-consent-router.js';
import { DrizzleConversationRepository } from '../modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { createTechnicalStagingConversationsRouter } from '../modules/conversations/interfaces/rest/technical-staging-conversations-router.js';
import { ExtractAuthorizedConversationSignals } from '../modules/conversational-processing/application/internal/command-services/extract-authorized-conversation-signals.js';
import { SyntheticStagingAiAdapters } from '../modules/conversational-processing/infrastructure/synthetic/synthetic-staging-ai-adapters.js';
import { ConversationSignalExtractionController } from '../modules/conversational-processing/interfaces/rest/conversation-signal-extraction-controller.js';
import { authenticationMiddleware } from '../shared/infrastructure/http/authentication-middleware.js';
import { createSyntheticStagingDass21Router } from '../modules/preliminary-assessment/technical-test/create-technical-test-dass21-router.js';
import { DrizzleInstrumentCatalog } from '../modules/preliminary-assessment/infrastructure/persistence/drizzle-instrument-catalog.js';
import { ensureDass21TechnicalTestDraft } from '../modules/preliminary-assessment/technical-test/ensure-dass21-technical-test-draft.js';
import { isStagingLoopbackAddress, validateStagingDatabaseUrl } from '../shared/infrastructure/database/staging-database-safety.js';

const accessTokenTtlSeconds = 900;
const refreshTokenTtlSeconds = 86_400;
const syntheticEmailPattern = /^[a-z0-9][a-z0-9._+-]{0,63}@example\.test$/i;
type StagingDatabase = ConstructorParameters<typeof DrizzleSignUpUnitOfWork>[0];

export async function createIntegratedSyntheticStagingApp(input: {
  database: StagingDatabase;
  pool: Pool;
  jwt: JwtAccessTokenService;
  stagingDatabaseUrl: string;
  corsOrigins: readonly string[];
}): Promise<Express> {
  validateStagingDatabaseUrl(input.stagingDatabaseUrl);
  const identity = await input.database.execute(sql`SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address`);
  const target = identity.rows[0] as { database_name: string; server_address: string | null } | undefined;
  if (target?.database_name !== 'tesis_staging_db' || !isStagingLoopbackAddress(target.server_address)) {
    throw new Error('Integrated synthetic staging requires the authorized local tesis_staging_db');
  }
  // Candidate setup is confined to the explicitly guarded staging database.
  await ensureDass21TechnicalTestDraft(new DrizzleInstrumentCatalog(input.database));
  const providers = new SyntheticStagingAiAdapters();
  const accounts = new DrizzleAuthAccountRepository(input.database);
  const sessions = new DrizzleAuthSessionRepository(input.database);
  const refreshTokens = new OpaqueRefreshTokenGenerator();

  const auth = Router();
  const signUpController = new SignUpController(new SignUp(new DrizzleSignUpUnitOfWork(input.database)));
  const signInController = new SignInController(new SignIn(accounts, sessions, input.jwt, refreshTokens, accessTokenTtlSeconds, refreshTokenTtlSeconds));
  const refreshController = new RefreshController(new RefreshSession(sessions, input.jwt, refreshTokens, accessTokenTtlSeconds, refreshTokenTtlSeconds));
  const signOutController = new SignOutController(new SignOut(sessions, refreshTokens));
  const signUpLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
  const signInLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  const sessionLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

  auth.post('/sign-up', signUpLimiter, (req, res, next) => {
    try {
      const body = signUpSchema.parse(req.body);
      if (!syntheticEmailPattern.test(body.email)) { res.status(400).json({ error: 'Synthetic staging accounts must use the reserved example.test domain' }); return; }
      void signUpController.handle(req, res).catch(next);
    } catch (error) { next(error); }
  });
  auth.post('/sign-in', signInLimiter, (req, res, next) => {
    try {
      const body = signInSchema.parse(req.body);
      if (!syntheticEmailPattern.test(body.email)) { res.status(401).json({ error: 'Invalid email or password' }); return; }
      void signInController.handle(req, res).catch(next);
    } catch (error) { next(error); }
  });
  auth.post('/refresh', sessionLimiter, (req, res, next) => { void refreshController.handle(req, res).catch(next); });
  auth.post('/sign-out', sessionLimiter, (req, res, next) => { void signOutController.handle(req, res).catch(next); });

  const consentRouter = createConsentRouter(input.database, input.jwt);
  const conversationRouter = createTechnicalStagingConversationsRouter({
    database: input.database, pool: input.pool, jwt: input.jwt, generator: providers, contextMessages: 8, outputTokens: 160,
  });
  const extraction = new ExtractAuthorizedConversationSignals(
    new DrizzleConversationRepository(input.database),
    new DrizzleConversationMessageRepository(input.database),
    new CheckConsentForPurpose(new DrizzleConsentRepository(input.database)),
    providers,
  );
  const extractionController = new ConversationSignalExtractionController(extraction);
  const extractionRouter = Router();
  const extractionAuth = authenticationMiddleware(input.jwt);
  extractionRouter.post('/:id/signals/extract', extractionAuth, (req, res, next) => {
    void extractionController.execute(req, res).catch(next);
  });
  extractionRouter.post('/:id/signals/results', extractionAuth, (req, res, next) => {
    void extractionController.generateResult(req, res).catch(next);
  });
  const dass21Router = await createSyntheticStagingDass21Router(input.database, input.jwt, input.stagingDatabaseUrl);

  const app = express();
  app.use(createCorsMiddleware(input.corsOrigins));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', mode: 'synthetic_staging' }));
  app.use('/api/v1/auth', auth);
  app.use('/api/v1/consents', consentRouter);
  app.use('/api/v1/conversations', conversationRouter);
  app.use('/api/v1/conversations', extractionRouter);
  app.use('/api/v1/preliminary-assessments', dass21Router);
  app.use(errorHandler);
  return app;
}

export const integratedSyntheticStagingPolicy = Object.freeze({
  accountEmailDomain: 'example.test',
  provider: 'deterministic_synthetic',
  consentPurposes: ['ai_conversation_processing', 'structured_signal_extraction', 'preliminary_assessment'] as const,
  longitudinalMonitoring: 'not_mounted',
  dass21ApprovalStatus: 'not_approved',
});

export function isSyntheticStagingEmail(value: string): boolean {
  return syntheticEmailPattern.test(value);
}
