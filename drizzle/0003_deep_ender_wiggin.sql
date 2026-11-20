CREATE TABLE "account_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "account_consent_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"notice_version_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_consent_purpose_check" CHECK ("account_consent_events"."purpose" in ('ai_conversation_processing', 'structured_signal_extraction', 'longitudinal_monitoring', 'preliminary_assessment')),
	CONSTRAINT "account_consent_action_check" CHECK ("account_consent_events"."action" in ('granted', 'declined', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "consent_notice_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"version" varchar(40) NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_notice_purpose_check" CHECK ("consent_notice_versions"."purpose" in ('ai_conversation_processing', 'structured_signal_extraction', 'longitudinal_monitoring', 'preliminary_assessment')),
	CONSTRAINT "consent_notice_status_check" CHECK ("consent_notice_versions"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "consent_notice_hash_check" CHECK ("consent_notice_versions"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "account_consent_events" ADD CONSTRAINT "account_consent_events_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_consent_events" ADD CONSTRAINT "account_consent_events_notice_version_id_consent_notice_versions_id_fk" FOREIGN KEY ("notice_version_id") REFERENCES "public"."consent_notice_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_consent_account_idempotency_uq" ON "account_consent_events" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "account_consent_sequence_uq" ON "account_consent_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "account_consent_status_idx" ON "account_consent_events" USING btree ("account_id","purpose","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "consent_notice_purpose_version_uq" ON "consent_notice_versions" USING btree ("purpose","version");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_notice_one_published_per_purpose_uq" ON "consent_notice_versions" USING btree ("purpose") WHERE "consent_notice_versions"."status" = 'published';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_consent_notice_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Published consent notices are immutable'; END IF;
		RETURN OLD;
	END IF;
	IF OLD.status <> 'draft' AND (
		NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
		NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.version IS DISTINCT FROM OLD.version OR
		NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
		NEW.effective_at IS DISTINCT FROM OLD.effective_at
	) THEN RAISE EXCEPTION 'Published consent notice content is immutable'; END IF;
	IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded') THEN
		RAISE EXCEPTION 'Published consent notice can only be superseded';
	END IF;
	IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'published') THEN
		RAISE EXCEPTION 'Draft consent notice can only be published';
	END IF;
	IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
		RAISE EXCEPTION 'Superseded consent notice cannot be republished';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_notice_immutable_trigger
BEFORE UPDATE OR DELETE ON "consent_notice_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_consent_notice_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_consent_event_update() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'Consent events are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER account_consent_event_immutable_trigger
BEFORE UPDATE ON "account_consent_events"
FOR EACH ROW EXECUTE FUNCTION prevent_consent_event_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_consent_event_notice_purpose() RETURNS trigger AS $$
DECLARE notice_purpose varchar(64);
BEGIN
	SELECT purpose INTO notice_purpose FROM consent_notice_versions WHERE id = NEW.notice_version_id;
	IF notice_purpose IS DISTINCT FROM NEW.purpose THEN
		RAISE EXCEPTION 'Consent event purpose must match its notice purpose';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER account_consent_notice_purpose_trigger
BEFORE INSERT ON "account_consent_events"
FOR EACH ROW EXECUTE FUNCTION validate_consent_event_notice_purpose();
