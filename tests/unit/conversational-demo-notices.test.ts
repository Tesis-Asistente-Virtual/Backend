import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyDemoNoticeFailure,
  conversationalDemoNotices,
  ensureConversationalDemoNotices,
  inspectDemoNoticeFixture,
  toSafeDemoNoticeDiagnostic,
  type DemoConsentPurpose,
  type DemoNoticeStore,
  type DemoNoticeTransaction,
} from '../integration/conversational-demo-notices.js';

type Notice = {
  id: string;
  purpose: DemoConsentPurpose;
  version: string;
  content: string;
  contentHash: string;
  status: 'draft' | 'published' | 'superseded';
  effectiveAt: Date;
};

function mockStore(initial: Notice[] = [], options: { insertError?: unknown; publishErrorAt?: number } = {}) {
  let rows = initial.map(row => ({ ...row }));
  let nextId = 1;
  let insertCount = 0;
  let publishCount = 0;
  const store: DemoNoticeStore = {
    transaction: async work => {
      const transactionRows = rows.map(row => ({ ...row }));
      const tx: DemoNoticeTransaction = {
        acquireSeedLock: async () => undefined,
        listByPurpose: async purpose => transactionRows.filter(row => row.purpose === purpose),
        insertDraft: async (fixture, contentHash, effectiveAt) => {
          if (options.insertError) throw options.insertError;
          const id = `synthetic-notice-${nextId++}`;
          insertCount += 1;
          transactionRows.push({ ...fixture, id, contentHash, effectiveAt, purpose: fixture.purpose, status: 'draft' });
          return id;
        },
        publishDraft: async id => {
          publishCount += 1;
          if (options.publishErrorAt === publishCount) throw Object.assign(new Error('simulated database constraint'), { code: '23514' });
          const row = transactionRows.find(candidate => candidate.id === id && candidate.status === 'draft');
          if (!row) return false;
          if (transactionRows.some(candidate => candidate.purpose === row.purpose && candidate.status === 'published')) {
            throw Object.assign(new Error('simulated unique constraint'), { code: '23505' });
          }
          row.status = 'published';
          return true;
        },
      };
      const value = await work(tx);
      rows = transactionRows;
      return value;
    },
  };
  return { store, rows: () => rows.map(row => ({ ...row })), counts: () => ({ insertCount, publishCount }) };
}

describe('synthetic conversational consent notice seeder', () => {
  const fixedNow = () => new Date('2026-11-21T12:00:00.000Z');

  it('inserts and publishes both valid synthetic fixtures transactionally', async () => {
    const mock = mockStore();
    const ids = await ensureConversationalDemoNotices(mock.store, fixedNow);
    expect(Object.keys(ids)).toHaveLength(4);
    expect(mock.rows()).toHaveLength(4);
    expect(mock.rows().every(row => row.status === 'published' && row.effectiveAt < fixedNow())).toBe(true);
  });

  it('rejects a conflicting published notice without changing it', async () => {
    const mock = mockStore([{
      id: 'synthetic-existing',
      purpose: 'ai_conversation_processing',
      version: 'different-version',
      content: 'synthetic conflicting notice',
      contentHash: '0'.repeat(64),
      status: 'published',
      effectiveAt: new Date('2026-11-20T12:00:00.000Z'),
    }]);
    await expect(ensureConversationalDemoNotices(mock.store, fixedNow)).rejects.toMatchObject({ errorKind: 'fixture_conflict', stage: 'fixture_transaction' });
    expect(mock.rows()[0]?.content).toBe('synthetic conflicting notice');
    expect(mock.rows()).toHaveLength(1);
  });

  it('preflights both purposes before inserting any draft', async () => {
    const fixture = conversationalDemoNotices[1];
    const mock = mockStore([{
      id: 'synthetic-conflict',
      purpose: fixture.purpose,
      version: 'different-version',
      content: 'synthetic conflicting notice',
      contentHash: createHash('sha256').update(fixture.content).digest('hex'),
      status: 'published',
      effectiveAt: new Date('2026-11-20T12:00:00.000Z'),
    }]);
    await expect(ensureConversationalDemoNotices(mock.store, fixedNow)).rejects.toMatchObject({ reason: 'published_notice_incompatible' });
    expect(mock.counts().insertCount).toBe(0);
  });

  it('is idempotent on a repeated run', async () => {
    const mock = mockStore();
    const first = await ensureConversationalDemoNotices(mock.store, fixedNow);
    const firstCounts = mock.counts();
    const second = await ensureConversationalDemoNotices(mock.store, fixedNow);
    expect(second).toEqual(first);
    expect(mock.counts()).toEqual(firstCounts);
    expect(mock.rows()).toHaveLength(4);
  });

  it('classifies a PostgreSQL constraint failure and rolls back all synthetic inserts', async () => {
    const mock = mockStore([], { publishErrorAt: 2 });
    await expect(ensureConversationalDemoNotices(mock.store, fixedNow)).rejects.toMatchObject({ errorKind: 'constraint_violation' });
    expect(mock.rows()).toEqual([]);
  });

  it('classifies connection failures without exposing the driver message', () => {
    const error = Object.assign(new Error('password and connection string must not leak'), { code: 'ECONNREFUSED' });
    const classified = classifyDemoNoticeFailure(error, 'connect');
    expect(classified).toMatchObject({ errorKind: 'database_unreachable', stage: 'connect' });
    expect(classified.message).not.toContain('password');
    expect(classified.message).not.toContain('connection string');
  });

  it('classifies missing schema and permission errors using safe SQLSTATE categories', () => {
    expect(classifyDemoNoticeFailure({ code: '42P01' }, 'fixture_transaction').errorKind).toBe('schema_missing');
    expect(classifyDemoNoticeFailure({ code: '42501' }, 'fixture_transaction').errorKind).toBe('permission_denied');
    expect(classifyDemoNoticeFailure({ cause: { code: '23505' } }, 'fixture_transaction').errorKind).toBe('constraint_violation');
  });

  it('keeps the fixtures explicitly synthetic and restricted to the demo purposes', () => {
    expect(conversationalDemoNotices.map(notice => notice.purpose)).toEqual([
      'ai_conversation_processing',
      'structured_signal_extraction',
      'preliminary_assessment',
      'longitudinal_monitoring',
    ]);
    expect(conversationalDemoNotices.map(notice => notice.version)).toEqual([
      'demo-4c3-ai-v1',
      'demo-4c3-signals-v1',
      'demo-5a1-assessment-v1',
      'demo-5a1-monitoring-v1',
    ]);
    expect(conversationalDemoNotices.every(notice => notice.content.includes('SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS.'))).toBe(true);
    expect(conversationalDemoNotices[0]?.content).toBe('SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS. Aviso técnico sintético para demostrar procesamiento conversacional solamente en tesis_test_db. No es un aviso jurídico, no autoriza el uso con estudiantes reales y no se deben ingresar datos reales.');
    expect(conversationalDemoNotices[1]?.content).toBe('SOLO DEMOSTRACIÓN / NO APROBACIÓN LEGAL / DATOS FICTICIOS. Aviso técnico sintético para demostrar extracción estructurada solamente en tesis_test_db. No es un aviso jurídico, no autoriza el uso con estudiantes reales y no se deben ingresar datos reales.');
  });

  it('distinguishes incompatible published notices, duplicate versions, and draft conflicts without exposing IDs', () => {
    const fixture = conversationalDemoNotices[0];
    const now = fixedNow();
    const base = {
      id: 'hidden-synthetic-id',
      purpose: fixture.purpose,
      version: fixture.version,
      content: fixture.content,
      contentHash: createHash('sha256').update(fixture.content).digest('hex'),
      status: 'published' as const,
      effectiveAt: new Date('2026-11-20T12:00:00.000Z'),
    };
    expect(inspectDemoNoticeFixture(fixture, [{ ...base, version: 'other-v1' }], now).reason)
      .toBe('published_notice_incompatible');
    expect(inspectDemoNoticeFixture(fixture, [{ ...base, status: 'superseded' }], now).reason)
      .toBe('version_duplicate');
    expect(inspectDemoNoticeFixture(fixture, [{ ...base, status: 'draft', content: 'different synthetic content', contentHash: '1'.repeat(64) }], now).reason)
      .toBe('draft_content_mismatch');
    const future = inspectDemoNoticeFixture(fixture, [{ ...base, effectiveAt: new Date('2026-11-22T12:00:00.000Z') }], now);
    expect(future.reason).toBe('effective_date_in_future');
    expect(JSON.stringify(toSafeDemoNoticeDiagnostic(future))).not.toContain('hidden-synthetic-id');
  });

  it('detects fixture hash drift and multiple published rows as separate conflicts', () => {
    const fixture = conversationalDemoNotices[0];
    const row = {
      id: 'synthetic-id',
      purpose: fixture.purpose,
      version: fixture.version,
      content: fixture.content,
      contentHash: '0'.repeat(64),
      status: 'published' as const,
      effectiveAt: new Date('2026-11-20T12:00:00.000Z'),
    };
    expect(inspectDemoNoticeFixture(fixture, [row], fixedNow()).reason).toBe('content_hash_mismatch');
    expect(inspectDemoNoticeFixture(fixture, [row, { ...row, id: 'another-id' }], fixedNow()).reason)
      .toBe('multiple_published_notices');
  });
});
