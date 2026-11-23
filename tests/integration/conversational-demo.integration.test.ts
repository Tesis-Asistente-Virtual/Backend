import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, lte } from 'drizzle-orm';
import { connectDemoDatabase } from '../../scripts/demo-database.js';
import { conversationalDemoNotices } from './conversational-demo-notices.js';
import { isConversationalDemoHttpTestEnabled } from './conversational-demo-test-mode.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { SignUp } from '../../src/modules/authentication/application/internal/command-services/sign-up.js';
import { SignIn } from '../../src/modules/authentication/application/internal/command-services/sign-in.js';
import { DrizzleSignUpUnitOfWork } from '../../src/modules/authentication/infrastructure/persistence/drizzle-sign-up-unit-of-work.js';
import { DrizzleAuthAccountRepository } from '../../src/modules/authentication/infrastructure/persistence/drizzle-auth-account-repository.js';
import { DrizzleAuthSessionRepository } from '../../src/modules/authentication/infrastructure/persistence/drizzle-auth-session-repository.js';
import { OpaqueRefreshTokenGenerator } from '../../src/modules/authentication/infrastructure/security/opaque-refresh-token-generator.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { SignUpController } from '../../src/modules/authentication/interfaces/rest/resources/sign-up-controller.js';
import { SignInController } from '../../src/modules/authentication/interfaces/rest/resources/sign-in-controller.js';
import { authenticationMiddleware } from '../../src/shared/infrastructure/http/authentication-middleware.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { consentNoticeVersions, accountConsentEvents } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { CheckConsentForPurpose } from '../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import { ListAvailableConsentNotices } from '../../src/modules/consent/application/internal/query-services/list-available-consent-notices.js';
import { GetMyConsentStatus } from '../../src/modules/consent/application/internal/query-services/get-my-consent-status.js';
import { RecordMyConsentDecision } from '../../src/modules/consent/application/internal/command-services/record-my-consent-decision.js';
import { ConsentController } from '../../src/modules/consent/interfaces/rest/resources/consent-controller.js';
import { conversationMessages } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { CreateConversation } from '../../src/modules/conversations/application/internal/command-services/create-conversation.js';
import { SendConversationMessage } from '../../src/modules/conversations/application/internal/command-services/send-conversation-message.js';
import { GetConversation } from '../../src/modules/conversations/application/internal/query-services/get-conversation.js';
import { ListConversations } from '../../src/modules/conversations/application/internal/query-services/list-conversations.js';
import { ListConversationMessages } from '../../src/modules/conversations/application/internal/query-services/list-conversation-messages.js';
import type { AiTextGenerator } from '../../src/modules/conversations/application/ports/ai-text-generator.js';
import { PostgresConversationTurnLock } from '../../src/modules/conversations/infrastructure/persistence/postgres-conversation-turn-lock.js';
import { ConsentConversationProcessingAuthorizer } from '../../src/modules/conversations/infrastructure/persistence/consent-conversation-processing-authorizer.js';
import { ConversationsController } from '../../src/modules/conversations/interfaces/rest/resources/conversations-controller.js';
import type { ConversationSignalExtractor, ExtractConversationSignalsInput } from '../../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import type { ConversationSignalExtraction } from '../../src/modules/conversational-processing/domain/model/signal-observation.js';
import { ExtractAuthorizedConversationSignals } from '../../src/modules/conversational-processing/application/internal/command-services/extract-authorized-conversation-signals.js';
import { createConversationSignalExtractionRouter } from '../../src/modules/conversational-processing/interfaces/rest/conversation-signal-extraction-routes.js';

const demoHttpTestEnabled = isConversationalDemoHttpTestEnabled();
const demoDescribe = demoHttpTestEnabled ? describe : describe.skip;

demoDescribe('isolated conversational demo HTTP + PostgreSQL', () => {
  let connection: Awaited<ReturnType<typeof connectDemoDatabase>>;
  const createdAccountIds = new Set<string>();
  const requiredNotices = conversationalDemoNotices;

  beforeAll(async () => {
    connection = await connectDemoDatabase();
    const now = new Date();
    for (const fixture of requiredNotices) {
      const [available] = await connection.db.select({ id: consentNoticeVersions.id })
        .from(consentNoticeVersions)
        .where(and(
          eq(consentNoticeVersions.purpose, fixture.purpose),
          eq(consentNoticeVersions.version, fixture.version),
          eq(consentNoticeVersions.status, 'published'),
          lte(consentNoticeVersions.effectiveAt, now),
        )).limit(1);
      if (!available) throw new Error('Demo consent fixtures are not ready; run npm run demo:seed-test-consent first');
    }
  }, 15_000);

  afterEach(async () => {
    const ids = [...createdAccountIds];
    createdAccountIds.clear();
    if (ids.length > 0) await connection.pool.query('DELETE FROM auth_accounts WHERE id = ANY($1::uuid[])', [ids]);
  });

  afterAll(async () => { await connection?.pool.end(); });

  it('demonstrates sign-up, sign-in, consent, owned chat, extraction, and an ephemeral result with fakes only', async () => {
    const jwt = new JwtAccessTokenService('isolated-demo-jwt-secret-at-least-32-bytes', 'demo-test-issuer', 'demo-test-audience', 300);
    const refreshTokens = new OpaqueRefreshTokenGenerator();
    const signUpController = new SignUpController(new SignUp(new DrizzleSignUpUnitOfWork(connection.db)));
    const signInController = new SignInController(new SignIn(
      new DrizzleAuthAccountRepository(connection.db),
      new DrizzleAuthSessionRepository(connection.db),
      jwt,
      refreshTokens,
      300,
      3_600,
    ));

    const consentRepository = new DrizzleConsentRepository(connection.db);
    const consentController = new ConsentController(
      new ListAvailableConsentNotices(consentRepository),
      new GetMyConsentStatus(consentRepository),
      new RecordMyConsentDecision(consentRepository),
    );

    const conversationsRepository = new DrizzleConversationRepository(connection.db);
    const messagesRepository = new DrizzleConversationMessageRepository(connection.db);
    let chatGeneratorCalls = 0;
    const chatGenerator: AiTextGenerator = {
      generateText: async () => {
        chatGeneratorCalls += 1;
        return { text: 'Respuesta sintética del asistente para la demostración local.' };
      },
      streamText: async function* () { yield { type: 'completed', result: { text: 'Respuesta sintética.' } }; },
    };
    const consentChecker = new CheckConsentForPurpose(consentRepository);
    const sendMessage = new SendConversationMessage(
      conversationsRepository,
      messagesRepository,
      chatGenerator,
      new PostgresConversationTurnLock(connection.pool),
      20,
      100,
      new ConsentConversationProcessingAuthorizer(consentChecker),
    );
    const conversationsController = new ConversationsController(
      new CreateConversation(conversationsRepository),
      new ListConversations(conversationsRepository),
      new GetConversation(conversationsRepository),
      new ListConversationMessages(conversationsRepository, messagesRepository),
      sendMessage,
    );

    let extractorCalls = 0;
    const extractor: ConversationSignalExtractor = {
      extract: async (input: ExtractConversationSignalsInput): Promise<ConversationSignalExtraction> => {
        extractorCalls += 1;
        const userMessage = input.messages.find(message => message.role === 'user');
        if (!userMessage) throw new Error('Synthetic demo request did not contain a user message');
        return {
          schemaVersion: '1.0',
          observations: [{
            evidence: 'reported',
            manifestation: { status: 'reported', value: 'Dificultad ficticia para organizar tareas académicas.' },
            possibleDimensions: ['stress'],
            duration: { status: 'not_reported' },
            frequency: { status: 'not_assessed' },
            intensity: { status: 'not_assessed' },
            contexts: [{ domain: 'academic', evidence: { status: 'reported', value: 'Proyecto de clase sintético.' } }],
            functionalImpact: { status: 'not_assessed' },
            sourceMessageIds: [userMessage.messageId],
          }],
          missingInformation: [{ field: 'duration', reason: 'not_reported' }],
          clarificationQuestions: ['¿Desde cuándo ocurre esta dificultad ficticia?'],
        };
      },
    };
    const extractionService = new ExtractAuthorizedConversationSignals(
      conversationsRepository,
      messagesRepository,
      consentChecker,
      extractor,
    );

    const authRouter = Router();
    authRouter.post('/sign-up', (req, res, next) => { void signUpController.handle(req, res).catch(next); });
    authRouter.post('/sign-in', (req, res, next) => { void signInController.handle(req, res).catch(next); });

    const consentRouter = Router();
    consentRouter.get('/notices', (req, res, next) => { void consentController.listNotices(req, res).catch(next); });
    consentRouter.get('/me', authenticationMiddleware(jwt), (req, res, next) => { void consentController.myStatus(req, res).catch(next); });
    consentRouter.post('/me/decisions', authenticationMiddleware(jwt), (req, res, next) => { void consentController.decideForMe(req, res).catch(next); });

    const conversationRouter = Router();
    conversationRouter.post('/', authenticationMiddleware(jwt), (req, res, next) => { void conversationsController.create(req, res).catch(next); });
    conversationRouter.get('/:id/messages', authenticationMiddleware(jwt), (req, res, next) => { void conversationsController.listConversationMessages(req, res).catch(next); });
    conversationRouter.post('/:id/messages', authenticationMiddleware(jwt), (req, res, next) => { void conversationsController.sendConversationMessage(req, res).catch(next); });

    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/consents', consentRouter);
    app.use('/api/v1/conversations', conversationRouter);
    app.use('/api/v1/conversations', createConversationSignalExtractionRouter(extractionService, jwt));
    app.use(errorHandler);

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Demo HTTP server did not bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown, token?: string) => fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

    try {
      const noticesResponse = await fetch(`${baseUrl}/api/v1/consents/notices`);
      expect(noticesResponse.status).toBe(200);
      const notices = await noticesResponse.json() as Array<{ id: string; purpose: string; version: string; content: string }>;
      for (const fixture of requiredNotices) {
        const notice = notices.find(item => item.purpose === fixture.purpose && item.version === fixture.version);
        expect(notice).toBeDefined();
        expect(notice?.content).toContain('SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS.');
      }

      const email = `demo-${randomUUID()}@example.test`;
      const password = 'Synthetic-Demo-Password-2026!';
      const signUpResponse = await post('/api/v1/auth/sign-up', { email, password });
      expect(signUpResponse.status).toBe(201);
      const account = await signUpResponse.json() as { id: string };
      createdAccountIds.add(account.id);

      const signInResponse = await post('/api/v1/auth/sign-in', { email, password });
      expect(signInResponse.status).toBe(200);
      const session = await signInResponse.json() as { accessToken: string; tokenType: string };
      expect(session.tokenType).toBe('Bearer');
      const token = session.accessToken;

      for (const fixture of requiredNotices) {
        const notice = notices.find(item => item.purpose === fixture.purpose && item.version === fixture.version)!;
        const decision = await post('/api/v1/consents/me/decisions', {
          purpose: fixture.purpose,
          noticeVersionId: notice.id,
          action: 'granted',
          idempotencyKey: randomUUID(),
        }, token);
        expect(decision.status).toBe(201);
      }

      const statusResponse = await fetch(`${baseUrl}/api/v1/consents/me`, { headers: { authorization: `Bearer ${token}` } });
      expect(statusResponse.status).toBe(200);
      const status = await statusResponse.json() as { items: Array<{ purpose: string; state: string }> };
      for (const fixture of requiredNotices) {
        expect(status.items.find(item => item.purpose === fixture.purpose)?.state).toBe('granted');
      }

      const conversationResponse = await post('/api/v1/conversations', { title: 'Conversación sintética 4C.3' }, token);
      expect(conversationResponse.status).toBe(201);
      const conversation = await conversationResponse.json() as { id: string };

      const turnResponse = await post(`/api/v1/conversations/${conversation.id}/messages`, {
        content: 'Estoy organizando un proyecto ficticio de clase y me cuesta ordenar sus tareas.',
      }, token);
      expect(turnResponse.status).toBe(201);
      expect(chatGeneratorCalls).toBe(1);
      const turn = await turnResponse.json() as { userMessage: { id: string }; assistantMessage: { id: string; status: string } };
      expect(turn.assistantMessage.status).toBe('completed');

      const messagesResponse = await fetch(`${baseUrl}/api/v1/conversations/${conversation.id}/messages?limit=20&offset=0`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(messagesResponse.status).toBe(200);
      const messagePage = await messagesResponse.json() as { items: Array<{ id: string; role: string; status: string }> };
      const selectedUser = messagePage.items.find(message => message.id === turn.userMessage.id && message.role === 'user' && message.status === 'completed');
      expect(selectedUser).toBeDefined();
      const sourceMessageIds = [selectedUser!.id];

      const messagesBeforeAnalysis = await connection.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
      const eventsBeforeAnalysis = await connection.db.select().from(accountConsentEvents).where(eq(accountConsentEvents.accountId, account.id));

      const extractionResponse = await post(`/api/v1/conversations/${conversation.id}/signals/extract`, { messageIds: sourceMessageIds }, token);
      expect(extractionResponse.status).toBe(200);
      const extraction = await extractionResponse.json() as { status: string; schemaVersion: string; observations: unknown[] };
      expect(extraction).toMatchObject({ status: 'completed', schemaVersion: '1.0' });
      expect(extraction.observations).toHaveLength(1);

      const resultResponse = await post(`/api/v1/conversations/${conversation.id}/signals/results`, { messageIds: sourceMessageIds }, token);
      expect(resultResponse.status).toBe(200);
      const result = await resultResponse.json() as {
        status: string; id: string; conversationId: string; accountId?: string;
        extractorVersion: string; sourceMessageIds: string[];
        summary: { descriptiveStatus: string; reportedFacts: unknown[]; emptyObservationsMeaning: string; interpretationLimits: string[] };
        missingInformation: unknown[];
      };
      expect(result).toMatchObject({
        status: 'completed', conversationId: conversation.id, extractorVersion: '1.0.0', sourceMessageIds,
        summary: { descriptiveStatus: 'observations_available', emptyObservationsMeaning: 'not_evidence_of_absence' },
      });
      expect(result.summary.reportedFacts.length).toBeGreaterThan(0);
      expect(result.missingInformation).toHaveLength(1);
      expect(result).not.toHaveProperty('accountId');
      expect(extractorCalls).toBe(2);

      const messagesAfterAnalysis = await connection.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
      const eventsAfterAnalysis = await connection.db.select().from(accountConsentEvents).where(eq(accountConsentEvents.accountId, account.id));
      expect(messagesAfterAnalysis).toHaveLength(messagesBeforeAnalysis.length);
      expect(eventsAfterAnalysis).toHaveLength(eventsBeforeAnalysis.length);

      const otherEmail = `demo-other-${randomUUID()}@example.test`;
      const otherSignup = await post('/api/v1/auth/sign-up', { email: otherEmail, password });
      expect(otherSignup.status).toBe(201);
      const otherAccount = await otherSignup.json() as { id: string };
      createdAccountIds.add(otherAccount.id);
      const otherSignin = await post('/api/v1/auth/sign-in', { email: otherEmail, password });
      expect(otherSignin.status).toBe(200);
      const otherSession = await otherSignin.json() as { accessToken: string };
      const foreignResult = await post(`/api/v1/conversations/${conversation.id}/signals/results`, { messageIds: sourceMessageIds }, otherSession.accessToken);
      expect(foreignResult.status).toBe(404);
      const otherConversationResponse = await post('/api/v1/conversations', { title: 'Cuenta sintética sin consentimiento' }, otherSession.accessToken);
      expect(otherConversationResponse.status).toBe(201);
      const otherConversation = await otherConversationResponse.json() as { id: string };
      const missingConsentResult = await post(`/api/v1/conversations/${otherConversation.id}/signals/results`, { messageIds: [randomUUID()] }, otherSession.accessToken);
      expect(missingConsentResult.status).toBe(403);
      expect(extractorCalls).toBe(2);

      console.info('Synthetic conversational demo passed:', JSON.stringify({
        auth: 'signed_up_and_signed_in',
        consentPurposes: requiredNotices.map(item => item.purpose),
        conversationMessages: messagesAfterAnalysis.length,
        extractionObservations: extraction.observations.length,
        resultStatus: result.summary.descriptiveStatus,
        missingInformation: result.missingInformation.length,
        resultPersisted: false,
        extractorCalls: extractorCalls,
        provider: 'simulated',
      }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 30_000);
});
