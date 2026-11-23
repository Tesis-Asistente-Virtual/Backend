import type { RequestHandler } from 'express';
import { corsAllowedRequestHeaders, corsAllowedRequestMethods } from '../../../config/cors.js';

const methods = new Set<string>(corsAllowedRequestMethods);
const headers = new Set<string>(corsAllowedRequestHeaders);

function isAllowedPreflight(req: Parameters<RequestHandler>[0]): boolean {
  const requestedMethod = req.get('access-control-request-method')?.toUpperCase();
  if (!requestedMethod || !methods.has(requestedMethod)) return false;
  const requestedHeaders = req.get('access-control-request-headers');
  if (!requestedHeaders) return true;
  const parsed = requestedHeaders.split(',').map(header => header.trim().toLowerCase());
  return parsed.length > 0 && parsed.every(header => header !== '' && headers.has(header));
}

/** Exact-origin CORS for browser clients. It is not an authentication or authorization mechanism. */
export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowList = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) { next(); return; }

    res.vary('Origin');
    if (!allowList.has(origin)) {
      if (req.method === 'OPTIONS') res.status(403).end();
      else next();
      return;
    }

    if (req.method === 'OPTIONS') {
      if (!isAllowedPreflight(req)) { res.status(403).end(); return; }
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', [...corsAllowedRequestMethods, 'OPTIONS'].join(', '));
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.status(204).end();
      return;
    }

    res.set('Access-Control-Allow-Origin', origin);
    next();
  };
}
