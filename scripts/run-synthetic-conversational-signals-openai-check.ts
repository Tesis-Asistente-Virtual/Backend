import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { Pool, type PoolClient } from 'pg';
import { and, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/shared/infrastructure/database/schema.js';
import { env } from '../src/config/env.js';
import { authAccounts } from '../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { consentNoticeVersions } from '../src/modules/consent/infrastructure/persistence/schema.js';
import { DrizzleConsentRepository } from '../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { RecordMyConsentDecision } from '../src/modules/consent/application/internal/command-services/record-my-consent-decision.js';
import { CheckConsentForPurpose } from '../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import type { ConsentPurpose } from '../src/modules/consent/domain/model/consent.js';
import { conversations, conversationMessages } from '../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationMessageRepository } from '../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { DrizzleConversationRepository } from '../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { AnalyzeAuthorizedConversationSignals, GetMyConversationalSignalAnalysis } from '../src/modules/conversational-processing/application/internal/command-services/analyze-authorized-conversation-signals.js';
import {
  areConversationalSignalEvidenceReferencesValid,
  conversationalSignalAnalysisPayloadSchema,
  conversationalSignalDimensions,
} from '../src/modules/conversational-processing/domain/model/conversational-signal-analysis.js';
import {
  ConversationalSignalAnalysisError,
  getSafeConversationalSignalResponseDiagnostics,
  type ConversationalSignalResponseDiagnostics,
} from '../src/modules/conversational-processing/application/ports/conversational-signal-analyzer.js';
import type { ConversationalSignalAnalysisRepository } from '../src/modules/conversational-processing/domain/repositories/conversational-signal-analysis-repository.js';
import {
  classifySyntheticSignalCheckFailure,
  selectSyntheticSignalFixture,
  syntheticOpenAiCheckTimeoutMs,
  syntheticOpenAiMaxOutputTokens,
  type SyntheticSignalCheckPhase,
} from './conversational-signals-openai-fixtures.js';
import type { ConversationalSignalAnalyzer } from '../src/modules/conversational-processing/application/ports/conversational-signal-analyzer.js';
import { DrizzleConversationalSignalAnalysisRepository } from '../src/modules/conversational-processing/infrastructure/persistence/drizzle-conversational-signal-analysis-repository.js';
import { OpenAiConversationalSignalAnalyzer } from '../src/modules/conversational-processing/infrastructure/openai/openai-conversational-signal-analyzer.js';
import { isAllowedLoopbackAddress, validateTestDatabaseUrl } from '../src/shared/infrastructure/database/test-database-safety.js';

export const activationFlag = '--run-synthetic-conversational-signals-openai-check';
export const confirmationFlag = '--confirm-synthetic-only';
const requiredPurposes: readonly ConsentPurpose[] = ['ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis'];
const testNoticeVersion = 'csig-openai-test-v1';
const testNoticeContent = '[FIXTURE SINTÉTICO DE PRUEBA — NO ES AVISO LEGAL NI VÁLIDO PARA PRODUCCIÓN] Este aviso solo autoriza pruebas técnicas con cuentas y mensajes ficticios en tesis_test_db. Propósito aplicable: {purpose}. No se permite uso con personas reales. It is not legal text and not valid for production.';

class SafeBlock extends Error {
  constructor(readonly kind: string) { super('Synthetic check is blocked by its safety preconditions'); }
}

function stop(kind: string): never {
  throw new SafeBlock(kind);
}

function containsDass21ScoreFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDass21ScoreFields);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, nested]) =>
    ['rawScore', 'equivalentScore', 'scoringValue', 'dass21Score', 'dass21Scores'].includes(key) || containsDass21ScoreFields(nested),
  );
}

let connectionString: string;
let selectedFixture = selectSyntheticSignalFixture([])!;
try {
  const args = process.argv.slice(2);
  const selected = selectSyntheticSignalFixture(args);
  const hasRequiredFlags = args.includes(activationFlag) && args.includes(confirmationFlag) &&
    args.filter(argument => argument === activationFlag || argument === confirmationFlag).length === 2;
  const hasUnknownArgs = args.some(argument => argument !== activationFlag && argument !== confirmationFlag &&
    argument !== '--fixture' && !argument.startsWith('--fixture='));
  if (!hasRequiredFlags || !selected || hasUnknownArgs) stop('activation_required');
  selectedFixture = selected;
  if (process.env.NODE_ENV === 'production') stop('production_environment_blocked');
  if (!env.openAiApiKey) stop('api_key_missing');
  if (!env.openAiModel) stop('model_missing');
  connectionString = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
} catch (error) {
  const kind = error instanceof SafeBlock ? error.kind : 'test_database_target_invalid';
  process.stdout.write(JSON.stringify({ operation: 'synthetic_conversational_signal_openai_check', status: 'blocked', errorKind: kind }) + '\n');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3_000, application_name: 'synthetic_conversational_signals_openai_check' });
const db = drizzle(pool, { schema });
let syntheticAccountId: string | undefined;
let noticeLockClient: PoolClient | undefined;
const noticeIds = new Map<ConsentPurpose, string>();
let currentPhase: SyntheticSignalCheckPhase = 'database_identity';
let providerCallCount = 0;
let providerCallDurationMs: number | undefined;
let providerResponseDiagnostics: ConversationalSignalResponseDiagnostics | undefined;

function isSyntheticNotice(notice: { version: string; content: string } | undefined): boolean {
  return Boolean(notice && /^(?:it|test|integration|synthetic|csig)[-_]/i.test(notice.version) &&
    /(?:test|integration|synthetic|fixture)/i.test(notice.content) && /not (?:legal|valid for production)/i.test(notice.content));
}

async function resolveOrCreateTestNotice(purpose: ConsentPurpose, now: Date): Promise<string> {
  return db.transaction(async tx => {
    const [published] = await tx.select({ id: consentNoticeVersions.id, version: consentNoticeVersions.version, content: consentNoticeVersions.content })
      .from(consentNoticeVersions).where(and(
        eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.status, 'published'),
      )).limit(1);
    if (published) {
      if (!isSyntheticNotice(published)) stop('non_synthetic_published_notice_blocks_test_fixture');
      const [effective] = await tx.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
        eq(consentNoticeVersions.id, published.id), lte(consentNoticeVersions.effectiveAt, now),
      )).limit(1);
      if (!effective) stop('synthetic_notice_not_effective');
      return published.id;
    }

    const content = testNoticeContent.replace('{purpose}', purpose);
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
    const [existing] = await tx.select({ id: consentNoticeVersions.id, status: consentNoticeVersions.status, content: consentNoticeVersions.content, contentHash: consentNoticeVersions.contentHash })
      .from(consentNoticeVersions).where(and(
        eq(consentNoticeVersions.purpose, purpose), eq(consentNoticeVersions.version, testNoticeVersion),
      )).limit(1);
    let noticeId: string;
    if (existing) {
      if (existing.content !== content || existing.contentHash !== contentHash || existing.status !== 'draft') stop('synthetic_notice_fixture_conflict');
      noticeId = existing.id;
    } else {
      const [draft] = await tx.insert(consentNoticeVersions).values({
        purpose, version: testNoticeVersion, content, contentHash,
        effectiveAt: new Date(now.getTime() - 60_000), status: 'draft',
      }).returning({ id: consentNoticeVersions.id });
      if (!draft) stop('synthetic_notice_fixture_creation_failed');
      noticeId = draft.id;
    }
    const [publishedFixture] = await tx.update(consentNoticeVersions).set({ status: 'published' }).where(and(
      eq(consentNoticeVersions.id, noticeId), eq(consentNoticeVersions.status, 'draft'),
    )).returning({ id: consentNoticeVersions.id });
    if (!publishedFixture) stop('synthetic_notice_fixture_publication_failed');
    return publishedFixture.id;
  });
}

try {
  currentPhase = 'database_identity';
  const identity = await pool.query<{ database_name: string; server_address: string | null }>(
    'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
  );
  const target = identity.rows[0];
  if (!target || target.database_name !== 'tesis_test_db' || !target.server_address || !isAllowedLoopbackAddress(target.server_address)) stop('test_database_identity_mismatch');

  // Serialize against integration suites that create or replace shared consent fixtures.
  currentPhase = 'consent_fixtures';
  noticeLockClient = await pool.connect();
  await noticeLockClient.query('SELECT pg_advisory_lock($1, $2)', [510603, 1]);

  const now = new Date();
  for (const purpose of requiredPurposes) {
    noticeIds.set(purpose, await resolveOrCreateTestNotice(purpose, now));
  }
  process.stdout.write(JSON.stringify({ operation: 'synthetic_consent_fixtures_ready', database: 'tesis_test_db', noticeIds: Object.fromEntries(noticeIds) }) + '\n');

  // Only this purpose-specific synthetic identity is inserted; no provider call occurs until the test owner, notices and consent events exist.
  currentPhase = 'synthetic_account_setup';
  syntheticAccountId = randomUUID();
  const [account] = await db.insert(authAccounts).values({
    id: syntheticAccountId,
    email: `synthetic-signal-openai-${randomUUID()}@example.test`,
    passwordHash: 'synthetic-openai-check-no-login-password',
  }).returning({ id: authAccounts.id });
  if (!account) stop('synthetic_account_setup_failed');

  const consentRepository = new DrizzleConsentRepository(db);
  const recordDecision = new RecordMyConsentDecision(consentRepository);
  currentPhase = 'consent_setup';
  for (const purpose of requiredPurposes) {
    const noticeVersionId = noticeIds.get(purpose);
    if (!noticeVersionId) stop('required_test_consent_notice_missing');
    await recordDecision.execute(account.id, { purpose, noticeVersionId, action: 'granted', idempotencyKey: randomUUID() });
  }

  currentPhase = 'conversation_setup';
  const [conversation] = await db.insert(conversations).values({ accountId: account.id, title: 'Synthetic OpenAI signals check' }).returning({ id: conversations.id });
  if (!conversation) stop('synthetic_conversation_setup_failed');
  const selectedMessageIds: string[] = [];
  const messageStart = new Date();
  currentPhase = 'message_setup';
  for (const [index, content] of selectedFixture.fixture.messages.entries()) {
    const [message] = await db.insert(conversationMessages).values({
      conversationId: conversation.id, role: 'user', status: 'completed', content,
      createdAt: new Date(messageStart.getTime() + index * 1_000),
    }).returning({ id: conversationMessages.id });
    if (!message) stop('synthetic_message_setup_failed');
    selectedMessageIds.push(message.id);
  }

  currentPhase = 'authentication_setup';
  const jwtService = new JwtAccessTokenService(randomUUID() + randomUUID(), 'synthetic-signals-check', 'synthetic-only-client', 300);
  const accessToken = await jwtService.issue(account.id);
  const verifiedIdentity = await jwtService.verify(accessToken);
  if (!verifiedIdentity || verifiedIdentity.sub !== account.id) stop('synthetic_jwt_validation_failed');

  const repository = new DrizzleConversationalSignalAnalysisRepository(db);
  const sdkResponses = new OpenAI({ apiKey: env.openAiApiKey!, timeout: syntheticOpenAiCheckTimeoutMs, maxRetries: 0 }).responses;
  const trackedResponses = new Proxy(sdkResponses, {
    get(target, property, receiver) {
      if (property !== 'parse') return Reflect.get(target, property, receiver);
      return (...args: Parameters<typeof sdkResponses.parse>) => {
        if (providerCallCount >= 1) throw new Error('Synthetic verification permits a single provider request');
        providerCallCount += 1;
        currentPhase = 'openai_call';
        const startedAt = performance.now();
        return (async () => {
          try {
            const response = await sdkResponses.parse(...args);
            providerResponseDiagnostics = getSafeConversationalSignalResponseDiagnostics(response);
            return response;
          } finally {
            providerCallDurationMs = Math.round(performance.now() - startedAt);
          }
        })();
      };
    },
  }) as Pick<OpenAI['responses'], 'parse'>;
  const openAiAnalyzerWithTrackedClient = new OpenAiConversationalSignalAnalyzer({
    ...env,
    openAiTimeoutMs: syntheticOpenAiCheckTimeoutMs,
    openAiMaxContextMessages: Math.min(env.openAiMaxContextMessages, selectedFixture.fixture.messages.length),
    openAiMaxContextCharacters: Math.min(env.openAiMaxContextCharacters, 4_000),
    openAiMaxOutputTokens: syntheticOpenAiMaxOutputTokens,
  }, trackedResponses);
  const analyzer: ConversationalSignalAnalyzer = {
    modelVersion: openAiAnalyzerWithTrackedClient.modelVersion,
    analyze: async (input, signal) => {
      try {
        const payload = await openAiAnalyzerWithTrackedClient.analyze(input, signal);
        currentPhase = 'analysis_validation';
        return payload;
      } catch (error) {
        if (error instanceof ConversationalSignalAnalysisError) {
          providerResponseDiagnostics = error.diagnostics ?? providerResponseDiagnostics;
          if (['incomplete_response', 'invalid_response', 'refusal'].includes(error.kind) || error.diagnostics?.responseStatus) {
            currentPhase = 'openai_output_validation';
          }
        }
        throw error;
      }
    },
  };
  const trackedRepository: ConversationalSignalAnalysisRepository = {
    saveForOwnerWithCurrentConsent: input => {
      currentPhase = 'analysis_persistence';
      return repository.saveForOwnerWithCurrentConsent(input);
    },
    findLatestForOwnerWithCurrentConsent: accountId => {
      currentPhase = 'latest_read';
      return repository.findLatestForOwnerWithCurrentConsent(accountId);
    },
    listRecentForOwnerWithCurrentConsent: (accountId, limit) => {
      currentPhase = 'history_read';
      return repository.listRecentForOwnerWithCurrentConsent(accountId, limit);
    },
    purgeExpiredBatch: (asOf, limit, ownerAccountId) => repository.purgeExpiredBatch(asOf, limit, ownerAccountId),
  };
  const policy = { enabled: true, retentionDays: 1, allowedAccountIds: [account.id] } as const;
  const analyze = new AnalyzeAuthorizedConversationSignals(
    new DrizzleConversationRepository(db), new DrizzleConversationMessageRepository(db),
    new CheckConsentForPurpose(consentRepository), analyzer, trackedRepository, policy,
  );
  currentPhase = 'analysis_request';
  const result = await analyze.execute(verifiedIdentity.sub, { conversationId: conversation.id, messageIds: selectedMessageIds });
  currentPhase = 'latest_read';
  const latest = await new GetMyConversationalSignalAnalysis(repository, policy).latest(account.id);
  currentPhase = 'history_read';
  const history = await new GetMyConversationalSignalAnalysis(repository, policy).history(account.id, 5);
  currentPhase = 'final_validation';
  const levels = Object.fromEntries(Object.entries(result.signals).map(([dimension, signal]) => [dimension, signal.level]));
  const dimensionKeys = Object.keys(result.signals).sort();
  const expectedDimensionKeys = [...conversationalSignalDimensions].sort();
  const dimensionsValid = dimensionKeys.length === expectedDimensionKeys.length && dimensionKeys.every((key, index) => key === expectedDimensionKeys[index]);
  const structuredOutputValid = conversationalSignalAnalysisPayloadSchema.safeParse({ signals: result.signals, overallSummary: result.overallSummary }).success;
  const coverageMatchesFixture = result.coverage.selectedMessageCount === selectedMessageIds.length &&
    result.coverage.analyzedUserMessageCount === selectedMessageIds.length && result.coverage.excludedNonUserMessageCount === 0;
  const evidenceCount = Object.values(result.signals).reduce((count, signal) => count + signal.evidence.length, 0);
  const allDimensionsExplicitlyAbstained = Object.values(result.signals).every(signal =>
    signal.level === 'insufficient_evidence' && signal.evidence.length === 0 && signal.indicators.length === 0,
  );
  const summary = {
    operation: 'synthetic_conversational_signal_openai_check',
    status: 'completed' as const,
    syntheticOnly: true,
    fixture: selectedFixture.id,
    providerCallCount,
    ...(providerCallDurationMs !== undefined ? { providerCallDurationMs } : {}),
    effectiveOutputTokenBudget: syntheticOpenAiMaxOutputTokens,
    ...(providerResponseDiagnostics ?? {}),
    modelVersion: result.modelVersion,
    analysisVersion: result.analysisVersion,
    dimensionsValid,
    structuredOutputValid,
    coverageMatchesFixture,
    levels,
    evidenceCount,
    evidenceCountsByDimension: Object.fromEntries(Object.entries(result.signals).map(([dimension, signal]) => [dimension, signal.evidence.length])),
    evidenceReferenceIdsByDimension: Object.fromEntries(Object.entries(result.signals).map(([dimension, signal]) => [dimension, signal.evidence.map(item => item.messageId)])),
    positiveEvidenceObserved: evidenceCount > 0,
    evidenceReferencesValid: areConversationalSignalEvidenceReferencesValid(result.signals, selectedMessageIds),
    allDimensionsExplicitlyAbstained,
    isDiagnostic: result.isDiagnostic,
    isValidatedClinicalScale: result.isValidatedClinicalScale,
    noDass21Scores: !containsDass21ScoreFields(result),
    summaryPresent: result.overallSummary.length > 0,
    limitationsPresent: result.limitations.length > 0,
    persistedAndReadable: latest?.analysisId === result.analysisId && history.some(item => item.analysisId === result.analysisId),
  };
  const checksPassed = providerCallCount === 1 && summary.dimensionsValid && summary.structuredOutputValid && summary.coverageMatchesFixture && summary.evidenceReferencesValid &&
    (summary.evidenceCount > 0 || summary.allDimensionsExplicitlyAbstained) &&
    summary.isDiagnostic === false && summary.isValidatedClinicalScale === false && summary.noDass21Scores &&
    summary.summaryPresent && summary.limitationsPresent && summary.persistedAndReadable;
  process.stdout.write(JSON.stringify({ ...(checksPassed ? summary : { ...summary, status: 'failed', errorKind: 'output_validation_failed' }), syntheticConsentNoticeIds: Object.fromEntries(noticeIds) }) + '\n');
  if (!checksPassed) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({
    operation: 'synthetic_conversational_signal_openai_check', status: 'failed',
    ...classifySyntheticSignalCheckFailure(error, currentPhase), providerCallCount,
    ...(providerCallDurationMs !== undefined ? { providerCallDurationMs } : {}),
    effectiveOutputTokenBudget: syntheticOpenAiMaxOutputTokens,
    ...(providerResponseDiagnostics ?? {}),
  }) + '\n');
  process.exitCode = 1;
} finally {
  currentPhase = 'cleanup';
  if (syntheticAccountId) {
    try {
      await pool.query('DELETE FROM auth_accounts WHERE id = $1::uuid', [syntheticAccountId]);
    } catch {
      process.stderr.write('Synthetic account cleanup was incomplete; a guarded tesis_test_db review is required.\n');
      process.exitCode = 1;
    }
  }
  if (noticeLockClient) {
    try { await noticeLockClient.query('SELECT pg_advisory_unlock($1, $2)', [510603, 1]); }
    catch { process.exitCode = 1; }
    finally { noticeLockClient.release(); }
  }
  await pool.end();
}
