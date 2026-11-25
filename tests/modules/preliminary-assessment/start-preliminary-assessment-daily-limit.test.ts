import { describe, expect, it, vi } from 'vitest';
import { StartPreliminaryAssessment } from '../../../src/modules/preliminary-assessment/application/internal/command-services/start-preliminary-assessment.js';
import { PreliminaryAssessmentError } from '../../../src/modules/preliminary-assessment/domain/model/assessment-errors.js';

const NOTICE_ID = '11111111-1111-4111-8111-111111111111';
const INSTRUMENT_VERSION_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

function buildService(options: { previousCreatedAt?: Date; now: Date }) {
  const create = vi.fn(async () => undefined);
  const listByOwner = vi.fn(async () =>
    options.previousCreatedAt ? [{ createdAt: options.previousCreatedAt }] : [],
  );
  const service = new StartPreliminaryAssessment(
    { create, listByOwner } as never,
    {
      findAvailableByVersionId: vi.fn(async () => ({
        instrumentVersionId: INSTRUMENT_VERSION_ID,
        effectiveAt: new Date(2026, 0, 1),
      })),
    } as never,
    { getCurrentNoticeVersionId: vi.fn(async () => NOTICE_ID) } as never,
    () => options.now,
    () => true,
  );
  return { service, create };
}

describe('StartPreliminaryAssessment daily limit', () => {
  it('rejects a second assessment on the same calendar day', async () => {
    const { service, create } = buildService({
      previousCreatedAt: new Date(2026, 10, 25, 8, 0),
      now: new Date(2026, 10, 25, 20, 0),
    });

    const attempt = service.execute(ACCOUNT_ID, INSTRUMENT_VERSION_ID);

    await expect(attempt).rejects.toBeInstanceOf(PreliminaryAssessmentError);
    await expect(attempt).rejects.toMatchObject({ code: 'daily_limit_reached' });
    expect(create).not.toHaveBeenCalled();
  });

  it('allows a new assessment the next calendar day', async () => {
    const { service, create } = buildService({
      previousCreatedAt: new Date(2026, 10, 25, 23, 30),
      now: new Date(2026, 10, 26, 0, 10),
    });

    await service.execute(ACCOUNT_ID, INSTRUMENT_VERSION_ID);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('allows the first assessment when there is no previous one', async () => {
    const { service, create } = buildService({ now: new Date(2026, 10, 25, 9, 0) });

    await service.execute(ACCOUNT_ID, INSTRUMENT_VERSION_ID);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
