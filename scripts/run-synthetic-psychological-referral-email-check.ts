import { randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import express from 'express';
import { and, eq, lte } from 'drizzle-orm';
import { authAccounts } from '../src/modules/authentication/infrastructure/persistence/schema.js';
import { JwtAccessTokenService } from '../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { conversations, conversationMessages } from '../src/modules/conversations/infrastructure/persistence/schema.js';
import { consentNoticeVersions } from '../src/modules/consent/infrastructure/persistence/schema.js';
import { DrizzleConsentRepository } from '../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { DrizzlePsychologicalReferralRepository } from '../src/modules/psychological-referrals/infrastructure/persistence/drizzle-psychological-referral-repository.js';
import { PsychologicalReferralService } from '../src/modules/psychological-referrals/application/internal/psychological-referral-service.js';
import { ReferralMailerError, type ReferralMailer, type ReferralMailerDiagnostics } from '../src/modules/psychological-referrals/application/ports/referral-mailer.js';
import { ImplicitTlsSmtpReferralMailer } from '../src/modules/psychological-referrals/infrastructure/email/implicit-tls-smtp-referral-mailer.js';
import { createPsychologicalReferralRouter } from '../src/modules/psychological-referrals/interfaces/rest/create-psychological-referral-router.js';
import { errorHandler } from '../src/shared/infrastructure/http/error-handler.js';
import { connectTestDatabase, getTestDatabaseUrl, isAllowedLoopbackAddress, TestDatabaseSafetyError, validateTestDatabaseUrl } from '../tests/integration/test-database.js';

const args = new Set(process.argv.slice(2));
const argValue = (prefix: string) => process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length);
const preflightOnly = args.has('--preflight');
const optedIn = args.has('--run-synthetic-psychological-referral-email-check') && args.has('--confirm-synthetic-only');
const sendRequested = args.has('--send-one-real-email');
const recipientConfirmation = argValue('--confirm-recipient=');
const allowedRecipients = (process.env.PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENTS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const recipient = process.env.PSYCHOLOGICAL_REFERRAL_TEST_RECIPIENT?.trim().toLowerCase();
const testUrl = process.env.TEST_DATABASE_URL;
const smtpReady = Boolean(process.env.PSYCHOLOGICAL_REFERRAL_SMTP_HOST && process.env.PSYCHOLOGICAL_REFERRAL_SMTP_USERNAME &&
  process.env.PSYCHOLOGICAL_REFERRAL_SMTP_PASSWORD && process.env.PSYCHOLOGICAL_REFERRAL_SMTP_FROM &&
  (process.env.PSYCHOLOGICAL_REFERRAL_SMTP_PORT ?? '465') === '465');
const dbUrlReady = Boolean(testUrl && (() => { try { validateTestDatabaseUrl(testUrl); return true; } catch { return false; } })());
const destinationReady = Boolean(recipient && allowedRecipients.includes(recipient));

type Output = {
  readonly operation: 'synthetic_psychological_referral_email_check';
  readonly status: string;
  readonly phase: string;
  readonly database: 'tesis_test_db' | null;
  readonly recipient: string | null;
  readonly conversationCreated: boolean;
  readonly referralPersisted: boolean;
  readonly sendRequests: number;
  readonly smtpAttempts: number;
  readonly durationMs: number;
  readonly cleanupSucceeded: boolean | null;
  readonly smtpFailureStage?: string;
  readonly smtpCode?: number;
  readonly smtpFailureCode?: string;
  readonly smtpDurationMs?: number;
  readonly acceptanceUncertain?: boolean;
  readonly errorKind?: string;
};

function output(values: Omit<Output, 'operation'>): void {
  process.stdout.write(`${JSON.stringify({ operation: 'synthetic_psychological_referral_email_check', ...values })}\n`);
}

if (preflightOnly || !optedIn) {
  const ready = dbUrlReady && smtpReady && destinationReady;
  output({
    status: preflightOnly && !ready ? 'blocked_configuration' : !optedIn ? 'blocked_no_send_confirmation' : ready ? 'preflight_ready' : 'blocked_configuration',
    phase: 'preflight', database: dbUrlReady ? 'tesis_test_db' : null,
    recipient: destinationReady ? recipient ?? null : null, conversationCreated: false,
    referralPersisted: false, sendRequests: 0, smtpAttempts: 0, durationMs: 0, cleanupSucceeded: null,
    ...(!ready ? { errorKind: !dbUrlReady ? 'test_database_configuration_missing_or_unsafe' : !destinationReady ? 'explicit_test_recipient_missing_or_not_allowlisted' : 'smtp_configuration_missing_or_invalid' } : {}),
  });
  process.exitCode = preflightOnly ? 0 : 2;
} else if (!dbUrlReady || !smtpReady || !destinationReady) {
  output({ status: 'blocked_configuration', phase: 'preflight', database: dbUrlReady ? 'tesis_test_db' : null,
    recipient: destinationReady ? recipient ?? null : null, conversationCreated: false, referralPersisted: false,
    sendRequests: 0, smtpAttempts: 0, durationMs: 0, cleanupSucceeded: null,
    errorKind: !dbUrlReady ? 'test_database_configuration_missing_or_unsafe' : !destinationReady ? 'explicit_test_recipient_missing_or_not_allowlisted' : 'smtp_configuration_missing_or_invalid' });
  process.exitCode = 2;
} else {
  const startedAt = Date.now();
  let phase = 'database_connect';
  let connected: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;
  let accountId: string | undefined;
  let createdNoticeId: string | undefined;
  let databaseVerified = false;
  let conversationCreated = false;
  let referralPersisted = false;
  let sendRequests = 0;
  let smtpAttempts = 0;
  let smtpFailure: ReferralMailerDiagnostics | undefined;
  let cleanupSucceeded: boolean | null = null;
  let status = 'failed';
  let errorKind: string | undefined;

  try {
    const validatedUrl = getTestDatabaseUrl();
    connected = await connectTestDatabase();
    await verifyLiveDatabase(connected.pool, validatedUrl);
    databaseVerified = true;
    const tableCheck = await connected.pool.query<{ relation: string | null }>("SELECT to_regclass('public.psychological_referrals')::text AS relation");
    if (!tableCheck.rows[0]?.relation) throw new TestDatabaseSafetyError('Referral migration 0015 is not present', 'schema_missing');

    phase = 'synthetic_fixture_setup';
    const now = new Date();
    const email = `psych-referral-${randomUUID()}@example.test`;
    const [account] = await connected.db.insert(authAccounts).values({ email, passwordHash: 'synthetic-email-check-no-login' }).returning({ id: authAccounts.id });
    if (!account) throw new Error('fixture_setup_failed');
    accountId = account.id;

    const [conversation] = await connected.db.insert(conversations).values({ accountId, title: 'Synthetic referral email check' }).returning({ id: conversations.id });
    if (!conversation) throw new Error('fixture_setup_failed');
    const [message] = await connected.db.insert(conversationMessages).values({
      conversationId: conversation.id, role: 'user', status: 'completed',
      content: 'Mensaje ficticio creado únicamente para validar la composición técnica de derivación.',
    }).returning({ id: conversationMessages.id });
    if (!message) throw new Error('fixture_setup_failed');
    conversationCreated = true;

    const notice = await ensureSyntheticReferralNotice(connected.db, now);
    createdNoticeId = notice.created ? notice.id : undefined;
    const consent = await new DrizzleConsentRepository(connected.db).recordDecision(
      accountId, 'psychological_referral_sharing', notice.id, 'granted', randomUUID(), now,
    );
    if (!consent) throw new Error('synthetic_consent_setup_failed');

    phase = 'isolated_http_preview';
    const jwt = new JwtAccessTokenService('synthetic-referral-email-check-secret-at-least-32-bytes', 'synthetic-referral-check', 'synthetic-referral-check', 600);
    const smtpMailer = new ImplicitTlsSmtpReferralMailer({
      host: process.env.PSYCHOLOGICAL_REFERRAL_SMTP_HOST,
      port: 465,
      username: process.env.PSYCHOLOGICAL_REFERRAL_SMTP_USERNAME,
      password: process.env.PSYCHOLOGICAL_REFERRAL_SMTP_PASSWORD,
      from: process.env.PSYCHOLOGICAL_REFERRAL_SMTP_FROM,
      timeoutMs: 15_000,
    });
    const mailer: ReferralMailer = {
      async send(message) {
        smtpAttempts += 1;
        try { return await smtpMailer.send(message); }
        catch (error) {
          if (error instanceof ReferralMailerError) smtpFailure = error.diagnostics;
          throw error;
        }
      },
    };
    const service = new PsychologicalReferralService(
      new DrizzlePsychologicalReferralRepository(connected.db), mailer,
      { enabled: true, deployment: 'synthetic_test', allowedAccountIds: [accountId], selectedTestRecipient: recipient,
        allowedTestRecipients: allowedRecipients, smtpConfigured: true },
    );
    const app = express();
    app.use(express.json({ limit: '8kb' }));
    app.use('/api/v1/me/psychological-referrals', createPsychologicalReferralRouter(jwt, service));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('http_composition_failed');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const token = await jwt.issue(accountId);
      const createResponse = await fetch(`${baseUrl}/api/v1/me/psychological-referrals`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ reason: 'Solicitud sintética de orientación para validar el envío de prueba.' }),
      });
      if (createResponse.status !== 201) throw new Error(`http_create_${createResponse.status}`);
      const created = await createResponse.json() as { referralId: string; previewHash: string; recipient: string; status: string };
      if (created.status !== 'draft' || created.recipient !== recipient || !/^[0-9a-f]{64}$/u.test(created.previewHash)) throw new Error('preview_validation_failed');
      referralPersisted = true;
      const previewResponse = await fetch(`${baseUrl}/api/v1/me/psychological-referrals/${created.referralId}`, { headers: { authorization: `Bearer ${token}` } });
      if (previewResponse.status !== 200) throw new Error(`http_preview_${previewResponse.status}`);
      const preview = await previewResponse.json() as { referralId: string; previewHash: string; recipient: string; status: string };
      if (preview.referralId !== created.referralId || preview.previewHash !== created.previewHash || preview.recipient !== recipient || preview.status !== 'draft') throw new Error('preview_changed');

      if (sendRequested) {
        phase = 'manual_send_confirmation';
        if (recipientConfirmation !== recipient) throw new Error('recipient_flag_mismatch');
        const readline = createInterface({ input: stdin, output: stdout });
        let answer = '';
        try { answer = await readline.question(`Confirme que revisó el reporte sintético y autoriza UN correo a ${recipient}. Escriba exactamente SEND ONE SYNTHETIC EMAIL TO ${recipient}: `); }
        finally { readline.close(); }
        if (answer !== `SEND ONE SYNTHETIC EMAIL TO ${recipient}`) {
          status = 'cancelled_without_send';
        } else {
          phase = 'pre_send_database_reverification';
          await verifyLiveDatabase(connected.pool, validatedUrl);
          if (!allowedRecipients.includes(recipient ?? '') || preview.recipient !== recipient) throw new Error('recipient_not_allowlisted');
          phase = 'http_send_once';
          if (sendRequests !== 0) throw new Error('send_request_limit_reached');
          sendRequests = 1;
          const sendResponse = await fetch(`${baseUrl}/api/v1/me/psychological-referrals/${created.referralId}/send`, {
            method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
            body: JSON.stringify({ confirmed: true, previewHash: preview.previewHash }),
          });
          if (sendResponse.status !== 200) throw new Error(`http_send_${sendResponse.status}`);
          const sent = await sendResponse.json() as { status: string; recipient: string; duplicate: boolean };
          if (sent.status !== 'sent' || sent.recipient !== recipient || sent.duplicate) throw new Error('send_result_unexpected');
          phase = 'verify_persisted_state';
          const verifyResponse = await fetch(`${baseUrl}/api/v1/me/psychological-referrals/${created.referralId}`, { headers: { authorization: `Bearer ${token}` } });
          if (verifyResponse.status !== 200 || (await verifyResponse.json() as { status: string }).status !== 'sent') throw new Error('sent_state_not_persisted');
          status = 'sent';
        }
      } else {
        status = 'preflight_ready_no_send';
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } catch (error) {
    status = 'failed';
    errorKind = safeErrorKind(error);
  } finally {
    if (connected) {
      try {
        if (accountId) await connected.db.delete(authAccounts).where(eq(authAccounts.id, accountId));
        if (createdNoticeId) await connected.db.delete(consentNoticeVersions).where(eq(consentNoticeVersions.id, createdNoticeId));
        cleanupSucceeded = true;
      } catch {
        cleanupSucceeded = false;
        if (status === 'sent') status = 'sent_cleanup_failed';
        else if (status !== 'failed') status = 'cleanup_failed';
      }
      await connected.pool.end().catch(() => { cleanupSucceeded = false; });
    }
    output({ status, phase, database: databaseVerified ? 'tesis_test_db' : null, recipient: destinationReady ? recipient ?? null : null,
      conversationCreated, referralPersisted, sendRequests, smtpAttempts, durationMs: Date.now() - startedAt, cleanupSucceeded,
      ...(smtpFailure ? {
        smtpFailureStage: smtpFailure.stage,
        ...(smtpFailure.smtpCode === undefined ? {} : { smtpCode: smtpFailure.smtpCode }),
        ...(smtpFailure.failureCode ? { smtpFailureCode: smtpFailure.failureCode } : {}),
        smtpDurationMs: smtpFailure.durationMs,
        acceptanceUncertain: smtpFailure.acceptanceUncertain,
      } : {}),
      ...(errorKind ? { errorKind } : {}) });
  }
}

async function verifyLiveDatabase(pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'], url: string): Promise<void> {
  validateTestDatabaseUrl(url);
  const result = await pool.query<{ database_name: string; server_address: string | null }>(
    'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address',
  );
  const target = result.rows[0];
  if (!target || target.database_name !== 'tesis_test_db' || !target.server_address || !isAllowedLoopbackAddress(target.server_address)) {
    throw new TestDatabaseSafetyError('Live PostgreSQL target is not the authorized loopback test database');
  }
}

async function ensureSyntheticReferralNotice(db: Awaited<ReturnType<typeof connectTestDatabase>>['db'], now: Date): Promise<{ id: string; created: boolean }> {
  const [current] = await db.select({ id: consentNoticeVersions.id, version: consentNoticeVersions.version, content: consentNoticeVersions.content })
    .from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, 'psychological_referral_sharing'), eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, now),
    )).limit(1);
  if (current) {
    if (!current.version.startsWith('test-') || !/synthetic|syntético|sintético/iu.test(current.content)) {
      throw new TestDatabaseSafetyError('Current referral notice is not a recognized synthetic fixture');
    }
    return { id: current.id, created: false };
  }
  const [anyCurrent] = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
    eq(consentNoticeVersions.purpose, 'psychological_referral_sharing'), eq(consentNoticeVersions.status, 'published'),
  )).limit(1);
  if (anyCurrent) throw new TestDatabaseSafetyError('A future or non-effective notice prevents safe synthetic setup');
  const id = randomUUID();
  const content = 'Synthetic-only test notice for psychological referral email check; not legal text and not for participants.';
  await db.insert(consentNoticeVersions).values({
    id, purpose: 'psychological_referral_sharing', version: `test-${randomUUID().slice(0, 16)}`,
    content, contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
    effectiveAt: new Date(now.getTime() - 60_000), status: 'published',
  });
  return { id, created: true };
}

function safeErrorKind(error: unknown): string {
  if (error instanceof TestDatabaseSafetyError) return `database_${error.kind}`;
  if (error instanceof Error && /^http_(create|preview|send)_\d{3}$/u.test(error.message)) return error.message;
  if (error instanceof Error && /^[a-z_]+$/u.test(error.message)) return error.message;
  return 'operation_failed';
}
