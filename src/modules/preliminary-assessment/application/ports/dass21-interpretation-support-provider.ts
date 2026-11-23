import type { ApprovedDass21InterpretationSupport } from '../../domain/model/dass21-internal-result.js';

/** Server-owned source of explicitly reviewed interpretation support; no HTTP input may supply it. */
export interface Dass21InterpretationSupportProvider {
  getApprovedSupport(instrumentVersionId: string): Promise<ApprovedDass21InterpretationSupport | null>;
}
