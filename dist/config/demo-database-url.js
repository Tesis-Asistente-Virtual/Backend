const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
export class DemoDatabaseConfigurationError extends Error {
    code;
    constructor(code) {
        super('Demo database configuration is invalid');
        this.code = code;
        this.name = 'DemoDatabaseConfigurationError';
    }
}
/** Accept only an explicit local PostgreSQL URL for the dedicated demo database. */
export function validateDemoDatabaseUrl(value, nodeEnv = process.env.NODE_ENV) {
    if (nodeEnv === 'production')
        throw new DemoDatabaseConfigurationError('production_mode');
    if (!value)
        throw new DemoDatabaseConfigurationError('missing_url');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new DemoDatabaseConfigurationError('invalid_url');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol))
        throw new DemoDatabaseConfigurationError('unsupported_protocol');
    if (url.pathname !== '/tesis_demo_db')
        throw new DemoDatabaseConfigurationError('wrong_database');
    const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (!localHosts.has(hostname))
        throw new DemoDatabaseConfigurationError('non_local_host');
    return value;
}
export function getDemoDatabaseUrl() {
    return validateDemoDatabaseUrl(process.env.DEMO_DATABASE_URL);
}
