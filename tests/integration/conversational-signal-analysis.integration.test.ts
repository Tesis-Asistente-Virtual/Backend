import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, lte } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { accountConsentEvents, consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { CheckConsentForPurpose } from '../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import type { ConsentPurpose } from '../../src/modules/consent/domain/model/consent.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { conversations, conversationMessages, conversationalSignalAnalyses } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationMessageRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { DrizzleConversationRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import type { ConversationalSignalAnalyzer } from '../../src/modules/conversational-processing/application/ports/conversational-signal-analyzer.js';
import {
  AnalyzeAuthorizedConversationSignals,
  GetMyConversationalSignalAnalysis,
} from '../../src/modules/conversational-processing/application/internal/command-services/analyze-authorized-conversation-signals.js';
import { DrizzleConversationalSignalAnalysisRepository } from '../../src/modules/conversational-processing/infrastructure/persistence/drizzle-conversational-signal-analysis-repository.js';
import { createConversationalSignalAnalysisRouter } from '../../src/modules/conversational-processing/interfaces/rest/conversational-signal-analysis-routes.js';
import type { ConversationalSignalAnalysisPayload } from '../../src/modules/conversational-processing/domain/model/conversational-signal-analysis.js';
import { createConversationalSignalAnalysis } from '../../src/modules/conversational-processing/domain/model/conversational-signal-analysis.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { connectTestDatabase } from './test-database.js';
import { acquirePreliminaryAssessmentNoticeLock } from './preliminary-assessment-notice-lock.js';

const purposes = ['ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis'] as const;
const jwt = new JwtAccessTokenService('conversational-signal-test-only-secret-with-sufficient-entropy', 'conversation-signals-integration', 'synthetic-test-client', 300);
type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

describe('Conversational signal analysis PostgreSQL integration', () => {
  let pool: TestDatabase['pool'];
  let db: TestDatabase['db'];
  let noticeLock: Awaited<ReturnType<typeof acquirePreliminaryAssessmentNoticeLock>> | undefined;
  let server: Server | undefined;
  let baseUrl: string;
  const accountIds = new Set<string>();
  const allowedAccountIds: string[] = [];
  const draftNoticeIds = new Set<string>();
  const noticeIds = new Map<ConsentPurpose, string>();
  const analyzer = {
    modelVersion: 'synthetic-analyzer-v1',
    analyze: vi.fn(async (input: { messages: Array<{ messageId: string; content: string }> }) => {
      const message = input.messages[0];
      if (!message) throw new Error('Synthetic test analyzer received no student messages');
      const isAnxiety = message.content.includes('preocupa');
      const observed = {
        level: 'low' as const,
        evidenceCount: 1,
        indicators: [isAnxiety ? 'worry' as const : 'academic_overload' as const],
        summary: isAnxiety ? 'Menciona preocupación académica.' : 'Menciona sobrecarga académica.',
        observedPattern: 'single_report' as const,
        evidence: [{ paraphrase: isAnxiety ? 'Le preocupa una evaluación.' : 'Refiere sobrecarga por tareas.', messageId: message.messageId }],
      };
      const insufficient = {
        level: 'insufficient_evidence' as const,
        evidenceCount: 0,
        indicators: [] as [],
        summary: 'Los mensajes seleccionados no ofrecen evidencia textual suficiente para esta dimensión.',
        observedPattern: 'insufficient_evidence' as const,
        evidence: [] as [],
      };
      const payload: ConversationalSignalAnalysisPayload = {
        signals: {
          depression: insufficient,
          anxiety: isAnxiety ? observed : insufficient,
          stress: isAnxiety ? insufficient : observed,
        },
        overallSummary: isAnxiety
          ? 'En el mensaje sintético se menciona preocupación por una evaluación; la cobertura es limitada.'
          : 'En el mensaje sintético se menciona sobrecarga por tareas; la cobertura es limitada.',
      };
      return payload;
    }),
  } satisfies ConversationalSignalAnalyzer;

  async function ensurePublishedNotice(purpose: ConsentPurpose): Promise<string> {
    const existing = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'), lte(consentNoticeVersions.effectiveAt, new Date()),
    )).limit(1);
    const current = existing[0];
    if (current) return current.id;

    const id = randomUUID();
    const content = `Synthetic integration-only consent fixture for ${purpose}; not legal text.`;
    const [draft] = await db.insert(consentNoticeVersions).values({
      id, purpose, version: `it-${randomUUID().slice(0, 16)}`, content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      effectiveAt: new Date(Date.now() - 60_000), status: 'draft',
    }).returning({ id: consentNoticeVersions.id });
    if (!draft) throw new Error(`Could not prepare synthetic consent fixture for ${purpose}`);
    draftNoticeIds.add(id);
    await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
    draftNoticeIds.delete(id);
    return id;
  }

  async function createAccount(): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    await db.insert(authAccounts).values({ id, email: `signals-it-${randomUUID()}@example.test`, passwordHash: 'synthetic-integration-only-hash' });
    accountIds.add(id);
    allowedAccountIds.push(id);
    return { id, token: await jwt.issue(id) };
  }

  async function grantAll(accountId: string): Promise<void> {
    for (const purpose of purposes) {
      const noticeVersionId = noticeIds.get(purpose);
      if (!noticeVersionId) throw new Error(`Synthetic notice not prepared for ${purpose}`);
      await db.insert(accountConsentEvents).values({
        accountId, purpose, noticeVersionId, action: 'granted', idempotencyKey: randomUUID(),
      });
    }
  }

  async function createConversation(accountId: string, content: string): Promise<{ id: string; messageId: string }> {
    const [conversation] = await db.insert(conversations).values({ accountId, title: 'Synthetic signal analysis integration' }).returning({ id: conversations.id });
    if (!conversation) throw new Error('Could not create synthetic conversation');
    const [message] = await db.insert(conversationMessages).values({
      conversationId: conversation.id, role: 'user', status: 'completed', content,
    }).returning({ id: conversationMessages.id });
    if (!message) throw new Error('Could not create synthetic user message');
    return { id: conversation.id, messageId: message.id };
  }

  async function post(path: string, token: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    ({ pool, db } = await connectTestDatabase());
    noticeLock = await acquirePreliminaryAssessmentNoticeLock(pool);
    for (const purpose of purposes) noticeIds.set(purpose, await ensurePublishedNotice(purpose));

    const analysisRepository = new DrizzleConversationalSignalAnalysisRepository(db);
    const policy = { enabled: true, retentionDays: 90, allowedAccountIds } as const;
    const services = {
      command: new AnalyzeAuthorizedConversationSignals(
        new DrizzleConversationRepository(db), new DrizzleConversationMessageRepository(db),
        new CheckConsentForPurpose(new DrizzleConsentRepository(db)), analyzer, analysisRepository, policy,
      ),
      query: new GetMyConversationalSignalAnalysis(analysisRepository, policy),
    };
    const disabledAnalyzer: ConversationalSignalAnalyzer = { modelVersion: 'must-not-run-v1', analyze: vi.fn(async () => { throw new Error('Disabled composition called analyzer'); }) };
    const disabledServices = {
      command: new AnalyzeAuthorizedConversationSignals(
        {} as never, {} as never, {} as never, disabledAnalyzer, {} as never, { enabled: false, retentionDays: null, allowedAccountIds: [] },
      ),
      query: new GetMyConversationalSignalAnalysis({} as never, { enabled: false, retentionDays: null, allowedAccountIds: [] }),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createConversationalSignalAnalysisRouter(jwt, services));
    app.use('/disabled/api/v1', createConversationalSignalAnalysisRouter(jwt, disabledServices));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server?.once('listening', resolve);
      server?.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 20_000);

  afterEach(async () => {
    const ids = [...accountIds];
    accountIds.clear();
    allowedAccountIds.length = 0;
    if (ids.length > 0) await pool.query('DELETE FROM auth_accounts WHERE id = ANY($1::uuid[])', [ids]);
    const draftIds = [...draftNoticeIds];
    draftNoticeIds.clear();
    if (draftIds.length > 0) await pool.query("DELETE FROM consent_notice_versions WHERE id = ANY($1::uuid[]) AND status = 'draft'", [draftIds]);
    analyzer.analyze.mockClear();
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    await noticeLock?.release();
    await pool?.end();
  });

  it('persists synthetic analyses, serves latest/history, and isolates two owners over authenticated HTTP', async () => {
    const ownerA = await createAccount();
    const ownerB = await createAccount();
    await grantAll(ownerA.id);
    await grantAll(ownerB.id);
    const conversationA = await createConversation(ownerA.id, 'Me preocupa una evaluación próxima.');
    const conversationB = await createConversation(ownerB.id, 'Me siento sobrecargada por las tareas.');

    const analyzeA = await post(`/api/v1/conversations/${conversationA.id}/signals/analyze`, ownerA.token, { messageIds: [conversationA.messageId] });
    const bodyA = await analyzeA.json() as Record<string, any>;
    const analyzeB = await post(`/api/v1/conversations/${conversationB.id}/signals/analyze`, ownerB.token, { messageIds: [conversationB.messageId] });
    const bodyB = await analyzeB.json() as Record<string, any>;
    expect(analyzeA.status).toBe(200);
    expect(analyzeB.status).toBe(200);
    expect(bodyA.analysisVersion).toBe('conversational-signals-1.0.0');
    expect(bodyA.modelVersion).toBe('synthetic-analyzer-v1');
    expect(bodyA.signals.anxiety.level).toBe('low');
    expect(bodyA.signals.depression.level).toBe('insufficient_evidence');
    expect(bodyB.signals.stress.level).toBe('low');
    expect(bodyA.signals.anxiety.evidence[0].messageId).toBe(conversationA.messageId);
    expect(bodyB.signals.stress.evidence[0].messageId).toBe(conversationB.messageId);
    expect(bodyA).not.toHaveProperty('accountId');
    expect(JSON.stringify(bodyA)).not.toMatch(/rawScore|equivalentScore|DASS-21/i);

    const persisted = await db.select({ accountId: conversationalSignalAnalyses.accountId, conversationId: conversationalSignalAnalyses.conversationId })
      .from(conversationalSignalAnalyses).where(eq(conversationalSignalAnalyses.analysisId, bodyA.analysisId));
    expect(persisted).toEqual([{ accountId: ownerA.id, conversationId: conversationA.id }]);
    const retention = await db.select({ analyzedAt: conversationalSignalAnalyses.analyzedAt, expiresAt: conversationalSignalAnalyses.expiresAt })
      .from(conversationalSignalAnalyses).where(eq(conversationalSignalAnalyses.analysisId, bodyA.analysisId));
    expect(retention[0]?.expiresAt.getTime() - retention[0]?.analyzedAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);

    const latestAResponse = await fetch(`${baseUrl}/api/v1/me/conversational-signals/latest`, { headers: { authorization: `Bearer ${ownerA.token}` } });
    const latestA = await latestAResponse.json() as Record<string, any>;
    expect(latestAResponse.status).toBe(200);
    expect(latestA.analysisId).toBe(bodyA.analysisId);
    expect(latestA).not.toHaveProperty('accountId');
    const historyAResponse = await fetch(`${baseUrl}/api/v1/me/conversational-signals/history`, { headers: { authorization: `Bearer ${ownerA.token}` } });
    const historyA = await historyAResponse.json() as { items: Array<Record<string, any>> };
    expect(historyAResponse.status).toBe(200);
    expect(historyA.items.map(item => item.analysisId)).toEqual([bodyA.analysisId]);
    const latestBResponse = await fetch(`${baseUrl}/api/v1/me/conversational-signals/latest`, { headers: { authorization: `Bearer ${ownerB.token}` } });
    await expect(latestBResponse.json()).resolves.toMatchObject({ analysisId: bodyB.analysisId, signals: { stress: { level: 'low' } } });

    const foreignConversation = await post(`/api/v1/conversations/${conversationB.id}/signals/analyze`, ownerA.token, { messageIds: [conversationB.messageId] });
    expect(foreignConversation.status).toBe(404);
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('blocks analysis and reads after longitudinal signal consent withdrawal', async () => {
    const owner = await createAccount();
    await grantAll(owner.id);
    const conversation = await createConversation(owner.id, 'Me preocupa una evaluación próxima.');
    const initial = await post(`/api/v1/conversations/${conversation.id}/signals/analyze`, owner.token, { messageIds: [conversation.messageId] });
    expect(initial.status).toBe(200);
    const [noticeId] = [noticeIds.get('conversational_signal_analysis')];
    if (!noticeId) throw new Error('Missing synthetic analysis notice');
    await db.insert(accountConsentEvents).values({
      accountId: owner.id, purpose: 'conversational_signal_analysis', noticeVersionId: noticeId,
      action: 'withdrawn', idempotencyKey: randomUUID(),
    });
    const callsBefore = analyzer.analyze.mock.calls.length;
    const blockedPost = await post(`/api/v1/conversations/${conversation.id}/signals/analyze`, owner.token, { messageIds: [conversation.messageId] });
    expect(blockedPost.status).toBe(403);
    const blockedRead = await fetch(`${baseUrl}/api/v1/me/conversational-signals/latest`, { headers: { authorization: `Bearer ${owner.token}` } });
    expect(blockedRead.status).toBe(403);
    expect(analyzer.analyze).toHaveBeenCalledTimes(callsBefore);
  }, 20_000);

  it('blocks POST and GET when the pilot account has not granted the three current consents', async () => {
    const owner = await createAccount();
    const conversation = await createConversation(owner.id, 'Synthetic message without consent.');
    const before = analyzer.analyze.mock.calls.length;
    const response = await post(`/api/v1/conversations/${conversation.id}/signals/analyze`, owner.token, { messageIds: [conversation.messageId] });
    expect(response.status).toBe(403);
    const latest = await fetch(`${baseUrl}/api/v1/me/conversational-signals/latest`, { headers: { authorization: `Bearer ${owner.token}` } });
    expect(latest.status).toBe(403);
    expect(analyzer.analyze).toHaveBeenCalledTimes(before);
    await expect(db.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses)
      .where(eq(conversationalSignalAnalyses.accountId, owner.id))).resolves.toHaveLength(0);
  }, 20_000);

  it('keeps the disabled composition blocked on POST and GET without provider calls or persistence', async () => {
    const owner = await createAccount();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const before = await db.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses).where(eq(conversationalSignalAnalyses.accountId, owner.id));
    const response = await post(`/disabled/api/v1/conversations/${conversationId}/signals/analyze`, owner.token, { messageIds: [messageId] });
    expect(response.status).toBe(503);
    const latest = await fetch(`${baseUrl}/disabled/api/v1/me/conversational-signals/latest`, { headers: { authorization: `Bearer ${owner.token}` } });
    expect(latest.status).toBe(503);
    const after = await db.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses).where(eq(conversationalSignalAnalyses.accountId, owner.id));
    expect(after).toEqual(before);
  }, 20_000);

  it('purges only expired analyses in the requested batch scope and preserves conversations and another owner', async () => {
    const owner = await createAccount();
    const otherOwner = await createAccount();
    await grantAll(owner.id);
    await grantAll(otherOwner.id);
    const ownConversation = await createConversation(owner.id, 'Synthetic report about examination worry.');
    const otherConversation = await createConversation(otherOwner.id, 'Synthetic report about academic overload.');
    const consentNoticeVersionId = noticeIds.get('conversational_signal_analysis');
    if (!consentNoticeVersionId) throw new Error('Missing synthetic analysis notice');
    const now = new Date();

    async function insertAnalysis(accountId: string, conversation: { id: string; messageId: string }, analyzedAt: Date, expiresAt: Date): Promise<string> {
      const messageContent = accountId === owner.id ? 'Me preocupa una evaluación.' : 'Me sobrecargan las tareas.';
      const payload = await analyzer.analyze({ messages: [{ messageId: conversation.messageId, content: messageContent }] });
      const analysis = createConversationalSignalAnalysis({
        analysisId: randomUUID(), conversationId: conversation.id, accountId, analyzedAt,
        period: { start: analyzedAt, end: analyzedAt }, selectedMessageCount: 1, analyzedUserMessageCount: 1,
        excludedNonUserMessageCount: 0, modelVersion: 'synthetic-analyzer-v1', payload,
        allowedUserMessageIds: [conversation.messageId],
      });
      await db.insert(conversationalSignalAnalyses).values({
        analysisId: analysis.analysisId, accountId, conversationId: conversation.id, consentNoticeVersionId,
        analysisVersion: analysis.analysisVersion, modelVersion: analysis.modelVersion,
        analyzedAt: new Date(analysis.analyzedAt), periodStart: new Date(analysis.period.start!), periodEnd: new Date(analysis.period.end!),
        expiresAt, payload: analysis,
      });
      return analysis.analysisId;
    }

    const oldAnalysisTime = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const expiredId = await insertAnalysis(owner.id, ownConversation, oldAnalysisTime, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));
    const liveId = await insertAnalysis(owner.id, ownConversation, new Date(now.getTime() - 60_000), new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const otherExpiredId = await insertAnalysis(otherOwner.id, otherConversation, oldAnalysisTime, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));

    const purged = await new DrizzleConversationalSignalAnalysisRepository(db).purgeExpiredBatch(now, 10, owner.id);
    expect(purged).toBe(1);
    const ownRows = await db.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses)
      .where(eq(conversationalSignalAnalyses.accountId, owner.id));
    const otherRows = await db.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses)
      .where(eq(conversationalSignalAnalyses.accountId, otherOwner.id));
    expect(ownRows.map(row => row.analysisId)).toEqual([liveId]);
    expect(otherRows.map(row => row.analysisId)).toEqual([otherExpiredId]);
    expect(ownRows.some(row => row.analysisId === expiredId)).toBe(false);
    expect(await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, ownConversation.id))).toHaveLength(1);
    expect(await db.select({ id: conversationMessages.id }).from(conversationMessages).where(eq(conversationMessages.id, ownConversation.messageId))).toHaveLength(1);
    const expiredLatest = await fetch(`${baseUrl}/api/v1/me/conversational-signals/latest`, { headers: { authorization: `Bearer ${otherOwner.token}` } });
    await expect(expiredLatest.json()).resolves.toMatchObject({ status: 'not_available', reason: 'no_analysis' });
    await expect(db.select({ analysisId: conversationalSignalAnalyses.analysisId }).from(conversationalSignalAnalyses)
      .where(eq(conversationalSignalAnalyses.accountId, otherOwner.id))).resolves.toHaveLength(0);
  }, 20_000);
});
