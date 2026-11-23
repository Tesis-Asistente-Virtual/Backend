import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { connectTestDatabase } from './test-database.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { conversationMessages, conversations } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { StreamConversationMessage } from '../../src/modules/conversations/application/internal/command-services/stream-conversation-message.js';
import { SendConversationMessage } from '../../src/modules/conversations/application/internal/command-services/send-conversation-message.js';
import { PostgresConversationTurnLock } from '../../src/modules/conversations/infrastructure/persistence/postgres-conversation-turn-lock.js';
import type { AiTextGenerator } from '../../src/modules/conversations/application/ports/ai-text-generator.js';
import { ConversationTurnInProgress } from '../../src/modules/conversations/application/ports/conversation-turn-lock.js';
import { ConversationsController } from '../../src/modules/conversations/interfaces/rest/resources/conversations-controller.js';
import { CreateConversation } from '../../src/modules/conversations/application/internal/command-services/create-conversation.js';
import { GetConversation } from '../../src/modules/conversations/application/internal/query-services/get-conversation.js';
import { ListConversations } from '../../src/modules/conversations/application/internal/query-services/list-conversations.js';
import { ListConversationMessages } from '../../src/modules/conversations/application/internal/query-services/list-conversation-messages.js';
import { JwtAccessTokenService } from '../../src/modules/authentication/infrastructure/security/jwt-access-token-service.js';
import { authenticationMiddleware } from '../../src/shared/infrastructure/http/authentication-middleware.js';
import { errorHandler } from '../../src/shared/infrastructure/http/error-handler.js';
import { createCorsMiddleware } from '../../src/shared/infrastructure/http/cors-middleware.js';
import { CheckConsentForPurpose } from '../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { ConsentConversationProcessingAuthorizer } from '../../src/modules/conversations/infrastructure/persistence/consent-conversation-processing-authorizer.js';
import { grantTestConsent, withdrawTestConsent } from './consent-test-fixtures.js';

const runId = randomUUID();
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
const accountIds = new Set<string>();
const emails = new Set<string>();
let gateFirstStream = false;
let failNextStream = false;
let providerCalls = 0;
const frontendOrigin = 'http://frontend.synthetic.test';
let firstDeltaReady = deferred();
let releaseFirstDelta = deferred();

async function createOwner(withConsent = true): Promise<{ id: string; conversationId: string }> {
  const email = `conversation-stream-it-${runId}-${randomUUID()}@example.test`;
  emails.add(email);
  const [account] = await db.insert(authAccounts).values({ email, passwordHash: 'integration-test-hash' }).returning({ id: authAccounts.id });
  if (!account) throw new Error('Integration account insert returned no row');
  accountIds.add(account.id);
  if (withConsent) await grantTestConsent(db, account.id, 'ai_conversation_processing');
  const conversation = await new DrizzleConversationRepository(db).create({ accountId: account.id });
  return { id: account.id, conversationId: conversation.id };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeAll(async () => {
  ({ pool, db } = await connectTestDatabase());
  const conversationsRepository = new DrizzleConversationRepository(db);
  const messagesRepository = new DrizzleConversationMessageRepository(db);
  const turnLock = new PostgresConversationTurnLock(pool);
  const conversationConsent = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(new DrizzleConsentRepository(db)));
  const generator: AiTextGenerator = {
    generateText: async () => { providerCalls += 1; return { text: 'REST answer' }; },
    async *streamText() {
      providerCalls += 1;
      if (failNextStream) { failNextStream = false; throw new Error('synthetic provider failure'); }
      yield { type: 'delta', text: 'SSE ' };
      if (gateFirstStream) { firstDeltaReady.resolve(); await releaseFirstDelta.promise; }
      yield { type: 'delta', text: 'answer' };
      yield { type: 'completed', result: { text: 'SSE answer' } };
    },
  };
  const streamService = new StreamConversationMessage(conversationsRepository, messagesRepository, generator, turnLock, 10, 200, conversationConsent);
  const restService = new SendConversationMessage(conversationsRepository, messagesRepository, generator, turnLock, 10, 200, conversationConsent);
  const controller = new ConversationsController(
    new CreateConversation(conversationsRepository), new ListConversations(conversationsRepository),
    new GetConversation(conversationsRepository), new ListConversationMessages(conversationsRepository, messagesRepository),
    restService, streamService,
  );
  const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
  const app = express();
  app.use(createCorsMiddleware([frontendOrigin]));
  app.use(express.json());
  app.post('/api/v1/conversations/:id/messages', authenticationMiddleware(jwt), (req, res, next) => { void controller.sendConversationMessage(req, res).catch(next); });
  app.post('/api/v1/conversations/:id/messages/stream', authenticationMiddleware(jwt), (req, res, next) => { void controller.streamConversationMessage(req, res).catch(next); });
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server?.once('listening', resolve); server?.once('error', reject); });
});

afterEach(async () => {
  gateFirstStream = false;
  failNextStream = false;
  providerCalls = 0;
  releaseFirstDelta.resolve();
  if (!db) return;
  try {
    if (accountIds.size) await db.delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
    if (emails.size) await db.delete(authAccounts).where(inArray(authAccounts.email, [...emails]));
  } finally { accountIds.clear(); emails.clear(); }
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
  if (pool) await pool.end();
});

describe('Conversation SSE PostgreSQL integration', () => {
  it('answers CORS preflight for an allowed origin and denies an unlisted origin', async () => {
    const address = server?.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/v1/conversations/synthetic/messages/stream`;
    const allowed = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: frontendOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(allowed.headers.get('vary')).toContain('Origin');
    expect(allowed.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();

    const denied = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://unlisted.synthetic.test',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('streams incrementally over HTTP and persists one user and one completed assistant message', async () => {
    const owner = await createOwner();
    gateFirstStream = true;
    firstDeltaReady = deferred();
    releaseFirstDelta = deferred();
    const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
    const token = await jwt.issue(owner.id);
    const address = server?.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${owner.conversationId}/messages/stream`, {
      method: 'POST', headers: { Origin: frontendOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'A private student message' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(response.headers.get('vary')).toContain('Origin');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SSE response body is unavailable');
    await firstDeltaReady.promise;
    let partialBody = '';
    while (!partialBody.includes('event: message.delta')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE stream ended before its first delta');
      partialBody += new TextDecoder().decode(chunk.value);
    }
    expect(partialBody).toContain('event: message.started');
    expect(partialBody).toContain('data: {"text":"SSE "}');
    expect(partialBody).not.toContain('stream.completed');
    releaseFirstDelta.resolve();
    let body = partialBody;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += new TextDecoder().decode(chunk.value);
    }
    gateFirstStream = false;
    expect(body).toContain('data: {"text":"answer"}');
    expect(body).toContain('event: message.started');
    expect(body).toContain('event: message.completed');
    expect(body).toContain('event: stream.completed');
    expect(body.indexOf('event: message.started')).toBeLessThan(body.indexOf('event: message.delta'));
    expect(body.indexOf('event: message.completed')).toBeLessThan(body.indexOf('event: stream.completed'));
    const rows = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, owner.conversationId));
    expect(rows.map(row => [row.role, row.status, row.content])).toEqual([
      ['user', 'completed', 'A private student message'], ['assistant', 'completed', 'SSE answer'],
    ]);
  });

  it('keeps JWT mandatory on an allowed CORS origin', async () => {
    const owner = await createOwner();
    const address = server?.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${owner.conversationId}/messages/stream`, {
      method: 'POST', headers: { Origin: frontendOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'synthetic unauthorized request' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, owner.conversationId))).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });

  it('accepts an authenticated REST message from an allowed CORS origin', async () => {
    const owner = await createOwner();
    const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
    const token = await jwt.issue(owner.id);
    const address = server?.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${owner.conversationId}/messages`, {
      method: 'POST', headers: { Origin: frontendOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'synthetic authorized REST message' }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(await response.json()).toMatchObject({
      userMessage: { content: 'synthetic authorized REST message', role: 'user' },
      assistantMessage: { content: 'REST answer', role: 'assistant' },
    });
    expect(providerCalls).toBe(1);
  });

  it('formats stream.error over an allowed-origin SSE response without exposing provider details', async () => {
    const owner = await createOwner();
    const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
    const token = await jwt.issue(owner.id);
    const address = server?.address() as AddressInfo;
    failNextStream = true;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${owner.conversationId}/messages/stream`, {
      method: 'POST', headers: { Origin: frontendOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'synthetic provider failure case' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    const body = await response.text();
    expect(body).toContain('event: message.started\ndata: {"messageId":');
    expect(body).toContain('event: stream.error\ndata: {"code":"generation_failed"}');
    expect(body.indexOf('event: message.started')).toBeLessThan(body.indexOf('event: stream.error'));
    expect(body).not.toContain('synthetic provider failure');
    expect(body).not.toContain('stream.completed');
  });

  it('holds the shared PostgreSQL advisory lock across stream generation and releases it after a failure', async () => {
    const owner = await createOwner();
    const conversationsRepository = new DrizzleConversationRepository(db);
    const messagesRepository = new DrizzleConversationMessageRepository(db);
    const turnLock = new PostgresConversationTurnLock(pool);
    const started = deferred(); const continueGeneration = deferred();
    const eventTypes: string[] = [];
    const generator: AiTextGenerator = {
      generateText: async () => ({ text: 'rest' }),
      async *streamText() { started.resolve(); await continueGeneration.promise; throw new Error('provider failed'); },
    };
    const conversationConsent = new ConsentConversationProcessingAuthorizer(new CheckConsentForPurpose(new DrizzleConsentRepository(db)));
    const streaming = new StreamConversationMessage(conversationsRepository, messagesRepository, generator, turnLock, 10, 200, conversationConsent);
    const rest = new SendConversationMessage(conversationsRepository, messagesRepository, generator, turnLock, 10, 200, conversationConsent);
    const abort = new AbortController();
    const streamPromise = streaming.execute(owner.id, owner.conversationId, 'stream input', abort.signal, {
      onReady: async () => {}, emit: async event => { eventTypes.push(event.type); },
    });
    await started.promise;
    await expect(rest.execute(owner.id, owner.conversationId, 'competing input')).rejects.toBeInstanceOf(ConversationTurnInProgress);
    continueGeneration.resolve();
    await expect(streamPromise).resolves.toBeUndefined();
    expect(eventTypes).toContain('stream.error');
    expect(eventTypes).not.toContain('message.completed');
    expect(eventTypes).not.toContain('stream.completed');
    await expect(rest.execute(owner.id, owner.conversationId, 'after failure')).resolves.toMatchObject({ assistantMessage: { status: 'completed' } });
    const rows = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, owner.conversationId));
    expect(rows.some(row => row.role === 'assistant' && row.status === 'failed')).toBe(true);
  });

  it('returns a non-disclosing 404 when the authenticated account targets another owner’s conversation', async () => {
    const ownerA = await createOwner();
    const ownerB = await createOwner();
    const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
    const token = await jwt.issue(ownerB.id);
    const address = server?.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${ownerA.conversationId}/messages/stream`, {
      method: 'POST', headers: { Origin: frontendOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'must not be stored' }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(await response.json()).toEqual({ error: 'Conversation not found' });
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, ownerA.conversationId))).toHaveLength(0);
  });

  it('denies REST before persisting or invoking the provider when consent is absent', async () => {
    const owner = await createOwner(false);
    const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
    const token = await jwt.issue(owner.id);
    const address = server?.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${owner.conversationId}/messages`, {
      method: 'POST', headers: { Origin: frontendOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'must not be stored' }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(await response.json()).toEqual({ error: 'Current ai_conversation_processing consent is required' });
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, owner.conversationId))).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });

  it('denies SSE before event-stream headers after consent withdrawal', async () => {
    const owner = await createOwner();
    await withdrawTestConsent(db, owner.id, 'ai_conversation_processing');
    const jwt = new JwtAccessTokenService('integration-only-secret-with-at-least-32-characters', 'integration-test', 'integration-test-client', 300);
    const token = await jwt.issue(owner.id);
    const address = server?.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/conversations/${owner.conversationId}/messages/stream`, {
      method: 'POST', headers: { Origin: frontendOrigin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'must not be stored' }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
    expect(await response.json()).toEqual({ error: 'Current ai_conversation_processing consent is required' });
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, owner.conversationId))).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });
});
