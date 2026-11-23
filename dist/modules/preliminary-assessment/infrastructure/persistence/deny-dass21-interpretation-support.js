/** Default fail-closed provider until professional and study-specific support is explicitly approved. */
export class DenyDass21InterpretationSupport {
    async getApprovedSupport(_instrumentVersionId) {
        return null;
    }
}
