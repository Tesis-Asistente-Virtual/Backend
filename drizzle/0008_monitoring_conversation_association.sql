CREATE TABLE "monitoring_session_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"monitoring_session_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_session_conversations_session_uq" UNIQUE("monitoring_session_id"),
	CONSTRAINT "monitoring_session_conversations_conversation_uq" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_id_account_uq" UNIQUE("id","account_id");--> statement-breakpoint
ALTER TABLE "monitoring_sessions" ADD CONSTRAINT "monitoring_sessions_id_enrollment_owner_uq" UNIQUE("id","enrollment_id","account_id");
--> statement-breakpoint
ALTER TABLE "monitoring_session_conversations" ADD CONSTRAINT "monitoring_session_conversations_session_owner_fk" FOREIGN KEY ("monitoring_session_id","enrollment_id","account_id") REFERENCES "public"."monitoring_sessions"("id","enrollment_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_session_conversations" ADD CONSTRAINT "monitoring_session_conversations_conversation_owner_fk" FOREIGN KEY ("conversation_id","account_id") REFERENCES "public"."conversations"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_session_conversations_owner_enrollment_idx" ON "monitoring_session_conversations" USING btree ("account_id","enrollment_id","created_at");--> statement-breakpoint
