import type { ConsentPurpose } from '../../domain/model/consent.js';

/** Public application contract for other bounded contexts to ask whether a purpose is currently authorized. */
export interface ConsentPurposeChecker {
  execute(accountId: string, purpose: ConsentPurpose): Promise<boolean>;
}
