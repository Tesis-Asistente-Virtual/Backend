const allowedProtocols = new Set(['http:', 'https:']);

export class CorsConfigurationError extends Error {
  constructor() {
    super('CORS_ALLOWED_ORIGINS must be a comma-separated list of exact HTTP(S) origins');
    this.name = 'CorsConfigurationError';
  }
}

/** Empty/unset disables cross-origin access. Values must be canonical origins, without paths or wildcards. */
export function parseCorsAllowedOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') return [];

  const entries = value.split(',').map(entry => entry.trim());
  if (entries.some(entry => entry === '' || entry.includes('*'))) throw new CorsConfigurationError();

  const origins = entries.map(entry => {
    let parsed: URL;
    try { parsed = new URL(entry); }
    catch { throw new CorsConfigurationError(); }
    if (!allowedProtocols.has(parsed.protocol) || parsed.origin !== entry || parsed.username !== '' || parsed.password !== '') {
      throw new CorsConfigurationError();
    }
    return parsed.origin;
  });

  if (new Set(origins).size !== origins.length) throw new CorsConfigurationError();
  return origins;
}

export const corsAllowedRequestMethods = ['GET', 'HEAD', 'POST', 'PATCH'] as const;
export const corsAllowedRequestHeaders = ['authorization', 'content-type'] as const;
