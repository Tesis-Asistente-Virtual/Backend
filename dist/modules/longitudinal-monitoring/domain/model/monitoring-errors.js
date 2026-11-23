export class MonitoringError extends Error {
    code;
    constructor(code) {
        super('Longitudinal monitoring operation failed');
        this.code = code;
        this.name = 'MonitoringError';
    }
}
