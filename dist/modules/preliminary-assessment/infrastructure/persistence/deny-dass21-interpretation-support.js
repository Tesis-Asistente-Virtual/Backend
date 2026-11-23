/** Default fail-closed provider until professional and study-specific support is explicitly approved. */
export class DenyDass21InterpretationSupport {
    getApprovedSupport(_instrumentVersionId) {
        return null;
    }
}
