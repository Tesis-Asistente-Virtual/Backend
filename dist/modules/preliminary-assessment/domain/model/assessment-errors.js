/** Safe domain error: its message and code never contain answers or other sensitive data. */
export class PreliminaryAssessmentError extends Error {
    code;
    constructor(code) {
        super('Preliminary assessment operation is invalid');
        this.code = code;
        this.name = 'PreliminaryAssessmentError';
    }
}
