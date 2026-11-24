import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { authAccounts } from '../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { conversations, conversationMessages, conversationalSignalAnalyses } from '../src/modules/conversations/infrastructure/persistence/schema.js';
import { OpenAiRecommendationGenerator } from '../src/modules/recommendations/infrastructure/openai/openai-recommendation-generator.js';
import type { RecommendationGenerator } from '../src/modules/recommendations/application/ports/recommendation-generator.js';
import { RecommendationService } from '../src/modules/recommendations/application/internal/recommendation-service.js';
import { recommendationSetSchema } from '../src/modules/recommendations/domain/model/recommendation-set.js';
import { createConversationalSignalAnalysis } from '../src/modules/conversational-processing/domain/model/conversational-signal-analysis.js';
import type { ConsentPurpose } from '../src/modules/consent/domain/model/consent.js';
import { DrizzleConsentRepository } from '../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { consentNoticeVersions } from '../src/modules/consent/infrastructure/persistence/schema.js';
import { DrizzleRecommendationRepository } from '../src/modules/recommendations/infrastructure/persistence/drizzle-recommendation-repository.js';
import { createRecommendationsRouter } from '../src/modules/recommendations/interfaces/rest/recommendations-routes.js';
import { errorHandler } from '../src/shared/infrastructure/http/error-handler.js';
import { wellbeingRecommendations } from '../src/modules/recommendations/infrastructure/persistence/schema.js';
import { connectTestDatabase } from '../tests/integration/test-database.js';

const requiredFlags = ['--run-synthetic-recommendations-openai-check', '--confirm-synthetic-only'];
const purposes: readonly ConsentPurpose[] = [
  'ai_conversation_processing', 'structured_signal_extraction',
  'conversational_signal_analysis', 'wellbeing_recommendations',
];
const runId = randomUUID();

class SyntheticCheckError extends Error {
  constructor(readonly kind: string) { super('Synthetic manual check stopped'); }
}

function safeKind(error: unknown): string {
  if (error instanceof SyntheticCheckError) return error.kind;
  if (typeof error === 'object' && error !== null && 'errorKind' in error && typeof error.errorKind === 'string') return error.errorKind;
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'OpenAiConfigurationError') return 'openai_configuration_missing';
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'TestDatabaseSafetyError') return 'test_database_not_authorized';
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'RecommendationGenerationError' && 'kind' in error && typeof error.kind === 'string') return error.kind;
  return 'check_failed';
}

async function main(): Promise<void> {
  let phase = 'preflight';
  let dbConnection: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;
  let accountId: string | undefined;
  let server: Server | undefined;
  const syntheticNoticeIds: string[] = [];
  let providerCallCount = 0;
  let providerCallDurationMs: number | null = null;
  let recommendationCount: number | null = null;
  let evidenceLinksValid = false;
  let persistedAndReadable = false;
  let cleanupSucceeded: boolean | null = null;
  let failureKind: string | null = null;

  try {
    if (!requiredFlags.every(flag => process.argv.includes(flag))) throw new SyntheticCheckError('activation_confirmation_required');
    if (!process.env.TEST_DATABASE_URL) throw new SyntheticCheckError('test_database_url_missing');
    // Constructing the adapter validates the OpenAI configuration without making a request.
    const openAiGenerator = new OpenAiRecommendationGenerator();

    phase = 'database_connection_and_identity_check';
    dbConnection = await connectTestDatabase();
    const { db } = dbConnection;

    phase = 'synthetic_account_and_consent_setup';
    const [account] = await db.insert(authAccounts).values({
      email: `recommendations-openai-${runId}@example.test`, passwordHash: 'synthetic-openai-check-only',
    }).returning({ id: authAccounts.id });
      if (!account) throw new SyntheticCheckError('synthetic_account_creation_failed');
    accountId = account.id;

    const now = new Date();
    const currentNoticeIds = new Map<ConsentPurpose, string>();
    for (const purpose of purposes) {
      const [current] = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
        eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'),
        lte(consentNoticeVersions.effectiveAt, now),
      )).limit(1);
      let noticeId = current?.id;
      if (!noticeId) {
        const [otherPublished] = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
          eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'),
        )).limit(1);
        if (otherPublished) throw new Error('consent_notice_not_current');
        const content = `Synthetic-only manual recommendation check notice for ${purpose}; not participant-facing legal text.`;
        const [draft] = await db.insert(consentNoticeVersions).values({
          purpose, version: `synthetic-${runId.slice(0, 12)}`, content,
          contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
          effectiveAt: new Date(now.getTime() - 60_000), status: 'draft',
        }).returning({ id: consentNoticeVersions.id });
        if (!draft) throw new Error('synthetic_notice_creation_failed');
        syntheticNoticeIds.push(draft.id);
        await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, draft.id));
        noticeId = draft.id;
      }
      currentNoticeIds.set(purpose, noticeId);
      const event = await new DrizzleConsentRepository(db).recordDecision(
        account.id, purpose, noticeId, 'granted', randomUUID(), new Date(),
      );
      if (!event) throw new Error('synthetic_consent_grant_failed');
    }

    phase = 'synthetic_source_analysis_setup';
    const [conversation] = await db.insert(conversations).values({
      accountId: account.id, title: 'Synthetic recommendation source',
    }).returning({ id: conversations.id });
    if (!conversation) throw new Error('synthetic_conversation_creation_failed');
    const [message] = await db.insert(conversationMessages).values({
      conversationId: conversation.id, role: 'user', status: 'completed',
      content: 'Mensaje enteramente ficticio: esta semana tengo una evaluación y me preocupa organizar el tiempo para prepararme.',
    }).returning({ id: conversationMessages.id, createdAt: conversationMessages.createdAt });
    if (!message) throw new Error('synthetic_message_creation_failed');

    const anxiety = {
      level: 'low' as const, evidenceCount: 1, indicators: ['worry' as const],
      summary: 'En el mensaje sintético se menciona preocupación por organizar el tiempo.',
      observedPattern: 'single_report' as const,
      evidence: [{ paraphrase: 'Mencionó preocupación por organizar el tiempo para una evaluación ficticia.', messageId: message.id }],
    };
    const insufficient = {
      level: 'insufficient_evidence' as const, evidenceCount: 0, indicators: [],
      summary: 'El fixture no aporta evidencia suficiente para esta dimensión.',
      observedPattern: 'insufficient_evidence' as const, evidence: [],
    };
    const analyzedAt = new Date();
    const analysis = createConversationalSignalAnalysis({
      analysisId: randomUUID(), conversationId: conversation.id, accountId: account.id, analyzedAt,
      period: { start: message.createdAt, end: message.createdAt }, selectedMessageCount: 1,
      analyzedUserMessageCount: 1, excludedNonUserMessageCount: 0, modelVersion: 'synthetic-source-fixture',
      payload: {
        signals: { depression: insufficient, anxiety, stress: insufficient },
        overallSummary: 'Fixture técnico sintético; no corresponde a una persona real.',
      }, allowedUserMessageIds: [message.id],
    });
    const sourceExpiresAt = new Date(analyzedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    const signalNoticeId = currentNoticeIds.get('conversational_signal_analysis');
    if (!signalNoticeId) throw new Error('synthetic_signal_notice_missing');
    await db.insert(conversationalSignalAnalyses).values({
      analysisId: analysis.analysisId, accountId: account.id, conversationId: conversation.id,
      consentNoticeVersionId: signalNoticeId, analysisVersion: analysis.analysisVersion,
      modelVersion: analysis.modelVersion, analyzedAt, periodStart: message.createdAt,
      periodEnd: message.createdAt, expiresAt: sourceExpiresAt, payload: analysis,
    });

    phase = 'isolated_http_composition';
    const jwt = new JwtAccessTokenService(randomBytes(32).toString('hex'), 'synthetic-recommendations-check', 'synthetic-recommendations-client', 900);
    const baseGenerator: RecommendationGenerator = openAiGenerator;
    const oneCallGenerator: RecommendationGenerator = {
      modelVersion: baseGenerator.modelVersion,
      generate: async (input, signal) => {
        providerCallCount += 1;
        if (providerCallCount > 1) throw new Error('provider_call_limit_exceeded');
        const startedAt = Date.now();
        try { return await baseGenerator.generate(input, signal); }
        finally { providerCallDurationMs = Date.now() - startedAt; }
      },
    };
    const service = new RecommendationService(
      new DrizzleRecommendationRepository(db), oneCallGenerator,
      { enabled: true, deployment: 'authorized_pilot', allowedAccountIds: [account.id] },
    );
    const app = express();
    app.use(express.json());
    app.use('/api/v1/me/recommendations', createRecommendationsRouter(jwt, service));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server?.once('listening', resolve);
      server?.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback_http_server_failed');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const accessToken = await jwt.issue(account.id);
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

    phase = 'openai_generation_http';
    const generateResponse = await fetch(`${baseUrl}/api/v1/me/recommendations/generate`, {
      method: 'POST', headers, body: JSON.stringify({ analysisId: analysis.analysisId }),
    });
    if (generateResponse.status !== 201) throw new Error(`generation_http_${generateResponse.status}`);
    const recommendationSet = recommendationSetSchema.parse(await generateResponse.json());
    recommendationCount = recommendationSet.recommendations.length;
    const eligibleDimensions = new Set(['anxiety']);
    evidenceLinksValid = recommendationCount >= 3 && recommendationCount <= 5 &&
      recommendationSet.sourceAnalysisId === analysis.analysisId &&
      recommendationSet.recommendations.every(card => card.kind === 'evidence_based' &&
        card.sourceAnalysisId === analysis.analysisId && card.dimension !== null && eligibleDimensions.has(card.dimension) &&
        card.evidenceReferences.length > 0 && card.evidenceReferences.every(reference =>
          reference.dimension === card.dimension && reference.evidenceIndex === 0 && analysis.signals[reference.dimension].evidence[reference.evidenceIndex] !== undefined));
    if (!evidenceLinksValid || recommendationSet.isDiagnostic || recommendationSet.isClinicalAdvice) throw new Error('recommendation_output_validation_failed');

    phase = 'persisted_http_readback';
    const latestResponse = await fetch(`${baseUrl}/api/v1/me/recommendations/latest`, { headers: { authorization: headers.authorization } });
    if (latestResponse.status !== 200) throw new Error(`latest_http_${latestResponse.status}`);
    const latest = recommendationSetSchema.parse(await latestResponse.json());
    const [persisted] = await db.select({ sourceAnalysisId: wellbeingRecommendations.sourceAnalysisId }).from(wellbeingRecommendations)
      .where(eq(wellbeingRecommendations.recommendationSetId, recommendationSet.recommendationSetId));
    persistedAndReadable = latest.recommendationSetId === recommendationSet.recommendationSetId &&
      latest.sourceAnalysisId === analysis.analysisId && persisted?.sourceAnalysisId === analysis.analysisId;
    if (!persistedAndReadable) throw new Error('persisted_http_readback_mismatch');
  } catch (error) {
    failureKind = safeKind(error);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server?.close(() => resolve()));
    }
    if (dbConnection) {
      try {
        if (accountId) await dbConnection.db.delete(authAccounts).where(eq(authAccounts.id, accountId));
        if (syntheticNoticeIds.length) await dbConnection.db.delete(consentNoticeVersions).where(inArray(consentNoticeVersions.id, syntheticNoticeIds));
        cleanupSucceeded = true;
      } catch {
        cleanupSucceeded = false;
      }
      try { await dbConnection.pool.end(); }
      catch { cleanupSucceeded = false; }
    }
  }

  if (cleanupSucceeded === false && failureKind === null) {
    phase = 'cleanup';
    failureKind = 'cleanup_failed';
  }

  const result = {
    operation: 'synthetic_wellbeing_recommendations_openai_check',
    syntheticRunId: runId,
    status: failureKind === null ? 'completed' : 'failed',
    phase: failureKind === null ? 'complete' : phase,
    errorKind: failureKind,
    database: dbConnection ? 'tesis_test_db' : null,
    bindAddress: server ? '127.0.0.1' : null,
    providerCallCount,
    providerCallDurationMs,
    recommendationCount,
    evidenceLinksValid,
    persistedAndReadable,
    cleanupSucceeded,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (failureKind !== null || cleanupSucceeded === false) process.exitCode = 1;
}

void main().catch(() => {
  process.stdout.write(`${JSON.stringify({ operation: 'synthetic_wellbeing_recommendations_openai_check', status: 'failed', phase: 'preflight', errorKind: 'check_failed' })}\n`);
  process.exitCode = 1;
});
