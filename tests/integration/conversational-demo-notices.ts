import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { ConsentPurpose } from '../../src/modules/consent/domain/model/consent.js';
import { consentNoticeVersions } from '../../src/modules/consent/infrastructure/persistence/schema.js';
import type { connectTestDatabase } from './test-database.js';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>['db'];
type DemoPurpose = 'ai_conversation_processing' | 'structured_signal_extraction';
type DemoErrorKind = 'database_unreachable' | 'schema_missing' | 'fixture_conflict' | 'constraint_violation' | 'permission_denied' | 'unknown_database_failure';
type DemoErrorStage = 'connect' | 'fixture_transaction';

const demoLabel = 'SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS.';

export const conversationalDemoNotices = [
  {
    purpose: 'ai_conversation_processing',
    version: 'demo-4c3-ai-v1',
    content: `${demoLabel} Aviso técnico sintético para demostrar procesamiento conversacional solamente en tesis_test_db. No es un aviso jurídico, no autoriza el uso con estudiantes reales y no se deben ingresar datos reales.`,
  },
  {
    purpose: 'structured_signal_extraction',
    version: 'demo-4c3-signals-v1',
    content: `${demoLabel} Aviso técnico sintético para demostrar extracción estructurada solamente en tesis_test_db. No es un aviso jurídico, no autoriza el uso con estudiantes reales y no se deben ingresar datos reales.`,
  },
] as const satisfies readonly { purpose: ConsentPurpose; version: string; content: string }[];

export type DemoConsentPurpose = typeof conversationalDemoNotices[number]['purpose'];

interface NoticeRecord {
  id: string;
  purpose: DemoPurpose;
  version: string;
  content: string;
  contentHash: string;
  status: 'draft' | 'published' | 'superseded';
  effectiveAt: Date;
}

export interface DemoNoticeTransaction {
  acquireSeedLock(): Promise<void>;
  listByPurpose(purpose: DemoPurpose): Promise<NoticeRecord[]>;
  insertDraft(fixture: (typeof conversationalDemoNotices)[number], contentHash: string, effectiveAt: Date): Promise<string | undefined>;
  publishDraft(id: string): Promise<boolean>;
}

export interface DemoNoticeStore {
  transaction<T>(work: (tx: DemoNoticeTransaction) => Promise<T>): Promise<T>;
}

export class DemoNoticeSeedError extends Error {
  constructor(
    readonly errorKind: DemoErrorKind,
    readonly stage: DemoErrorStage,
    readonly reason?: DemoFixtureConflictReason,
  ) {
    super('Demo notice setup failed safely');
    this.name = 'DemoNoticeSeedError';
  }
}

export type DemoFixtureConflictReason =
  | 'published_notice_incompatible'
  | 'multiple_published_notices'
  | 'version_duplicate'
  | 'draft_content_mismatch'
  | 'content_hash_mismatch'
  | 'effective_date_in_future'
  | 'fixture_id_occupied'
  | 'fixture_missing';

export interface DemoNoticeDiagnostic {
  purpose: DemoPurpose;
  version: string;
  status: NoticeRecord['status'] | 'missing' | 'multiple_published';
  compatible: boolean;
  reason: DemoFixtureConflictReason | 'already_published' | 'ready_to_publish' | 'ready_to_create';
  /** Internal persistence ID; callers must not log or expose it. */
  noticeId?: string;
  action: 'reuse' | 'publish' | 'create' | 'conflict';
}

export type SafeDemoNoticeDiagnostic = Pick<DemoNoticeDiagnostic, 'purpose' | 'version' | 'status' | 'compatible' | 'reason'>;

export function toSafeDemoNoticeDiagnostic(diagnostic: DemoNoticeDiagnostic): SafeDemoNoticeDiagnostic {
  const { purpose, version, status, compatible, reason } = diagnostic;
  return { purpose, version, status, compatible, reason };
}

export function inspectDemoNoticeFixture(
  fixture: (typeof conversationalDemoNotices)[number],
  rows: readonly NoticeRecord[],
  now: Date,
): DemoNoticeDiagnostic {
  const purpose = fixture.purpose as DemoPurpose;
  const expectedHash = createHash('sha256').update(fixture.content).digest('hex');
  const publishedRows = rows.filter(row => row.status === 'published');
  if (publishedRows.length > 1) return { purpose, version: fixture.version, status: 'multiple_published', compatible: false, reason: 'multiple_published_notices', action: 'conflict' };

  const published = publishedRows[0];
  if (published) {
    if (published.version !== fixture.version || published.content !== fixture.content) {
      return { purpose, version: fixture.version, status: published.status, compatible: false, reason: 'published_notice_incompatible', noticeId: published.id, action: 'conflict' };
    }
    if (published.contentHash !== expectedHash) {
      return { purpose, version: fixture.version, status: published.status, compatible: false, reason: 'content_hash_mismatch', noticeId: published.id, action: 'conflict' };
    }
    if (published.effectiveAt > now) {
      return { purpose, version: fixture.version, status: published.status, compatible: false, reason: 'effective_date_in_future', noticeId: published.id, action: 'conflict' };
    }
    return { purpose, version: fixture.version, status: published.status, compatible: true, reason: 'already_published', noticeId: published.id, action: 'reuse' };
  }

  const sameVersion = rows.find(row => row.version === fixture.version);
  if (sameVersion) {
    if (sameVersion.status !== 'draft') {
      return { purpose, version: fixture.version, status: sameVersion.status, compatible: false, reason: 'version_duplicate', noticeId: sameVersion.id, action: 'conflict' };
    }
    if (sameVersion.content !== fixture.content) {
      return { purpose, version: fixture.version, status: sameVersion.status, compatible: false, reason: 'draft_content_mismatch', noticeId: sameVersion.id, action: 'conflict' };
    }
    if (sameVersion.contentHash !== expectedHash) {
      return { purpose, version: fixture.version, status: sameVersion.status, compatible: false, reason: 'content_hash_mismatch', noticeId: sameVersion.id, action: 'conflict' };
    }
    if (sameVersion.effectiveAt > now) {
      return { purpose, version: fixture.version, status: sameVersion.status, compatible: false, reason: 'effective_date_in_future', noticeId: sameVersion.id, action: 'conflict' };
    }
    return { purpose, version: fixture.version, status: sameVersion.status, compatible: true, reason: 'ready_to_publish', noticeId: sameVersion.id, action: 'publish' };
  }

  return { purpose, version: fixture.version, status: 'missing', compatible: true, reason: 'ready_to_create', action: 'create' };
}

function driverCode(error: unknown, depth = 0): string | undefined {
  if (typeof error !== 'object' || error === null || depth > 2) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? driverCode(error.cause, depth + 1) : undefined;
}

export function classifyDemoNoticeFailure(error: unknown, stage: DemoErrorStage): DemoNoticeSeedError {
  if (error instanceof DemoNoticeSeedError) return error;
  const code = driverCode(error);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code?.startsWith('08')) {
    return new DemoNoticeSeedError('database_unreachable', stage);
  }
  if (code === '42P01' || code === '42703') return new DemoNoticeSeedError('schema_missing', stage);
  if (code === '42501' || code === '28P01') return new DemoNoticeSeedError('permission_denied', stage);
  if (code?.startsWith('23')) return new DemoNoticeSeedError('constraint_violation', stage);
  return new DemoNoticeSeedError('unknown_database_failure', stage);
}

export function createDrizzleDemoNoticeStore(db: TestDatabase): DemoNoticeStore {
  return {
    transaction: work => db.transaction(async tx => work({
      acquireSeedLock: async () => { await tx.execute(sql`select pg_advisory_xact_lock(420043)`); },
      listByPurpose: async purpose => {
        const rows = await tx.select().from(consentNoticeVersions).where(eq(consentNoticeVersions.purpose, purpose));
        return rows as NoticeRecord[];
      },
      insertDraft: async (fixture, contentHash, effectiveAt) => {
        const [row] = await tx.insert(consentNoticeVersions).values({
          purpose: fixture.purpose,
          version: fixture.version,
          content: fixture.content,
          contentHash,
          effectiveAt,
          status: 'draft',
        }).returning({ id: consentNoticeVersions.id });
        return row?.id;
      },
      publishDraft: async id => {
        const rows = await tx.update(consentNoticeVersions)
          .set({ status: 'published' })
          .where(and(eq(consentNoticeVersions.id, id), eq(consentNoticeVersions.status, 'draft')))
          .returning({ id: consentNoticeVersions.id });
        return rows.length === 1;
      },
    })),
  };
}

/** Read-only snapshot inspection; this function never starts a transaction or writes rows. */
export async function diagnoseConversationalDemoNotices(
  db: TestDatabase,
  clock: () => Date = () => new Date(),
): Promise<SafeDemoNoticeDiagnostic[]> {
  const now = clock();
  const diagnostics: SafeDemoNoticeDiagnostic[] = [];
  for (const fixture of conversationalDemoNotices) {
    const rows = await db.select().from(consentNoticeVersions)
      .where(eq(consentNoticeVersions.purpose, fixture.purpose));
    diagnostics.push(toSafeDemoNoticeDiagnostic(inspectDemoNoticeFixture(fixture, rows as NoticeRecord[], now)));
  }
  return diagnostics;
}

/** Published notices are immutable and are never overwritten, superseded, or deleted. */
export async function ensureConversationalDemoNotices(
  store: DemoNoticeStore,
  clock: () => Date = () => new Date(),
): Promise<Readonly<Record<DemoPurpose, string>>> {
  try {
    return await store.transaction(async tx => {
      await tx.acquireSeedLock();
      const now = clock();
      const result = {} as Record<DemoPurpose, string>;
      const plans: Array<{
        fixture: (typeof conversationalDemoNotices)[number];
        purpose: DemoPurpose;
        contentHash: string;
        inspection: DemoNoticeDiagnostic;
      }> = [];
      const toPublish: Array<{ id: string; purpose: DemoPurpose }> = [];

      // Inspect every purpose before making any write, so conflicts fail before draft insertion.
      for (const fixture of conversationalDemoNotices) {
        const purpose = fixture.purpose as DemoPurpose;
        const contentHash = createHash('sha256').update(fixture.content).digest('hex');
        const inspection = inspectDemoNoticeFixture(fixture, await tx.listByPurpose(purpose), now);
        if (inspection.action === 'conflict') {
          throw new DemoNoticeSeedError('fixture_conflict', 'fixture_transaction', inspection.reason as DemoFixtureConflictReason);
        }
        plans.push({ fixture, purpose, contentHash, inspection });
      }

      for (const plan of plans) {
        const { fixture, purpose, contentHash, inspection } = plan;
        if (inspection.action === 'reuse') {
          if (!inspection.noticeId) throw new DemoNoticeSeedError('unknown_database_failure', 'fixture_transaction');
          result[purpose] = inspection.noticeId;
          continue;
        }

        if (inspection.action === 'publish') {
          if (!inspection.noticeId) throw new DemoNoticeSeedError('unknown_database_failure', 'fixture_transaction');
          toPublish.push({ id: inspection.noticeId, purpose });
          result[purpose] = inspection.noticeId;
          continue;
        }

        const id = await tx.insertDraft(fixture, contentHash, new Date(now.getTime() - 60_000));
        if (!id) throw new DemoNoticeSeedError('unknown_database_failure', 'fixture_transaction');
        toPublish.push({ id, purpose });
        result[purpose] = id;
      }

      for (const item of toPublish) {
        if (!await tx.publishDraft(item.id)) throw new DemoNoticeSeedError('fixture_conflict', 'fixture_transaction');
      }

      return result;
    });
  } catch (error) {
    throw classifyDemoNoticeFailure(error, 'fixture_transaction');
  }
}
