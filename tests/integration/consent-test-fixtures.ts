import { createHash, randomUUID } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import type { connectTestDatabase } from './test-database.js';
import { DrizzleConsentRepository } from '../../src/modules/consent/infrastructure/persistence/drizzle-consent-repository.js';
import type { ConsentPurpose } from '../../src/modules/consent/domain/model/consent.js';
import { consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';

type TestDb = Awaited<ReturnType<typeof connectTestDatabase>>['db'];

/** Creates a clearly synthetic, reusable notice only in the guarded integration database. */
export async function ensureTestPublishedNotice(db: TestDb, purpose: ConsentPurpose): Promise<{ id: string }> {
  const now = new Date();
  const findCurrent = async () => {
    const [notice] = await db.select({ id: consentNoticeVersions.id }).from(consentNoticeVersions).where(and(
      eq(consentNoticeVersions.purpose, purpose),
      eq(consentNoticeVersions.status, 'published'),
      lte(consentNoticeVersions.effectiveAt, now),
    )).limit(1);
    return notice;
  };
  const current = await findCurrent();
  if (current) return current;

  const id = randomUUID();
  const content = `Integration test fixture for ${purpose}; synthetic only, not legal text.`;
  try {
    await db.insert(consentNoticeVersions).values({
      id,
      purpose,
      version: `test-${randomUUID().slice(0, 16)}`,
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      effectiveAt: new Date(now.getTime() - 60_000),
      status: 'draft',
    });
    await db.update(consentNoticeVersions).set({ status: 'published' }).where(eq(consentNoticeVersions.id, id));
    return { id };
  } catch (error) {
    // Another integration worker may have published the unique current notice first.
    const racedCurrent = await findCurrent();
    if (racedCurrent) return racedCurrent;
    throw error;
  }
}

export async function grantTestConsent(db: TestDb, accountId: string, purpose: ConsentPurpose): Promise<void> {
  const notice = await ensureTestPublishedNotice(db, purpose);
  const event = await new DrizzleConsentRepository(db).recordDecision(
    accountId, purpose, notice.id, 'granted', randomUUID(), new Date(),
  );
  if (!event) throw new Error('Synthetic test consent was not recorded');
}

export async function withdrawTestConsent(db: TestDb, accountId: string, purpose: ConsentPurpose): Promise<void> {
  const notice = await ensureTestPublishedNotice(db, purpose);
  const event = await new DrizzleConsentRepository(db).recordDecision(
    accountId, purpose, notice.id, 'withdrawn', randomUUID(), new Date(),
  );
  if (!event) throw new Error('Synthetic test consent withdrawal was not recorded');
}
