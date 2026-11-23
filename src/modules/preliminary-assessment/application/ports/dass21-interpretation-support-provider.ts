import type { ApprovedDass21InterpretationSupport } from '../../domain/model/dass21-internal-result.js';

/** Server-owned source of explicitly reviewed interpretation support; no HTTP input may supply it. */
export interface Dass21InterpretationSupportProvider {
  /** Must be a local server-owned lookup; implementations must not call external services while a DB read is locked. */
  getApprovedSupport(instrumentVersionId: string): ApprovedDass21InterpretationSupport | null;
}
