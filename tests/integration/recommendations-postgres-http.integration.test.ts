import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { inArray, eq } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { conversations, conversationMessages, conversationalSignalAnalyses } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import type { RecommendationGenerator } from '../../src/modules/recommendations/application/ports/recommendation-generator.js';
import { DrizzleRecommendationRepository } from '../../src/modules/recommendations/infrastructure/persistence/drizzle-recommendation-repository.js';
import { wellbeingRecommendations } from '../../src/modules/recommendations/infrastructure/persistence/schema.js';
import { RecommendationService } from '../../src/modules/recommendations/application/internal/recommendation-service.js';
import { recommendationSetSchema } from '../../src/modules/recommendations/domain/model/recommendation-set.js';
import { createRecommendationsRouter } from '../../src/modules/recommendations/interfaces/rest/recommendations-routes.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { createConversationalSignalAnalysis } from '../../src/modules/conversational-processing/domain/model/conversational-signal-analysis.js';
import { connectTestDatabase } from './test-database.js';
import { ensureTestPublishedNotice, grantTestConsent } from './consent-test-fixtures.js';

const runId = randomUUID();
const enabled = process.env.TEST_DATABASE_URL !== undefined;
const jwt = new JwtAccessTokenService('synthetic-recommendations-integration-secret', 'recommendations-it', 'recommendations-it-client', 3600);
const purposes = ['ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations'] as const;
const accounts = new Set<string>();
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];

function generatorDouble() {
  const generate = vi.fn(async () => ({ recommendations: [1, 2, 3].map(index => ({
    title: `Paso sintético ${index}`,
    description: 'Considera dividir una actividad en un paso pequeño y manejable.',
    dimension: 'anxiety' as const,
    evidenceReferences: ['anxiety:0'],
  })) }));
  const generator: RecommendationGenerator = { modelVersion: 'synthetic-recommendation-model', generate };
  return { generator, generate };
}

function createHttpApp(accountAllowlist: readonly string[], generator: RecommendationGenerator, featureEnabled = true): Express {
  const app = express();
  app.use(express.json());
  const service = new RecommendationService(
    new DrizzleRecommendationRepository(db), generator,
    { enabled: featureEnabled, deployment: 'authorized_pilot', allowedAccountIds: accountAllowlist },
  );
  app.use('/api/v1/me/recommendations', createRecommendationsRouter(jwt, service));
  app.use(errorHandler);
  return app;
}

async function withHttp<T>(app: Express, action: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP integration server did not bind to loopback');
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl: string, token: string, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createAccount(): Promise<{ id: string; token: string }> {
  const email = `recommendations-it-${runId}-${randomUUID()}@example.test`;
  const [account] = await db.insert(authAccounts).values({ email, passwordHash: 'synthetic-integration-hash' }).returning({ id: authAccounts.id });
  if (!account) throw new Error('Synthetic integration account insert returned no id');
  accounts.add(account.id);
  return { id: account.id, token: await jwt.issue(account.id) };
}

async function grantAllPurposes(accountId: string): Promise<{ signalNoticeId: string }> {
  let signalNoticeId = '';
  for (const purpose of purposes) {
    const notice = await ensureTestPublishedNotice(db, purpose);
    if (purpose === 'conversational_signal_analysis') signalNoticeId = notice.id;
    await grantTestConsent(db, accountId, purpose);
  }
  if (!signalNoticeId) throw new Error('Synthetic signal-analysis notice was not prepared');
  return { signalNoticeId };
}

async function createPersistedAnalysis(accountId: string, consentNoticeVersionId: string, expired = false): Promise<string> {
  const now = new Date();
  const analyzedAt = expired ? new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000) : new Date(now.getTime() - 60_000);
  const expiresAt = new Date(analyzedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
  const [conversation] = await db.insert(conversations).values({ accountId, title: 'Synthetic recommendations fixture' }).returning({ id: conversations.id });
  if (!conversation) throw new Error('Synthetic conversation insert returned no id');
  const [message] = await db.insert(conversationMessages).values({
    conversationId: conversation.id, role: 'user', status: 'completed', content: 'Synthetic student message about an upcoming assignment.',
  }).returning({ id: conversationMessages.id, createdAt: conversationMessages.createdAt });
  if (!message) throw new Error('Synthetic message insert returned no id');

  const available = {
    level: 'low' as const, evidenceCount: 1, indicators: ['worry' as const],
    summary: 'Preocupación mencionada en un mensaje sintético.', observedPattern: 'single_report' as const,
    evidence: [{ paraphrase: 'Mencionó preocupación por una tarea ficticia.', messageId: message.id }],
  };
  const insufficient = {
    level: 'insufficient_evidence' as const, evidenceCount: 0, indicators: [] as const,
    summary: 'No se observó evidencia suficiente en el material sintético seleccionado.',
    observedPattern: 'insufficient_evidence' as const, evidence: [] as const,
  };
  const analysis = createConversationalSignalAnalysis({
    analysisId: randomUUID(), conversationId: conversation.id, accountId, analyzedAt,
    period: { start: message.createdAt, end: message.createdAt }, selectedMessageCount: 1,
    analyzedUserMessageCount: 1, excludedNonUserMessageCount: 0, modelVersion: 'synthetic-analysis-model',
    payload: {
      signals: { depression: insufficient, anxiety: available, stress: insufficient },
      overallSummary: 'Análisis de fixture sintético; no representa a una persona real.',
    },
    allowedUserMessageIds: [message.id],
  });
  await db.insert(conversationalSignalAnalyses).values({
    analysisId: analysis.analysisId, accountId, conversationId: conversation.id,
    consentNoticeVersionId, analysisVersion: analysis.analysisVersion, modelVersion: analysis.modelVersion,
    analyzedAt, periodStart: message.createdAt, periodEnd: message.createdAt, expiresAt, payload: analysis,
  });
  return analysis.analysisId;
}

async function seedExpiredRecommendation(accountId: string, analysisId: string, consentNoticeVersionId: string): Promise<void> {
  const [source] = await db.select({ analyzedAt: conversationalSignalAnalyses.analyzedAt, expiresAt: conversationalSignalAnalyses.expiresAt })
    .from(conversationalSignalAnalyses).where(eq(conversationalSignalAnalyses.analysisId, analysisId));
  if (!source) throw new Error('Synthetic source analysis was not persisted');
  const recommendationSetId = randomUUID();
  const generatedAt = new Date(source.analyzedAt.getTime() + 60_000);
  const payload = recommendationSetSchema.parse({
    contractVersion: 'wellbeing-recommendations-1.0', recommendationSetId, status: 'available',
    sourceAnalysisId: analysisId, generatedAt: generatedAt.toISOString(), expiresAt: source.expiresAt.toISOString(),
    recommendations: [1, 2, 3].map(index => ({
      id: randomUUID(), kind: 'general', title: `Sugerencia expirada ${index}`,
      description: 'Fixture sintético sin personalización.', dimension: null,
      justification: 'Fixture sintético de integración.', sourceAnalysisId: analysisId, evidenceReferences: [],
    })),
    professionalSupportNotice: null, isDiagnostic: false, isClinicalAdvice: false,
    limitations: [
      'exploratory_conversational_evidence_only', 'not_a_diagnosis_or_clinical_assessment',
      'not_a_crisis_detector', 'not_a_substitute_for_professional_care', 'generated_from_persisted_analysis_not_messages',
    ],
  });
  await db.insert(wellbeingRecommendations).values({
    recommendationSetId, accountId, sourceAnalysisId: analysisId, consentNoticeVersionId,
    status: 'available', generationToken: randomUUID(), leaseExpiresAt: source.expiresAt,
    generatedAt, expiresAt: source.expiresAt, payload, createdAt: source.analyzedAt, updatedAt: generatedAt,
  });
}

beforeAll(async () => { if (enabled) ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (!db || accounts.size === 0) return;
  await db.delete(authAccounts).where(inArray(authAccounts.id, [...accounts]));
  accounts.clear();
});
afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!enabled)('Recommendations PostgreSQL + HTTP integration', () => {
  it('generates once, persists the source link, serves latest, and never crosses owners', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const { signalNoticeId } = await grantAllPurposes(owner.id);
    await grantAllPurposes(other.id);
    const analysisId = await createPersistedAnalysis(owner.id, signalNoticeId);
    const { generator, generate } = generatorDouble();
    const app = createHttpApp([owner.id, other.id], generator);

    await withHttp(app, async baseUrl => {
      const first = await request(baseUrl, owner.token, '/api/v1/me/recommendations/generate', 'POST', { analysisId });
      expect(first.status).toBe(201);
      const firstBody = await first.json() as { recommendationSetId: string; sourceAnalysisId: string; recommendations: unknown[] };
      expect(firstBody.sourceAnalysisId).toBe(analysisId);
      expect(firstBody.recommendations).toHaveLength(3);

      const repeated = await request(baseUrl, owner.token, '/api/v1/me/recommendations/generate', 'POST', { analysisId });
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual(firstBody);
      expect(generate).toHaveBeenCalledOnce();

      const latest = await request(baseUrl, owner.token, '/api/v1/me/recommendations/latest');
      expect(latest.status).toBe(200);
      expect(await latest.json()).toEqual(firstBody);

      const otherLatest = await request(baseUrl, other.token, '/api/v1/me/recommendations/latest');
      expect(otherLatest.status).toBe(200);
      expect(await otherLatest.json()).toMatchObject({ status: 'not_available' });
      const crossOwner = await request(baseUrl, other.token, '/api/v1/me/recommendations/generate', 'POST', { analysisId });
      expect(crossOwner.status).toBe(404);

      const rows = await db.select().from(wellbeingRecommendations).where(eq(wellbeingRecommendations.sourceAnalysisId, analysisId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ accountId: owner.id, sourceAnalysisId: analysisId, status: 'available' });
      expect(rows[0]?.recommendationSetId).toBe(firstBody.recommendationSetId);
    });
  });

  it('denies generation without current consent before calling the generator', async () => {
    const owner = await createAccount();
    const { generator, generate } = generatorDouble();
    const app = createHttpApp([owner.id], generator);
    await withHttp(app, async baseUrl => {
      const response = await request(baseUrl, owner.token, '/api/v1/me/recommendations/generate', 'POST', {});
      expect(response.status).toBe(403);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  it('rejects an expired source analysis and does not expose it from latest', async () => {
    const owner = await createAccount();
    const { signalNoticeId } = await grantAllPurposes(owner.id);
    const analysisId = await createPersistedAnalysis(owner.id, signalNoticeId, true);
    await seedExpiredRecommendation(owner.id, analysisId, signalNoticeId);
    const { generator, generate } = generatorDouble();
    const app = createHttpApp([owner.id], generator);
    await withHttp(app, async baseUrl => {
      const latest = await request(baseUrl, owner.token, '/api/v1/me/recommendations/latest');
      expect(latest.status).toBe(200);
      expect(await latest.json()).toMatchObject({ status: 'not_available' });
      expect(await db.select().from(wellbeingRecommendations).where(eq(wellbeingRecommendations.sourceAnalysisId, analysisId))).toHaveLength(0);

      const generated = await request(baseUrl, owner.token, '/api/v1/me/recommendations/generate', 'POST', { analysisId });
      expect(generated.status).toBe(404);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  it('blocks both endpoints when the server-side feature policy is disabled', async () => {
    const owner = await createAccount();
    const { generator, generate } = generatorDouble();
    const app = createHttpApp([owner.id], generator, false);
    await withHttp(app, async baseUrl => {
      const post = await request(baseUrl, owner.token, '/api/v1/me/recommendations/generate', 'POST', {});
      const get = await request(baseUrl, owner.token, '/api/v1/me/recommendations/latest');
      expect(post.status).toBe(503);
      expect(get.status).toBe(503);
      expect(generate).not.toHaveBeenCalled();
    });
  });
});
