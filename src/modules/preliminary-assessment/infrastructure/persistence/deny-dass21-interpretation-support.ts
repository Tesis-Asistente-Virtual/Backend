import type { Dass21InterpretationSupportProvider } from '../../application/ports/dass21-interpretation-support-provider.js';

/** Default fail-closed provider until professional and study-specific support is explicitly approved. */
export class DenyDass21InterpretationSupport implements Dass21InterpretationSupportProvider {
  getApprovedSupport(_instrumentVersionId: string) {
    return null;
  }
}
