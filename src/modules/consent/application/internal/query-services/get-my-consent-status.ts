import type { ConsentRepository } from '../../../domain/repositories/consent-repository.js';
export class GetMyConsentStatus {
  constructor(private readonly repository: ConsentRepository, private readonly clock: () => Date = () => new Date()) {}
  execute(accountId: string) { return this.repository.getStatus(accountId, this.clock()); }
}
