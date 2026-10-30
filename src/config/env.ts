import 'dotenv/config';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port');
export const env = { port, databaseUrl: process.env.DATABASE_URL ?? (process.env.DB_HOST ? `postgres://${encodeURIComponent(process.env.DB_USER ?? '')}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? '5432'}/${process.env.DB_NAME ?? ''}` : undefined) };
