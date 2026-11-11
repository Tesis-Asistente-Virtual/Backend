import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { connectTestDatabase } from './test-database.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { conversationMessages, conversations } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { SendConversationMessage } from '../../src/modules/conversations/application/internal/command-services/send-conversation-message.js';
import { PostgresConversationTurnLock } from '../../src/modules/conversations/infrastructure/persistence/postgres-conversation-turn-lock.js';
import type { AiTextGenerationRequest, AiTextGenerator } from '../../src/modules/conversations/application/ports/ai-text-generator.js';
import { ConversationTurnInProgress } from '../../src/modules/conversations/application/ports/conversation-turn-lock.js';

const runId = randomUUID();
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const accountIds = new Set<string>();
const emails = new Set<string>();

function newEmail(): string {
  const email = `conversation-it-${runId}-${randomUUID()}@example.test`;
  emails.add(email);
  return email;
}

async function createAccount(): Promise<{ id: string; email: string }> {
  const email = newEmail();
  const [account] = await db.insert(authAccounts).values({ email, passwordHash: 'integration-test-hash' }).returning({ id: authAccounts.id });
  if (!account) throw new Error('Integration test account insert returned no id');
  accountIds.add(account.id);
  return { id: account.id, email };
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.cause === 'object' && value.cause !== null) {
    const cause = value.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return typeof value.code === 'string' ? value.code : undefined;
}

async function expectPostgresCode(operation: Promise<unknown>, code: string): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL SQLSTATE ${code}`);
  } catch (error) {
    expect(postgresCode(error)).toBe(code);
  }
}

beforeAll(async () => { ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (!db) return;
  try {
    if (accountIds.size) await db.delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
    if (emails.size) await db.delete(authAccounts).where(inArray(authAccounts.email, [...emails]));
  } finally {
    accountIds.clear();
    emails.clear();
  }
});
afterAll(async () => { if (pool) await pool.end(); });

describe('Conversations PostgreSQL integration', () => {
  it('creates multiple owner-bound conversations and persists defaults and timestamps', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const repository = new DrizzleConversationRepository(db);
    const first = await repository.create({ accountId: owner.id, title: null });
    const second = await repository.create({ accountId: owner.id, title: 'Seguimiento' });
    const otherConversation = await repository.create({ accountId: other.id, title: 'Privada' });

    expect(first).toMatchObject({ accountId: owner.id, title: null, status: 'active' });
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.updatedAt).toBeInstanceOf(Date);
    expect(second.accountId).toBe(owner.id);
    expect(second.id).not.toBe(first.id);
    const ownerPage = await repository.listByOwner(owner.id, { limit: 20, offset: 0 });
    expect(ownerPage.items).toEqual(expect.arrayContaining([first, second]));
    expect(ownerPage.items).toHaveLength(2);
    expect(await repository.findByIdForOwner(otherConversation.id, owner.id)).toBeNull();
    const [stored] = await db.select().from(conversations).where(eq(conversations.id, first.id));
    expect(stored?.accountId).toBe(owner.id);
    expect(stored?.status).toBe('active');
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.updatedAt).toBeInstanceOf(Date);
  });

  it('persists roles, content and all message statuses, and orders equal timestamps by id', async () => {
    const owner = await createAccount();
    const conversation = await new DrizzleConversationRepository(db).create({ accountId: owner.id });
    const messages = new DrizzleConversationMessageRepository(db);
    const userMessage = await messages.createForOwner(owner.id, { conversationId: conversation.id, role: 'user', content: 'Hola', status: 'completed' });
    const assistantMessage = await messages.createForOwner(owner.id, { conversationId: conversation.id, role: 'assistant', content: 'Respuesta', status: 'completed' });
    const generatingMessage = await messages.createForOwner(owner.id, { conversationId: conversation.id, role: 'assistant', content: '', status: 'generating' });
    const failedMessage = await messages.createForOwner(owner.id, { conversationId: conversation.id, role: 'assistant', content: '', status: 'failed' });
    expect(userMessage?.content).toBe('Hola');
    expect(assistantMessage?.content).toBe('Respuesta');
    expect(generatingMessage).toMatchObject({ status: 'generating', content: '' });
    expect(failedMessage).toMatchObject({ status: 'failed', content: '' });
    expect((await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id))).map(message => message.conversationId))
      .toEqual([conversation.id, conversation.id, conversation.id, conversation.id]);

    const tiedTime = new Date('2026-01-02T03:04:05.000Z');
    const tiedIdPrefix = randomUUID().slice(0, 24);
    const lowId = `${tiedIdPrefix}000000000001`;
    const highId = `${tiedIdPrefix}000000000002`;
    await db.insert(conversationMessages).values([
      { id: highId, conversationId: conversation.id, role: 'assistant', content: 'B', status: 'completed', createdAt: tiedTime },
      { id: lowId, conversationId: conversation.id, role: 'user', content: 'A', status: 'completed', createdAt: tiedTime },
    ]);
    const ordered = (await messages.listByConversationForOwner(conversation.id, owner.id, { limit: 20, offset: 0 })).items;
    const tiedMessages = ordered.filter(message => message.createdAt.getTime() === tiedTime.getTime());
    expect(tiedMessages.map(message => message.id)).toEqual([lowId, highId]);
    expect(ordered.map(message => message.createdAt.getTime())).toEqual([...ordered.map(message => message.createdAt.getTime())].sort((a, b) => a - b));
  });

  it('does not expose another account’s conversations or messages through owner-scoped repositories', async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();
    const conversationsRepository = new DrizzleConversationRepository(db);
    const messagesRepository = new DrizzleConversationMessageRepository(db);
    const privateConversation = await conversationsRepository.create({ accountId: accountA.id });
    await messagesRepository.createForOwner(accountA.id, { conversationId: privateConversation.id, role: 'user', content: 'Private test content' });

    expect((await conversationsRepository.listByOwner(accountB.id, { limit: 20, offset: 0 })).items).toEqual([]);
    expect(await conversationsRepository.findByIdForOwner(privateConversation.id, accountB.id)).toBeNull();
    expect((await messagesRepository.listByConversationForOwner(privateConversation.id, accountB.id, { limit: 20, offset: 0 })).items).toEqual([]);
    expect(await messagesRepository.createForOwner(accountB.id, { conversationId: privateConversation.id, role: 'user', content: 'Unauthorized attempt' })).toBeNull();
    expect((await messagesRepository.listByConversationForOwner(privateConversation.id, accountA.id, { limit: 20, offset: 0 })).items).toHaveLength(1);
  });

  it('paginates conversations and messages in stable database order', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const conversationRepository = new DrizzleConversationRepository(db);
    const messageRepository = new DrizzleConversationMessageRepository(db);
    const older = await conversationRepository.create({ accountId: owner.id });
    const newestTieA = await conversationRepository.create({ accountId: owner.id });
    const newestTieB = await conversationRepository.create({ accountId: owner.id });
    await conversationRepository.create({ accountId: other.id });
    const olderTime = new Date('2026-02-01T00:00:00.000Z');
    const newestTime = new Date('2026-02-02T00:00:00.000Z');
    await db.update(conversations).set({ createdAt: olderTime }).where(eq(conversations.id, older.id));
    await db.update(conversations).set({ createdAt: newestTime }).where(inArray(conversations.id, [newestTieA.id, newestTieB.id]));

    const firstConversationPage = await conversationRepository.listByOwner(owner.id, { limit: 2, offset: 0 });
    const secondConversationPage = await conversationRepository.listByOwner(owner.id, { limit: 2, offset: 2 });
    const expectedTieOrder = [newestTieA.id, newestTieB.id].sort((left, right) => right.localeCompare(left));
    expect(firstConversationPage.items.map(item => item.id)).toEqual([...expectedTieOrder]);
    expect(firstConversationPage.hasMore).toBe(true);
    expect(secondConversationPage.items.map(item => item.id)).toEqual([older.id]);
    expect(secondConversationPage.hasMore).toBe(false);

    const selectedConversation = newestTieA;
    const messageA = await messageRepository.createForOwner(owner.id, { conversationId: selectedConversation.id, role: 'user', content: 'first' });
    const messageB = await messageRepository.createForOwner(owner.id, { conversationId: selectedConversation.id, role: 'assistant', content: 'second' });
    const messageC = await messageRepository.createForOwner(owner.id, { conversationId: selectedConversation.id, role: 'assistant', content: 'third' });
    if (!messageA || !messageB || !messageC) throw new Error('Owner-scoped test message insert failed');
    const sharedTime = new Date('2026-03-01T00:00:00.000Z');
    const laterTime = new Date('2026-03-02T00:00:00.000Z');
    await db.update(conversationMessages).set({ createdAt: sharedTime }).where(inArray(conversationMessages.id, [messageA.id, messageB.id]));
    await db.update(conversationMessages).set({ createdAt: laterTime }).where(eq(conversationMessages.id, messageC.id));
    const firstMessagePage = await messageRepository.listByConversationForOwner(selectedConversation.id, owner.id, { limit: 2, offset: 0 });
    const secondMessagePage = await messageRepository.listByConversationForOwner(selectedConversation.id, owner.id, { limit: 2, offset: 2 });
    expect(firstMessagePage.items.map(item => item.id)).toEqual([messageA.id, messageB.id].sort());
    expect(firstMessagePage.hasMore).toBe(true);
    expect(secondMessagePage.items.map(item => item.id)).toEqual([messageC.id]);
    expect(secondMessagePage.hasMore).toBe(false);
  });

  it('persists a complete message turn and builds provider context from only this owner’s completed messages', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const conversationRepository = new DrizzleConversationRepository(db);
    const messageRepository = new DrizzleConversationMessageRepository(db);
    const conversation = await conversationRepository.create({ accountId: owner.id });
    const otherConversation = await conversationRepository.create({ accountId: other.id });
    await messageRepository.createForOwner(owner.id, { conversationId: conversation.id, role: 'user', content: 'Earlier turn' });
    await messageRepository.createForOwner(owner.id, { conversationId: conversation.id, role: 'assistant', content: 'Earlier answer' });
    await messageRepository.createForOwner(owner.id, { conversationId: conversation.id, role: 'assistant', content: '', status: 'failed' });
    await messageRepository.createForOwner(other.id, { conversationId: otherConversation.id, role: 'user', content: 'Other account private content' });
    let context: AiTextGenerationRequest | undefined;
    const generator: AiTextGenerator = { generateText: async request => { context = request; return { text: 'Generated test answer' }; } };
    const service = new SendConversationMessage(conversationRepository, messageRepository, generator, new PostgresConversationTurnLock(pool), 10, 200);

    const result = await service.execute(owner.id, conversation.id, 'Current student question');
    expect(result.userMessage).toMatchObject({ role: 'user', content: 'Current student question', status: 'completed' });
    expect(result.assistantMessage).toMatchObject({ role: 'assistant', content: 'Generated test answer', status: 'completed' });
    expect(context?.messages.map(item => item.content)).toEqual(['Earlier turn', 'Earlier answer', 'Current student question']);
    expect(context?.messages.filter(item => item.content === 'Current student question')).toHaveLength(1);
    expect(context?.messages.some(item => item.content.includes('Other account'))).toBe(false);
    const stored = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
    expect(stored.map(item => [item.role, item.status])).toContainEqual(['user', 'completed']);
    expect(stored.map(item => [item.role, item.status])).toContainEqual(['assistant', 'completed']);
    expect(stored.filter(item => item.content === 'Current student question')).toHaveLength(1);
  });

  it('serializes concurrent turns with PostgreSQL advisory locks and rejects a competing request', async () => {
    const owner = await createAccount();
    const conversation = await new DrizzleConversationRepository(db).create({ accountId: owner.id });
    const messageRepository = new DrizzleConversationMessageRepository(db);
    let announceProviderStarted: () => void = () => {};
    let releaseProvider: () => void = () => {};
    const providerStarted = new Promise<void>(resolve => { announceProviderStarted = resolve; });
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    let providerCalls = 0;
    const generator: AiTextGenerator = {
      generateText: async () => { providerCalls += 1; announceProviderStarted(); await providerGate; return { text: 'One serialized answer' }; },
    };
    const service = new SendConversationMessage(
      new DrizzleConversationRepository(db), messageRepository, generator,
      new PostgresConversationTurnLock(pool), 10, 200,
    );

    const firstTurn = service.execute(owner.id, conversation.id, 'First concurrent message');
    await providerStarted;
    await expect(service.execute(owner.id, conversation.id, 'Second concurrent message')).rejects.toBeInstanceOf(ConversationTurnInProgress);
    releaseProvider();
    await expect(firstTurn).resolves.toMatchObject({ assistantMessage: { status: 'completed' } });
    expect(providerCalls).toBe(1);
    const rows = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
    expect(rows.filter(row => row.role === 'user')).toHaveLength(1);
    expect(rows.filter(row => row.role === 'assistant' && row.status === 'completed')).toHaveLength(1);
  });

  it('enforces PostgreSQL foreign keys and status/role checks', async () => {
    const owner = await createAccount();
    const conversation = await new DrizzleConversationRepository(db).create({ accountId: owner.id });

    await expectPostgresCode(db.insert(conversations).values({ accountId: randomUUID() }), '23503');
    await expectPostgresCode(db.insert(conversationMessages).values({ conversationId: randomUUID(), role: 'user', content: 'x' }), '23503');
    await expectPostgresCode(db.insert(conversations).values({ accountId: owner.id, status: 'deleted' }), '23514');
    await expectPostgresCode(db.insert(conversationMessages).values({ conversationId: conversation.id, role: 'system', content: 'x' }), '23514');
    await expectPostgresCode(db.insert(conversationMessages).values({ conversationId: conversation.id, role: 'user', content: 'x', status: 'queued' }), '23514');
  });

  it('cascades deletion from a conversation to its messages and from an account to all conversation data', async () => {
    const owner = await createAccount();
    const repository = new DrizzleConversationRepository(db);
    const messages = new DrizzleConversationMessageRepository(db);
    const explicitlyDeleted = await repository.create({ accountId: owner.id });
    await messages.createForOwner(owner.id, { conversationId: explicitlyDeleted.id, role: 'user', content: 'cleanup case' });
    await db.delete(conversations).where(eq(conversations.id, explicitlyDeleted.id));
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, explicitlyDeleted.id))).toHaveLength(0);

    const accountCascade = await repository.create({ accountId: owner.id });
    await messages.createForOwner(owner.id, { conversationId: accountCascade.id, role: 'assistant', content: '', status: 'failed' });
    await db.delete(authAccounts).where(eq(authAccounts.id, owner.id));
    accountIds.delete(owner.id);
    expect(await db.select().from(conversations).where(eq(conversations.id, accountCascade.id))).toHaveLength(0);
    expect(await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, accountCascade.id))).toHaveLength(0);
  });
});
