import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/shared/infrastructure/database/schema.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { conversationMessages } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { preliminaryAssessments } from '../../src/modules/preliminary-assessment/infrastructure/persistence/schema.js';
import { TECHNICAL_TEST_DASS21_VERSION_ID } from '../../src/modules/preliminary-assessment/technical-test/dass21-candidate-fixture.js';
import { validateStagingDatabaseUrl, isStagingLoopbackAddress } from '../../src/shared/infrastructure/database/staging-database-safety.js';
import { findClinicalResultFieldPaths } from '../helpers/clinical-result-shape.js';

const stagingUrl = process.env.STAGING_DATABASE_URL;
const stagingDescribe = stagingUrl ? describe : describe.skip;
const stagingPurposes = ['ai_conversation_processing', 'structured_signal_extraction', 'preliminary_assessment'] as const;
const fixedChatMessage = '[SINTÉTICO] Me cuesta organizarme para mis exámenes y quiero conversar sobre manejo del tiempo.';
const fixedPassword = 'Synthetic-Only-Password-8B2!';
type Database = NodePgDatabase<typeof schema>;

stagingDescribe('integrated synthetic staging HTTP E2E (real PostgreSQL, local loopback only)', () => {
  let pool: Pool | undefined;
  let db: Database | undefined;
  let baseUrl = '';
  const accountIds = new Set<string>();

  function database(): Database {
    if (!db) throw new Error('Verified staging database is not connected');
    return db;
  }

  function validateBaseUrl(value: string | undefined): string {
    const candidate = value ?? 'http://127.0.0.1:3042';
    let parsed: URL;
    try { parsed = new URL(candidate); } catch { throw new Error('STAGING_E2E_BASE_URL must be an explicit loopback HTTP URL'); }
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host) ||
        parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('STAGING_E2E_BASE_URL must target only a local loopback server');
    }
    return parsed.origin;
  }

  async function request(path: string, options: { token?: string; method?: string; body?: unknown } = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  async function createAccount(): Promise<{ id: string; token: string }> {
    const email = `staging-e2e-${randomUUID()}@example.test`;
    const registered = await request('/api/v1/auth/sign-up', { method: 'POST', body: { email, password: fixedPassword } });
    expect(registered.status).toBe(201);
    const account = await registered.json() as { id: string; email: string };
    expect(account.email).toBe(email);
    accountIds.add(account.id);

    const visibleInVerifiedDatabase = await database().select({ id: authAccounts.id }).from(authAccounts).where(eq(authAccounts.id, account.id));
    expect(visibleInVerifiedDatabase).toEqual([{ id: account.id }]);
    const login = await request('/api/v1/auth/sign-in', { method: 'POST', body: { email, password: fixedPassword } });
    expect(login.status).toBe(200);
    const session = await login.json() as { accessToken: string; tokenType: string };
    expect(session.tokenType).toBe('Bearer');
    return { id: account.id, token: session.accessToken };
  }

  async function currentNoticeIds(): Promise<Record<(typeof stagingPurposes)[number], string>> {
    const response = await request('/api/v1/consents/notices');
    expect(response.status).toBe(200);
    const notices = await response.json() as Array<{ id: string; purpose: string; content: string }>;
    const selected = {} as Record<(typeof stagingPurposes)[number], string>;
    for (const purpose of stagingPurposes) {
      const notice = notices.find(item => item.purpose === purpose);
      expect(notice, `current synthetic notice for ${purpose}`).toBeDefined();
      expect(notice?.content).toMatch(/SOLO PRUEBA TÉCNICA.*NO APROBACIÓN LEGAL.*DATOS FICTICIOS/i);
      selected[purpose] = notice!.id;
    }
    return selected;
  }

  async function decide(token: string, purpose: (typeof stagingPurposes)[number], noticeVersionId: string, action: 'granted' | 'withdrawn' = 'granted'): Promise<Response> {
    return request('/api/v1/consents/me/decisions', { token, method: 'POST', body: {
      purpose, noticeVersionId, action, idempotencyKey: randomUUID(),
    } });
  }

  beforeAll(async () => {
    const connectionString = validateStagingDatabaseUrl(stagingUrl, process.env.NODE_ENV ?? 'test');
    pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 3000, application_name: 'tesis_integrated_staging_e2e' });
    const verified = await pool.query<{ database_name: string; server_address: string | null }>(
      'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
    );
    const identity = verified.rows[0];
    if (identity?.database_name !== 'tesis_staging_db' || !isStagingLoopbackAddress(identity.server_address)) {
      throw new Error('E2E refuses any database except local tesis_staging_db');
    }
    db = drizzle(pool, { schema });
    const now = new Date();
    for (const purpose of stagingPurposes) {
      const [notice] = await database().select({ id: consentNoticeVersions.id, content: consentNoticeVersions.content })
        .from(consentNoticeVersions).where(and(
          eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'),
          lte(consentNoticeVersions.effectiveAt, now),
        )).limit(1);
      if (!notice || !/SOLO PRUEBA TÉCNICA.*NO APROBACIÓN LEGAL.*DATOS FICTICIOS/i.test(notice.content)) {
        throw new Error(`E2E requires an already prepared synthetic notice for ${purpose}; tests do not seed consent notices`);
      }
    }

    baseUrl = validateBaseUrl(process.env.STAGING_E2E_BASE_URL);
    const health = await request('/health');
    if (!health.ok || (await health.json() as { mode?: string }).mode !== 'synthetic_staging') {
      throw new Error('The integrated synthetic staging server is not available at STAGING_E2E_BASE_URL');
    }
  }, 15_000);

  afterAll(async () => {
    try {
      // Delete only accounts returned by this run's synthetic sign-ups. FK cascades remove their own test records.
      if (db && accountIds.size) await db.delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
    } finally {
      if (pool) await pool.end();
    }
  }, 15_000);

  it('runs Auth, separate consent, synthetic chat, guidance, and nontrivial DASS-21 through HTTP', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const notices = await currentNoticeIds();

    expect((await request('/api/v1/conversations', { method: 'POST', body: {} })).status).toBe(401);
    const assessmentWithoutConsent = await request('/api/v1/preliminary-assessments', { token: owner.token, method: 'POST', body: {
      instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
    } });
    expect(assessmentWithoutConsent.status).toBe(403);
    expect(await database().select().from(preliminaryAssessments).where(eq(preliminaryAssessments.accountId, owner.id)))
      .toHaveLength(0);
    expect((await decide(owner.token, 'ai_conversation_processing', notices.ai_conversation_processing)).status).toBe(201);

    const created = await request('/api/v1/conversations', { token: owner.token, method: 'POST', body: { title: 'Prueba sintética de conversación' } });
    expect(created.status).toBe(201);
    const conversation = await created.json() as { id: string };
    expect((await request(`/api/v1/conversations/${conversation.id}`, { token: other.token })).status).toBe(404);

    const invalidMessage = await request(`/api/v1/conversations/${conversation.id}/messages`, {
      token: owner.token, method: 'POST', body: { content: 'texto libre no permitido' },
    });
    expect(invalidMessage.status).toBe(400);
    expect(await database().select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id))).toHaveLength(0);

    const sent = await request(`/api/v1/conversations/${conversation.id}/messages`, {
      token: owner.token, method: 'POST', body: { content: fixedChatMessage },
    });
    expect(sent.status).toBe(201);
    const turn = await sent.json() as { userMessage: { id: string; content: string }; assistantMessage: { content: string } };
    expect(turn.userMessage.content).toBe(fixedChatMessage);
    expect(turn.assistantMessage.content).toContain('respuesta automática de prueba');

    const sse = await request(`/api/v1/conversations/${conversation.id}/messages/stream`, {
      token: owner.token, method: 'POST', body: { content: fixedChatMessage },
    });
    expect(sse.status).toBe(200);
    expect(sse.headers.get('content-type')).toContain('text/event-stream');
    const streamText = await sse.text();
    expect(streamText).toContain('event: message.started');
    expect(streamText).toContain('event: message.delta');
    expect(streamText).toContain('event: message.completed');

    const messagesResponse = await request(`/api/v1/conversations/${conversation.id}/messages?limit=100`, { token: owner.token });
    const messages = await messagesResponse.json() as { items: Array<{ id: string }> };
    expect(messagesResponse.status).toBe(200);
    expect(messages.items).toHaveLength(4);
    const extractionRequest = { messageIds: messages.items.map(item => item.id) };
    expect((await request(`/api/v1/conversations/${conversation.id}/signals/results`, {
      token: owner.token, method: 'POST', body: extractionRequest,
    })).status).toBe(403);
    expect((await decide(owner.token, 'structured_signal_extraction', notices.structured_signal_extraction)).status).toBe(201);
    const guidanceResponse = await request(`/api/v1/conversations/${conversation.id}/signals/results`, {
      token: owner.token, method: 'POST', body: extractionRequest,
    });
    expect(guidanceResponse.status).toBe(200);
    const guidance = await guidanceResponse.json() as {
      id: string;
      summary: { interpretationLimits: string[] };
      preliminaryGuidance: {
        contractVersion: string; conversationId: string; observations: unknown[];
        informationGaps: Array<{ reason: string }>; limitations: string[];
      };
    };
    expect(guidance.preliminaryGuidance).toMatchObject({ contractVersion: '1.0', conversationId: conversation.id, observations: [] });
    expect(guidance.preliminaryGuidance.informationGaps.length).toBeGreaterThan(0);
    expect(guidance.preliminaryGuidance.informationGaps.every(item => item.reason === 'not_assessed')).toBe(true);
    expect(findClinicalResultFieldPaths(guidance)).toEqual([]);
    expect(guidance.summary.interpretationLimits).toContain('not_a_diagnosis');
    expect(guidance.summary.interpretationLimits).toContain('clinical_severity_not_calculated');
    expect(guidance.preliminaryGuidance.limitations).toContain(
      'No es una evaluación ni un diagnóstico clínico y no calcula puntuaciones o niveles de severidad.',
    );
    const repeatedGuidance = await request(`/api/v1/conversations/${conversation.id}/signals/results`, {
      token: owner.token, method: 'POST', body: extractionRequest,
    });
    expect((await repeatedGuidance.json() as { id: string }).id).not.toBe(guidance.id);

    expect((await decide(other.token, 'preliminary_assessment', notices.preliminary_assessment)).status).toBe(201);
    expect((await decide(owner.token, 'preliminary_assessment', notices.preliminary_assessment)).status).toBe(201);
    const statusResponse = await request('/api/v1/consents/me', { token: owner.token });
    const status = await statusResponse.json() as { items: Array<{ purpose: string; state: string }> };
    expect(statusResponse.status).toBe(200);
    for (const purpose of stagingPurposes) expect(status.items.find(item => item.purpose === purpose)?.state).toBe('granted');

    const assessmentWithUnknownInstrument = await request('/api/v1/preliminary-assessments', { token: owner.token, method: 'POST', body: {
      instrumentVersionId: randomUUID(),
    } });
    expect(assessmentWithUnknownInstrument.status).toBe(409);
    expect(await database().select().from(preliminaryAssessments).where(eq(preliminaryAssessments.accountId, owner.id)))
      .toHaveLength(0);

    const infoResponse = await request('/api/v1/preliminary-assessments/info', { token: owner.token });
    const info = await infoResponse.json() as { instruments: Array<{ instrumentVersionId: string; approvalStatus: string; technicalAvailability: string }> };
    expect(infoResponse.status).toBe(200);
    expect(info.instruments.map(instrument => instrument.instrumentVersionId)).toEqual([TECHNICAL_TEST_DASS21_VERSION_ID]);
    expect(info.instruments[0]).toMatchObject({ approvalStatus: 'not_approved', technicalAvailability: 'technical_test_only' });
    expect((await request('/api/v1/preliminary-assessments', { token: owner.token, method: 'POST', body: {
      instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID, accountId: other.id,
    } })).status).toBe(400);

    const startedResponse = await request('/api/v1/preliminary-assessments', { token: owner.token, method: 'POST', body: {
      instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
    } });
    expect(startedResponse.status).toBe(201);
    const assessment = await startedResponse.json() as { id: string };
    expect((await request(`/api/v1/preliminary-assessments/${assessment.id}/form`, { token: other.token })).status).toBe(404);
    const formResponse = await request(`/api/v1/preliminary-assessments/${assessment.id}/form`, { token: owner.token });
    const form = await formResponse.json() as { instrument: {
      instrumentVersionId: string; candidateVersion: string; professionalReviewStatus: string; approvalStatus: string;
      questions: Array<{ id: string; displayOrder: number; options: Array<{ id: string }> }>;
    } };
    expect(formResponse.status).toBe(200);
    expect(form.instrument).toMatchObject({ instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
      candidateVersion: 'dass21-spanish-candidate-1.1', professionalReviewStatus: 'pending', approvalStatus: 'not_approved' });
    expect(form.instrument.questions).toHaveLength(21);
    expect(form.instrument.questions.map(question => question.displayOrder)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(JSON.stringify(form)).not.toContain('scoringValue');

    const dims = {
      depression: [3, 5, 10, 13, 16, 17, 21],
      anxiety: [2, 4, 7, 9, 15, 19, 20],
      stress: [1, 6, 8, 11, 12, 14, 18],
    } as const;
    for (const question of form.instrument.questions) {
      const scoringValue = question.displayOrder % 4;
      const option = question.options[scoringValue];
      if (!option) throw new Error('Expected a candidate option at the selected synthetic scoring value');
      const response = await request(`/api/v1/preliminary-assessments/${assessment.id}/responses`, {
        token: owner.token, method: 'POST', body: {
          questionId: question.id, answer: { type: 'single_choice', optionId: option.id, scoringValue },
        },
      });
      expect(response.status).toBe(400); // Client-supplied scoringValue is forbidden by the strict request schema.
      const accepted = await request(`/api/v1/preliminary-assessments/${assessment.id}/responses`, {
        token: owner.token, method: 'POST', body: { questionId: question.id, answer: { type: 'single_choice', optionId: option.id } },
      });
      expect(accepted.status).toBe(200);
    }

    const completed = await request(`/api/v1/preliminary-assessments/${assessment.id}/complete`, {
      token: owner.token, method: 'POST', body: {},
    });
    expect(completed.status).toBe(200);
    const resultResponse = await request(`/api/v1/preliminary-assessments/${assessment.id}/result`, { token: owner.token });
    expect(resultResponse.status).toBe(200);
    const result = await resultResponse.json() as {
      technicalTest: { scope: string; instrumentApprovalStatus: string };
      result: { contractVersion: string; status: string; assessmentId: string; scoringVersion: string; interpretationVersion: string;
        dimensions: Record<string, { rawScore: number; equivalentScore: number; category: string }>;
        isDiagnostic: boolean; limitations: string[] };
    };
    expect(result.technicalTest).toEqual({ scope: 'synthetic_only', instrumentApprovalStatus: 'not_approved' });
    expect(result.result).toMatchObject({ contractVersion: 'dass21-participant-result-1.0', status: 'available', assessmentId: assessment.id,
      scoringVersion: 'dass21-score-1.0', interpretationVersion: 'dass21-conventional-cutoffs-1.0', isDiagnostic: false });
    expect(result.result.dimensions).toEqual({
      depression: { rawScore: 9, equivalentScore: 18, category: 'moderate' },
      anxiety: { rawScore: 12, equivalentScore: 24, category: 'extremely_severe' },
      stress: { rawScore: 10, equivalentScore: 20, category: 'moderate' },
    });
    expect(Object.keys(result.result.dimensions).sort()).toEqual(['anxiety', 'depression', 'stress']);
    expect(result.result).not.toHaveProperty('results');
    expect(result.result).not.toHaveProperty('totalScore');
    expect(result.result.limitations).toContain('not_a_diagnosis');
    expect((await request(`/api/v1/preliminary-assessments/${assessment.id}/result`, { token: other.token })).status).toBe(404);

    // A second synthetic account completes its own assessment with a different response set.
    // This demonstrates per-assessment calculation in isolated staging; it does not enable
    // the pending instrument or result contract in the normal application.
    const otherAssessmentResponse = await request('/api/v1/preliminary-assessments', { token: other.token, method: 'POST', body: {
      instrumentVersionId: TECHNICAL_TEST_DASS21_VERSION_ID,
    } });
    expect(otherAssessmentResponse.status).toBe(201);
    const otherAssessment = await otherAssessmentResponse.json() as { id: string };
    const otherFormResponse = await request(`/api/v1/preliminary-assessments/${otherAssessment.id}/form`, { token: other.token });
    expect(otherFormResponse.status).toBe(200);
    const otherForm = await otherFormResponse.json() as { instrument: { questions: Array<{ id: string; options: Array<{ id: string }> }> } };
    expect(otherForm.instrument.questions).toHaveLength(21);
    for (const question of otherForm.instrument.questions) {
      const option = question.options[0];
      if (!option) throw new Error('Expected a synthetic zero-score option');
      const response = await request(`/api/v1/preliminary-assessments/${otherAssessment.id}/responses`, {
        token: other.token, method: 'POST', body: { questionId: question.id, answer: { type: 'single_choice', optionId: option.id } },
      });
      expect(response.status).toBe(200);
    }
    expect((await request(`/api/v1/preliminary-assessments/${otherAssessment.id}/complete`, {
      token: other.token, method: 'POST', body: {},
    })).status).toBe(200);
    const otherResultResponse = await request(`/api/v1/preliminary-assessments/${otherAssessment.id}/result`, { token: other.token });
    expect(otherResultResponse.status).toBe(200);
    const otherResult = await otherResultResponse.json() as {
      result: { status: string; assessmentId: string; dimensions: Record<string, { rawScore: number; equivalentScore: number; category: string }> };
    };
    expect(otherResult.result).toMatchObject({ status: 'available', assessmentId: otherAssessment.id });
    expect(otherResult.result.dimensions).toEqual({
      depression: { rawScore: 0, equivalentScore: 0, category: 'normal' },
      anxiety: { rawScore: 0, equivalentScore: 0, category: 'normal' },
      stress: { rawScore: 0, equivalentScore: 0, category: 'normal' },
    });
    expect(otherResult.result.dimensions).not.toEqual(result.result.dimensions);
    expect((await request(`/api/v1/preliminary-assessments/${otherAssessment.id}/result`, { token: owner.token })).status).toBe(404);

    // The expected sums above are calculated independently of the scoring implementation.
    const answerForItem = (itemNumber: number) => itemNumber % 4;
    const independentScores = Object.fromEntries(Object.entries(dims).map(([dimension, items]) => {
      const rawScore = items.reduce((sum, itemNumber) => sum + answerForItem(itemNumber), 0);
      return [dimension, { rawScore, equivalentScore: rawScore * 2 }];
    }));
    expect(independentScores).toEqual({
      depression: { rawScore: 9, equivalentScore: 18 }, anxiety: { rawScore: 12, equivalentScore: 24 }, stress: { rawScore: 10, equivalentScore: 20 },
    });

    expect((await decide(owner.token, 'structured_signal_extraction', notices.structured_signal_extraction, 'withdrawn')).status).toBe(201);
    const extractionAfterWithdrawal = await request(`/api/v1/conversations/${conversation.id}/signals/results`, {
      token: owner.token, method: 'POST', body: extractionRequest,
    });
    expect(extractionAfterWithdrawal.status).toBe(403);
    expect((await decide(owner.token, 'preliminary_assessment', notices.preliminary_assessment, 'withdrawn')).status).toBe(201);
    const resultAfterWithdrawal = await request(`/api/v1/preliminary-assessments/${assessment.id}/result`, { token: owner.token });
    expect(resultAfterWithdrawal.status).toBe(200);
    const withdrawnResult = await resultAfterWithdrawal.json() as { result: { status: string } };
    expect(withdrawnResult.result.status).toBe('not_available');
    expect(JSON.stringify(withdrawnResult)).not.toMatch(/rawScore|equivalentScore|category|dimensions/);
    expect((await decide(owner.token, 'ai_conversation_processing', notices.ai_conversation_processing, 'withdrawn')).status).toBe(201);
    const messageCountBeforeWithdrawalRequest = await database().select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
    const chatAfterWithdrawal = await request(`/api/v1/conversations/${conversation.id}/messages`, {
      token: owner.token, method: 'POST', body: { content: fixedChatMessage },
    });
    expect(chatAfterWithdrawal.status).toBe(403);
    expect(await database().select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id)))
      .toHaveLength(messageCountBeforeWithdrawalRequest.length);
  }, 60_000);
});

if (!stagingUrl) {
  // Vitest reports this suite as skipped until a dedicated local staging URL is explicitly supplied.
  console.info('Integrated synthetic staging E2E skipped: set STAGING_DATABASE_URL for local tesis_staging_db.');
}
