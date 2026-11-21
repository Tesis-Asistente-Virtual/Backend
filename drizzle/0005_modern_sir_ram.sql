CREATE TABLE "monitoring_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"consent_purpose" varchar(40) DEFAULT 'longitudinal_monitoring' NOT NULL,
	"consent_notice_version_id" uuid NOT NULL,
	"contract_version" varchar(20) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"enrolled_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "monitoring_enrollments_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "monitoring_enrollments_status_ck" CHECK ("monitoring_enrollments"."status" in ('active', 'paused', 'withdrawn', 'completed')),
	CONSTRAINT "monitoring_enrollments_purpose_ck" CHECK ("monitoring_enrollments"."consent_purpose" = 'longitudinal_monitoring'),
	CONSTRAINT "monitoring_enrollments_contract_ck" CHECK ("monitoring_enrollments"."contract_version" = '1.0'),
	CONSTRAINT "monitoring_enrollments_revision_ck" CHECK ("monitoring_enrollments"."revision" > 0),
	CONSTRAINT "monitoring_enrollments_time_ck" CHECK ("monitoring_enrollments"."consented_at" <= "monitoring_enrollments"."enrolled_at" and "monitoring_enrollments"."enrolled_at" <= "monitoring_enrollments"."updated_at" and "monitoring_enrollments"."status_changed_at" <= "monitoring_enrollments"."updated_at")
);
--> statement-breakpoint
CREATE TABLE "monitoring_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"contract_version" varchar(20) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "monitoring_sessions_status_ck" CHECK ("monitoring_sessions"."status" in ('in_progress', 'completed', 'abandoned')),
	CONSTRAINT "monitoring_sessions_contract_ck" CHECK ("monitoring_sessions"."contract_version" = '1.0'),
	CONSTRAINT "monitoring_sessions_revision_ck" CHECK ("monitoring_sessions"."revision" > 0),
	CONSTRAINT "monitoring_sessions_time_ck" CHECK ("monitoring_sessions"."opened_at" <= "monitoring_sessions"."updated_at" and ("monitoring_sessions"."closed_at" is null or "monitoring_sessions"."closed_at" >= "monitoring_sessions"."opened_at")),
	CONSTRAINT "monitoring_sessions_closed_state_ck" CHECK (("monitoring_sessions"."status" = 'in_progress' and "monitoring_sessions"."closed_at" is null) or ("monitoring_sessions"."status" in ('completed', 'abandoned') and "monitoring_sessions"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "monitoring_enrollments" ADD CONSTRAINT "monitoring_enrollments_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_sessions" ADD CONSTRAINT "monitoring_sessions_enrollment_owner_fk" FOREIGN KEY ("enrollment_id","account_id") REFERENCES "public"."monitoring_enrollments"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_enrollments_one_open_uq" ON "monitoring_enrollments" USING btree ("account_id") WHERE "monitoring_enrollments"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "monitoring_enrollments_owner_created_idx" ON "monitoring_enrollments" USING btree ("account_id","enrolled_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_sessions_id_owner_uq" ON "monitoring_sessions" USING btree ("id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_sessions_one_open_uq" ON "monitoring_sessions" USING btree ("enrollment_id","account_id") WHERE "monitoring_sessions"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "monitoring_sessions_owner_enrollment_idx" ON "monitoring_sessions" USING btree ("account_id","enrollment_id","opened_at","id");--> statement-breakpoint
CREATE FUNCTION guard_monitoring_enrollment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.account_id IS DISTINCT FROM OLD.account_id
		OR NEW.consent_purpose IS DISTINCT FROM OLD.consent_purpose
		OR NEW.consent_notice_version_id IS DISTINCT FROM OLD.consent_notice_version_id
		OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
		OR NEW.consented_at IS DISTINCT FROM OLD.consented_at
		OR NEW.enrolled_at IS DISTINCT FROM OLD.enrolled_at
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'Monitoring enrollment identity and consent reference are immutable' USING ERRCODE = '23514';
	END IF;
	IF NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at OR NEW.status_changed_at < OLD.updated_at THEN
		RAISE EXCEPTION 'Monitoring enrollment revision or timestamps are invalid' USING ERRCODE = '23514';
	END IF;
	IF NOT (
		(OLD.status = 'active' AND NEW.status IN ('paused', 'withdrawn', 'completed'))
		OR (OLD.status = 'paused' AND NEW.status IN ('active', 'withdrawn', 'completed'))
	) THEN
		RAISE EXCEPTION 'Invalid monitoring enrollment status transition' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER monitoring_enrollment_transition_guard BEFORE UPDATE ON monitoring_enrollments FOR EACH ROW EXECUTE FUNCTION guard_monitoring_enrollment_transition();--> statement-breakpoint
CREATE FUNCTION guard_monitoring_session_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
		OR NEW.account_id IS DISTINCT FROM OLD.account_id
		OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
		OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
		RAISE EXCEPTION 'Monitoring session identity is immutable' USING ERRCODE = '23514';
	END IF;
	IF OLD.status <> 'in_progress' OR NEW.status NOT IN ('completed', 'abandoned')
		OR NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN
		RAISE EXCEPTION 'Invalid monitoring session status transition' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER monitoring_session_transition_guard BEFORE UPDATE ON monitoring_sessions FOR EACH ROW EXECUTE FUNCTION guard_monitoring_session_transition();
