import { describe, expect, it, vi } from 'vitest';
import { PurgeExpiredConversationalSignalAnalyses } from '../../../src/modules/conversational-processing/application/internal/command-services/purge-expired-conversational-signal-analyses.js';

describe('PurgeExpiredConversationalSignalAnalyses', () => {
  it('passes a bounded cutoff and batch size to the repository', async () => {
    const asOf = new Date('2026-11-24T12:00:00.000Z');
    const purgeExpiredBatch = vi.fn(async () => 3);
    const service = new PurgeExpiredConversationalSignalAnalyses({ purgeExpiredBatch });

    await expect(service.execute({ asOf, limit: 100 })).resolves.toBe(3);
    expect(purgeExpiredBatch).toHaveBeenCalledWith(asOf, 100, undefined);
  });

  it('supports an explicit owner scope for account-bound retention operations', async () => {
    const asOf = new Date('2026-11-24T12:00:00.000Z');
    const ownerAccountId = '2d1f07b8-2194-4cf8-99cf-3274c3ea62f5';
    const purgeExpiredBatch = vi.fn(async () => 1);
    const service = new PurgeExpiredConversationalSignalAnalyses({ purgeExpiredBatch });
    await expect(service.execute({ asOf, limit: 1, ownerAccountId })).resolves.toBe(1);
    expect(purgeExpiredBatch).toHaveBeenCalledWith(asOf, 1, ownerAccountId);
  });

  it.each([
    { asOf: new Date(Number.NaN), limit: 10 },
    { asOf: new Date(), limit: 0 },
    { asOf: new Date(), limit: 501 },
    { asOf: new Date(), limit: 1.5 },
  ])('rejects invalid cutoff/batch values: %#', async input => {
    const purgeExpiredBatch = vi.fn(async () => 0);
    const service = new PurgeExpiredConversationalSignalAnalyses({ purgeExpiredBatch });
    expect(() => service.execute(input)).toThrow();
    expect(purgeExpiredBatch).not.toHaveBeenCalled();
  });
});
