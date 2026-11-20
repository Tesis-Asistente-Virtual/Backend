import type { ConsentPurpose } from '../../../domain/model/consent.js';
import type { ConsentRepository } from '../../../domain/repositories/consent-repository.js';

export class CheckConsentForPurpose {
  constructor(private readonly repository: ConsentRepository, private readonly clock: () => Date = () => new Date()) {}
  async execute(accountId: string, purpose: ConsentPurpose): Promise<boolean> {
    const status = await this.repository.getStatus(accountId, this.clock());
    return status.some(item => item.purpose === purpose && item.state === 'granted');
  }
}
