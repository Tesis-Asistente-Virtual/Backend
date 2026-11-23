import 'dotenv/config';
import { parseCorsAllowedOrigins } from './cors.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port');
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret && Buffer.byteLength(jwtSecret, 'utf8') < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
const positiveSeconds = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};
export const env = {
  port,
  corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
  databaseUrl: process.env.DATABASE_URL ?? (process.env.DB_HOST ? `postgres://${encodeURIComponent(process.env.DB_USER ?? '')}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? '5432'}/${process.env.DB_NAME ?? ''}` : undefined),
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER ?? 'tesis-backend',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'tesis-mobile-app',
  accessTokenTtlSeconds: positiveSeconds('ACCESS_TOKEN_TTL_SECONDS', 900),
  refreshTokenTtlSeconds: positiveSeconds('REFRESH_TOKEN_TTL_SECONDS', 604800),
  openApiEnabled: process.env.OPENAPI_ENABLED === 'true',
  openAiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openAiModel: process.env.OPENAI_MODEL?.trim() || undefined,
  openAiTimeoutMs: positiveInteger('OPENAI_TIMEOUT_MS', 30_000),
  openAiMaxOutputTokens: positiveInteger('OPENAI_MAX_OUTPUT_TOKENS', 800),
  openAiMaxContextMessages: positiveInteger('OPENAI_MAX_CONTEXT_MESSAGES', 20),
  openAiMaxContextCharacters: positiveInteger('OPENAI_MAX_CONTEXT_CHARACTERS', 24_000),
};
