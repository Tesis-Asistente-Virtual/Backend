import type { CurrentMonitoringAuthorization } from '../../domain/model/monitoring-contracts.js';

/** Reads current authorization for this purpose only; it never records or grants consent. */
export interface MonitoringConsentAuthorizer {
  getCurrentAuthorization(accountId: string): Promise<CurrentMonitoringAuthorization | null>;
}
