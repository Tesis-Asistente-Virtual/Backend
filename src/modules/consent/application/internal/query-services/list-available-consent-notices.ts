import type { ConsentRepository } from '../../../domain/repositories/consent-repository.js';
export class ListAvailableConsentNotices {
  constructor(private readonly repository: ConsentRepository, private readonly clock: () => Date = () => new Date()) {}
  execute() { return this.repository.listAvailableNotices(this.clock()); }
}
