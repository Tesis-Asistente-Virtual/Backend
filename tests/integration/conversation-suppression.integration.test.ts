import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { connectTestDatabase } from './test-database.js';
import { authAccounts } from '../../src/modules/authentication/infrastructure/persistence/schema.js';
import { accountConsentEvents, consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import { conversationalSignalAnalyses, conversationMessages, conversationSuppressionAudits, conversations } from '../../src/modules/conversations/infrastructure/persistence/schema.js';
import { DrizzleConversationRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-repository.js';
import { DrizzleConversationMessageRepository } from '../../src/modules/conversations/infrastructure/persistence/drizzle-conversation-message-repository.js';
import { ensureTestPublishedNotice, grantTestConsent, withdrawTestConsent } from './consent-test-fixtures.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = describe.skipIf(!enabled);
let pool: Awaited<ReturnType<typeof connectTestDatabase>>['pool'];
let db: Awaited<ReturnType<typeof connectTestDatabase>>['db'];
const accountIds = new Set<string>();
const runId = randomUUID();

async function createAccount(): Promise<string> {
  const [row] = await db.insert(authAccounts).values({ email: `suppression-${runId}-${randomUUID()}@example.test`, passwordHash: 'synthetic-integration-hash' }).returning({ id: authAccounts.id });
  if (!row) throw new Error('Synthetic account insert returned no ID');
  accountIds.add(row.id);
  return row.id;
}

beforeAll(async () => { if (enabled) ({ pool, db } = await connectTestDatabase()); });
afterEach(async () => {
  if (db && accountIds.size) await db.delete(authAccounts).where(inArray(authAccounts.id, [...accountIds]));
  accountIds.clear();
});
afterAll(async () => { if (pool) await pool.end(); });

suite('Conversation suppression PostgreSQL integration', () => {
  it('deletes only the owner conversation and cascaded content while preserving consent history and a minimal audit', async () => {
    const owner = await createAccount();
    const otherOwner = await createAccount();
    const repository = new DrizzleConversationRepository(db);
    const ownConversation = await repository.create({ accountId: owner });
    const otherConversation = await repository.create({ accountId: otherOwner });
    const messages = new DrizzleConversationMessageRepository(db);
    const ownMessage = await messages.createForOwner(owner, { conversationId: ownConversation.id, role: 'user', content: 'synthetic-private-message' });
    if (!ownMessage) throw new Error('Synthetic owner message was not persisted');
    const notice = await ensureTestPublishedNotice(db, 'conversational_signal_analysis');
    const [noticeVersion] = await db.select({ version: consentNoticeVersions.version }).from(consentNoticeVersions).where(eq(consentNoticeVersions.id, notice.id));
    if (!noticeVersion) throw new Error('Synthetic notice is unavailable');
    await db.insert(conversationalSignalAnalyses).values({
      accountId: owner, conversationId: ownConversation.id, consentNoticeVersionId: notice.id,
      analysisVersion: 'synthetic-test-1', modelVersion: 'fake-model', analyzedAt: new Date(),
      periodStart: null, periodEnd: null, expiresAt: new Date(Date.now() + 86_400_000), payload: { synthetic: true },
    });
    await grantTestConsent(db, owner, 'conversational_signal_analysis');
    await withdrawTestConsent(db, owner, 'conversational_signal_analysis');

    expect(await repository.deleteForOwner(owner, otherConversation.id)).toBe(false);
    expect(await repository.findByIdForOwner(otherConversation.id, otherOwner)).not.toBeNull();
    expect(await repository.deleteForOwner(owner, ownConversation.id)).toBe(true);
    expect(await repository.deleteForOwner(owner, ownConversation.id)).toBe(false);
    expect(await repository.findByIdForOwner(ownConversation.id, owner)).toBeNull();
    expect((await db.select().from(conversationMessages).where(eq(conversationMessages.id, ownMessage.id)))).toHaveLength(0);
    expect((await db.select().from(conversationalSignalAnalyses).where(eq(conversationalSignalAnalyses.conversationId, ownConversation.id)))).toHaveLength(0);
    expect((await db.select().from(conversations).where(eq(conversations.id, otherConversation.id)))).toHaveLength(1);
    expect((await db.select().from(accountConsentEvents).where(eq(accountConsentEvents.accountId, owner)))).toHaveLength(2);
    const auditRows = await db.select().from(conversationSuppressionAudits).where(eq(conversationSuppressionAudits.accountId, owner));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ deletedConversationCount: 1 });
    expect(auditRows[0]).not.toHaveProperty('conversationId');
  });
});
