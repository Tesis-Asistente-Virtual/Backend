ALTER TABLE "auth_accounts" ADD COLUMN "status" varchar(30) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "refresh_token_hash" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "revoked_at" timestamp with time zone;