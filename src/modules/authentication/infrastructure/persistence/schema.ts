import { pgTable, uuid, varchar, timestamp, integer } from 'drizzle-orm/pg-core';
export const authAccounts = pgTable('auth_accounts', { id: uuid('id').defaultRandom().primaryKey(), email: varchar('email', { length: 320 }).notNull().unique(), passwordHash: varchar('password_hash', { length: 255 }).notNull(), status: varchar('status', { length: 30 }).notNull().default('active'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull() });
export const authSessions = pgTable('auth_sessions', { id: uuid('id').defaultRandom().primaryKey(), accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }), refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }) });
export const authPasswordResetCodes = pgTable('auth_password_reset_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 255 }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  resetTokenHash: varchar('reset_token_hash', { length: 64 }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
