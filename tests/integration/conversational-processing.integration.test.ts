import { randomUUID, createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, lte } from 'drizzle-orm';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { consentNoticeVersions, accountConsentEvents } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import type { ConsentPurpose } from '../../src/modules/consent/domain/model/consent.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import { CheckConsentForPurpose } from '../../src/modules/consent/application/internal/query-services/check-consent-for-purpose.js';
import type { ConsentPurposeChecker } from '../../src/modules/consent/application/ports/consent-purpose-checker.js';
import { conversations, conversationMessages } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import type { ConversationSignalExtractor, ExtractConversationSignalsInput } from '../../src/modules/conversational-processing/application/ports/conversation-signal-extractor.js';
import { ExtractAuthorizedConversationSignals, SignalConsentRequired, SignalConversationNotFound, SignalMessageReferencesInvalid } from '../../src/modules/conversational-processing/application/internal/command-services/extract-authorized-conversation-signals.js';
import { connectTestDatabase } from './test-database.js';

const requiredPurposes = ['structured_signal_extraction', 'ai_conversation_processing'] as const;
type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];

describe('Authorized conversation signal extraction PostgreSQL integration', () => {
  let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
  let db: TestDb;
  const accountIds = new Set<string>();
  const draftNoticeIds = new Set<string>();
  const notices = new Map<ConsentPurpose, string>();

  async function createAccount(): Promise<string> {
    const id = randomUUID();
    await db.insert(authAccounts).values({
      id,
      email: `signal-it-${randomUUID()}@example.test`,
      passwordHash: 'integration-test-only-hash',
    });
    accountIds.add(id);
    return id;
  }

  async function ensurePublishedNotice(purpose: ConsentPurpose): Promise<string> {
    const cached = notices.get(purpose);
    if (cached) return cached;
    const now = new Date();
    const [existing] = await db.select({ id: consentNoticeVersions.id })
      .from(consentNoticeVersions)
      .where(and(
        eq(consentNoticeVersions.purpose, purpose),
        eq(consentNoticeVersions.status, 'published'),
        lte(consentNoticeVersions.effectiveAt, now),
      )).limit(1);
    if (existing) {
      notices.set(purpose, existing.id);
      return existing.id;
    }

    // Published fixtures are immutable, deliberately non-legal, and retained only in guarded tesis_test_db.
    const id = randomUUID();
    const content = `Integration fixture for ${purpose}; not legal text.`;
    const contentHash = createHash('sha256').update(content).digest('hex');
    try {
      const [draft] = await db.insert(consentNoticeVersions).values({
        id,
        purpose,
        version: `test-${randomUUID().slice(0, 16)}`,
        content,
        contentHash,
        effectiveAt: new Date(Date.now() - 60_000),
        status: 'draft',
      }).returning({ id: consentNoticeVersions.id });
      if (!draft) throw new Error('Could not create test notice fixture');
      draftNoticeIds.add(id);
      await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
      draftNoticeIds.delete(id);
      notices.set(purpose, id);
      return id;
    } catch (error) {
      if (draftNoticeIds.delete(id)) {
        await db.delete(consentNoticeVersions).where(and(eq(consentNoticeVersions.id, id), eq(consentNoticeVersions.status, 'draft')));
      }
      // Other integration files may publish the purpose at the same time; reuse only a verified
      // currently effective notice, and propagate unrelated failures unchanged.
      const [racedNotice] = await db.select({ id: consentNoticeVersions.id })
        .from(consentNoticeVersions)
        .where(and(
          eq(consentNoticeVersions.purpose, purpose),
          eq(consentNoticeVersions.status, 'published'),
          lte(consentNoticeVersions.effectiveAt, new Date()),
        )).limit(1);
      if (!racedNotice) throw error;
      notices.set(purpose, racedNotice.id);
      return racedNotice.id;
    }
  }

  async function grant(accountId: string, purpose: ConsentPurpose): Promise<void> {
    const repository = new DrizzleConsentRepository(db);
    const event = await repository.recordDecision(
      accountId,
      purpose,
      await ensurePublishedNotice(purpose),
      'granted',
      randomUUID(),
      new Date(),
    );
    if (!event) throw new Error('Test consent grant was not accepted');
  }

  async function grantBoth(accountId: string): Promise<void> {
    for (const purpose of requiredPurposes) await grant(accountId, purpose);
  }

  async function decision(accountId: string, purpose: ConsentPurpose, action: 'declined' | 'withdrawn'): Promise<void> {
    const event = await new DrizzleConsentRepository(db).recordDecision(
      accountId,
      purpose,
      await ensurePublishedNotice(purpose),
      action,
      randomUUID(),
      new Date(),
    );
    if (!event) throw new Error('Test consent decision was not accepted');
  }

  async function createConversation(accountId: string): Promise<string> {
    return (await new DrizzleConversationRepository(db).create({ accountId })).id;
  }

  async function insertMessage(input: {
    id?: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    status?: 'generating' | 'completed' | 'failed';
    createdAt: Date;
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    await db.insert(conversationMessages).values({ ...input, id });
    return id;
  }

  function makeExtractor() {
    const received: ExtractConversationSignalsInput[] = [];
    const extractor: ConversationSignalExtractor = {
      extract: async input => {
        received.push(input);
        return { schemaVersion: '1.0', observations: [], missingInformation: [], clarificationQuestions: [] };
      },
    };
    return { extractor, received };
  }

  function useCase(extractor: ConversationSignalExtractor, consent?: ConsentPurposeChecker) {
    return new ExtractAuthorizedConversationSignals(
      new DrizzleConversationRepository(db),
      new DrizzleConversationMessageRepository(db),
      consent ?? new CheckConsentForPurpose(new DrizzleConsentRepository(db)),
      extractor,
    );
  }

  beforeAll(async () => {
    // connectTestDatabase enforces TEST_DATABASE_URL, loopback server identity, and tesis_test_db.
    ({ pool, db } = await connectTestDatabase());
    await Promise.all(requiredPurposes.map(ensurePublishedNotice));
  }, 15_000);

  afterEach(async () => {
    const ids = [...accountIds];
    accountIds.clear();
    if (ids.length > 0) await pool.query('DELETE FROM auth_accounts WHERE id = ANY($1::uuid[])', [ids]);

    // Only unpublished drafts owned by this test run are removable; published notices are immutable.
    const drafts = [...draftNoticeIds];
    draftNoticeIds.clear();
    if (drafts.length > 0) await pool.query("DELETE FROM consent_notice_versions WHERE id = ANY($1::uuid[]) AND status = 'draft'", [drafts]);
  });

  afterAll(async () => { await pool?.end(); });

  it('allows the owner with both purposes and sends only requested completed messages in deterministic order', async () => {
    const ownerId = await createAccount();
    await grantBoth(ownerId);
    const conversationId = await createConversation(ownerId);
    const early = await insertMessage({ conversationId, role: 'user', content: 'Earlier selected test message', createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const late = await insertMessage({ conversationId, role: 'assistant', content: 'Later selected test answer', createdAt: new Date('2026-01-01T00:00:01.000Z') });
    await insertMessage({ conversationId, role: 'user', content: 'Unrequested test message', createdAt: new Date('2026-01-01T00:00:02.000Z') });
    await insertMessage({ conversationId, role: 'assistant', content: '', status: 'failed', createdAt: new Date('2026-01-01T00:00:03.000Z') });
    const { extractor, received } = makeExtractor();

    await expect(useCase(extractor).execute(ownerId, { conversationId, messageIds: [late, early] }))
      .resolves.toMatchObject({ schemaVersion: '1.0', observations: [] });

    expect(received).toHaveLength(1);
    expect(received[0]?.messages).toEqual([
      { messageId: early, role: 'user', content: 'Earlier selected test message' },
      { messageId: late, role: 'assistant', content: 'Later selected test answer' },
    ]);
    const persistedCount = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversationId));
    expect(persistedCount).toHaveLength(4);
  });

  it('denies a foreign or nonexistent conversation before any extractor call', async () => {
    const ownerId = await createAccount();
    const otherId = await createAccount();
    await grantBoth(otherId);
    const conversationId = await createConversation(ownerId);
    const messageId = await insertMessage({ conversationId, role: 'user', content: 'Private fixture message', createdAt: new Date() });
    const { extractor, received } = makeExtractor();
    const service = useCase(extractor);

    await expect(service.execute(otherId, { conversationId, messageIds: [messageId] })).rejects.toBeInstanceOf(SignalConversationNotFound);
    await expect(service.execute(otherId, { conversationId: randomUUID(), messageIds: [messageId] })).rejects.toBeInstanceOf(SignalConversationNotFound);
    expect(received).toHaveLength(0);
  });

  it('rejects foreign, mismatched, incomplete, duplicated, and invalid message references without extraction', async () => {
    const ownerId = await createAccount();
    const otherId = await createAccount();
    await grantBoth(ownerId);
    const conversationId = await createConversation(ownerId);
    const secondConversationId = await createConversation(ownerId);
    const otherConversationId = await createConversation(otherId);
    const ownMessage = await insertMessage({ conversationId, role: 'user', content: 'Owned completed fixture', createdAt: new Date() });
    const otherConversationMessage = await insertMessage({ conversationId: secondConversationId, role: 'user', content: 'Different conversation fixture', createdAt: new Date() });
    const otherMessage = await insertMessage({ conversationId: otherConversationId, role: 'user', content: 'Foreign fixture', createdAt: new Date() });
    const generatingMessage = await insertMessage({ conversationId, role: 'assistant', content: '', status: 'generating', createdAt: new Date() });
    const failedMessage = await insertMessage({ conversationId, role: 'assistant', content: '', status: 'failed', createdAt: new Date() });
    const { extractor, received } = makeExtractor();
    const service = useCase(extractor);

    await expect(service.execute(ownerId, { conversationId, messageIds: [otherMessage] })).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    await expect(service.execute(ownerId, { conversationId, messageIds: [otherConversationMessage] })).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    await expect(service.execute(ownerId, { conversationId, messageIds: [generatingMessage] })).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    await expect(service.execute(ownerId, { conversationId, messageIds: [failedMessage] })).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    await expect(service.execute(ownerId, { conversationId, messageIds: [ownMessage, randomUUID()] })).rejects.toBeInstanceOf(SignalMessageReferencesInvalid);
    await expect(service.execute(ownerId, { conversationId, messageIds: [ownMessage, ownMessage] })).rejects.toThrow();
    await expect(service.execute(ownerId, { conversationId, messageIds: ['not-a-uuid'] })).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it('requires each purpose independently and denies declined or withdrawn decisions', async () => {
    const scenarios: Array<{ name: string; prepare: (accountId: string) => Promise<void> }> = [
      { name: 'both absent', prepare: async () => {} },
      { name: 'structured extraction absent', prepare: accountId => grant(accountId, 'ai_conversation_processing') },
      { name: 'AI processing absent', prepare: accountId => grant(accountId, 'structured_signal_extraction') },
      { name: 'structured extraction declined', prepare: async accountId => { await grantBoth(accountId); await decision(accountId, 'structured_signal_extraction', 'declined'); } },
      { name: 'AI processing withdrawn', prepare: async accountId => { await grantBoth(accountId); await decision(accountId, 'ai_conversation_processing', 'withdrawn'); } },
    ];

    for (const scenario of scenarios) {
      const accountId = await createAccount();
      await scenario.prepare(accountId);
      const conversationId = await createConversation(accountId);
      const messageId = await insertMessage({ conversationId, role: 'user', content: `Fictional ${scenario.name} message`, createdAt: new Date() });
      const { extractor, received } = makeExtractor();
      await expect(useCase(extractor).execute(accountId, { conversationId, messageIds: [messageId] })).rejects.toBeInstanceOf(SignalConsentRequired);
      expect(received, scenario.name).toHaveLength(0);
    }
  });

  it('denies a grant tied to a superseded notice version', async () => {
    const accountId = await createAccount();
    await grant(accountId, 'ai_conversation_processing');
    const staleNoticeId = randomUUID();
    const content = 'Superseded integration-only consent notice fixture.';
    await db.insert(consentNoticeVersions).values({
      id: staleNoticeId,
      purpose: 'structured_signal_extraction',
      version: `old-${randomUUID().slice(0, 16)}`,
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      effectiveAt: new Date(Date.now() - 120_000),
      status: 'superseded',
    });
    await db.insert(accountConsentEvents).values({
      accountId,
      purpose: 'structured_signal_extraction',
      noticeVersionId: staleNoticeId,
      action: 'granted',
      idempotencyKey: randomUUID(),
    });
    const conversationId = await createConversation(accountId);
    const messageId = await insertMessage({ conversationId, role: 'user', content: 'Versioned consent fixture', createdAt: new Date() });
    const { extractor, received } = makeExtractor();

    await expect(useCase(extractor).execute(accountId, { conversationId, messageIds: [messageId] })).rejects.toBeInstanceOf(SignalConsentRequired);
    expect(received).toHaveLength(0);
  });

  it('fails closed when the consent checker errors', async () => {
    const accountId = await createAccount();
    await grantBoth(accountId);
    const conversationId = await createConversation(accountId);
    const messageId = await insertMessage({ conversationId, role: 'user', content: 'Consent lookup error fixture', createdAt: new Date() });
    const { extractor, received } = makeExtractor();
    const failedConsent: ConsentPurposeChecker = { execute: async () => { throw new Error('test-only consent store failure'); } };

    await expect(useCase(extractor, failedConsent).execute(accountId, { conversationId, messageIds: [messageId] })).rejects.toThrow('test-only consent store failure');
    expect(received).toHaveLength(0);
  });

  it('rechecks both database consents immediately before extraction and stops if consent was withdrawn', async () => {
    const accountId = await createAccount();
    await grantBoth(accountId);
    const conversationId = await createConversation(accountId);
    const messageId = await insertMessage({ conversationId, role: 'user', content: 'Consent recheck fixture', createdAt: new Date() });
    const actualChecker = new CheckConsentForPurpose(new DrizzleConsentRepository(db));
    const calls = new Map<ConsentPurpose, number>();
    const recheckWithWithdrawal: ConsentPurposeChecker = {
      execute: async (checkedAccountId, purpose) => {
        const count = (calls.get(purpose) ?? 0) + 1;
        calls.set(purpose, count);
        if (purpose === 'structured_signal_extraction' && count === 2) {
          await decision(checkedAccountId, purpose, 'withdrawn');
        }
        return actualChecker.execute(checkedAccountId, purpose);
      },
    };
    const { extractor, received } = makeExtractor();

    await expect(useCase(extractor, recheckWithWithdrawal).execute(accountId, { conversationId, messageIds: [messageId] })).rejects.toBeInstanceOf(SignalConsentRequired);
    expect(calls.get('structured_signal_extraction')).toBe(2);
    expect(calls.get('ai_conversation_processing')).toBe(1);
    expect(received).toHaveLength(0);
  });
});
