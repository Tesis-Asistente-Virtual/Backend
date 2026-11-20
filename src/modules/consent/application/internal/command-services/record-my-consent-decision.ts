import type { ConsentAction, ConsentPurpose } from '../../../domain/model/consent.js';
import type { ConsentRepository } from '../../../domain/repositories/consent-repository.js';
export class ConsentNoticeUnavailable extends Error { constructor() { super('Consent notice is unavailable'); this.name = 'ConsentNoticeUnavailable'; } }
export class RecordMyConsentDecision {
  constructor(private readonly repository: ConsentRepository, private readonly clock: () => Date = () => new Date()) {}
  async execute(accountId: string, input: { purpose: ConsentPurpose; noticeVersionId: string; action: ConsentAction; idempotencyKey: string }) {
    const event = await this.repository.recordDecision(accountId, input.purpose, input.noticeVersionId, input.action, input.idempotencyKey, this.clock());
    if (!event) throw new ConsentNoticeUnavailable();
    return event;
  }
}
