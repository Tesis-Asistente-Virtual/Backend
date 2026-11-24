const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
export class StagingDatabaseSafetyError extends Error {
    code;
    constructor(code) {
        super(code === 'configuration'
            ? 'STAGING_DATABASE_URL must identify local tesis_staging_db; no fallback is permitted'
            : 'Connected database is not the authorized local tesis_staging_db');
        this.code = code;
        this.name = 'StagingDatabaseSafetyError';
    }
}
/** Dedicated staging URL guard. It never reads DATABASE_URL, TEST_DATABASE_URL, or DEMO_DATABASE_URL. */
export function validateStagingDatabaseUrl(value, nodeEnv = process.env.NODE_ENV) {
    if (nodeEnv === 'production' || !value)
        throw new StagingDatabaseSafetyError('configuration');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new StagingDatabaseSafetyError('configuration');
    }
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/tesis_staging_db' ||
        !loopbackHosts.has(host) || url.search || url.hash || !url.username || !url.password) {
        throw new StagingDatabaseSafetyError('configuration');
    }
    return value;
}
export function isStagingLoopbackAddress(address) {
    if (!address)
        return false;
    const normalized = address.replace(/\/(?:32|128)$/, '');
    return normalized === '127.0.0.1' || normalized === '::1';
}
