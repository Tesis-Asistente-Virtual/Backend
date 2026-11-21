CREATE TABLE "assessment_answers" (
	"answer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"instrument_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_answer_status_check" CHECK ("assessment_answers"."status" in ('pending', 'answered')),
	CONSTRAINT "assessment_answer_payload_check" CHECK (("assessment_answers"."status" = 'pending' AND "assessment_answers"."answer" IS NULL) OR ("assessment_answers"."status" = 'answered' AND "assessment_answers"."answer" IS NOT NULL AND jsonb_typeof("assessment_answers"."answer") = 'object')),
	CONSTRAINT "assessment_answer_timestamps_check" CHECK ("assessment_answers"."created_at" <= "assessment_answers"."updated_at")
);
--> statement-breakpoint
CREATE TABLE "assessment_instrument_questions" (
	"instrument_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	CONSTRAINT "assessment_instrument_questions_pk" PRIMARY KEY("instrument_version_id","question_id"),
	CONSTRAINT "assessment_instrument_question_definition_check" CHECK (jsonb_typeof("assessment_instrument_questions"."definition") = 'object' AND "assessment_instrument_questions"."definition"->>'id' IS NOT NULL AND "assessment_instrument_questions"."definition"->>'id' = "assessment_instrument_questions"."question_id"::text)
);
--> statement-breakpoint
CREATE TABLE "assessment_instrument_versions" (
	"instrument_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"version" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"approval_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"approval_reference" varchar(300),
	"license_status" varchar(20) DEFAULT 'not_reviewed' NOT NULL,
	"license_reference" varchar(300),
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_instrument_status_check" CHECK ("assessment_instrument_versions"."status" in ('draft', 'approved', 'retired')),
	CONSTRAINT "assessment_instrument_approval_check" CHECK ("assessment_instrument_versions"."approval_status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "assessment_instrument_license_check" CHECK ("assessment_instrument_versions"."license_status" in ('not_reviewed', 'authorized', 'restricted', 'not_applicable')),
	CONSTRAINT "assessment_instrument_publication_check" CHECK ("assessment_instrument_versions"."status" <> 'approved' OR ("assessment_instrument_versions"."approval_status" = 'approved' AND "assessment_instrument_versions"."approved_at" IS NOT NULL AND "assessment_instrument_versions"."approval_reference" IS NOT NULL AND "assessment_instrument_versions"."license_status" IN ('authorized', 'not_applicable')))
);
--> statement-breakpoint
CREATE TABLE "assessment_results" (
	"result_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"instrument_version_id" uuid,
	"schema_version" varchar(20) NOT NULL,
	"instrument_scores" jsonb NOT NULL,
	"interpretation" jsonb NOT NULL,
	"attention_priority" jsonb NOT NULL,
	"safety_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_result_schema_version_check" CHECK ("assessment_results"."schema_version" = '1.0'),
	CONSTRAINT "assessment_result_scores_unavailable_check" CHECK (jsonb_typeof("assessment_results"."instrument_scores") = 'object' AND "assessment_results"."instrument_scores"->>'status' IS NOT NULL AND "assessment_results"."instrument_scores"->>'status' = 'not_available'),
	CONSTRAINT "assessment_result_interpretation_unavailable_check" CHECK (jsonb_typeof("assessment_results"."interpretation") = 'object' AND "assessment_results"."interpretation"->>'status' IS NOT NULL AND "assessment_results"."interpretation"->>'status' = 'not_available'),
	CONSTRAINT "assessment_result_priority_unavailable_check" CHECK (jsonb_typeof("assessment_results"."attention_priority") = 'object' AND "assessment_results"."attention_priority"->>'status' IS NOT NULL AND "assessment_results"."attention_priority"->>'status' = 'not_available'),
	CONSTRAINT "assessment_result_safety_unassessed_check" CHECK (jsonb_typeof("assessment_results"."safety_state") = 'object' AND "assessment_results"."safety_state"->>'status' IS NOT NULL AND "assessment_results"."safety_state"->>'status' = 'not_available' AND "assessment_results"."safety_state"->>'reason' IS NOT NULL AND "assessment_results"."safety_state"->>'reason' = 'not_assessed')
);
--> statement-breakpoint
CREATE TABLE "preliminary_assessments" (
	"assessment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"assessment_type" varchar(80) NOT NULL,
	"mode" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'in_progress' NOT NULL,
	"instrument_version_id" uuid,
	"consent_notice_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preliminary_assessments_id_instrument_version_uq" UNIQUE("assessment_id","instrument_version_id"),
	CONSTRAINT "preliminary_assessment_status_check" CHECK ("preliminary_assessments"."status" in ('in_progress', 'paused', 'completed', 'withdrawn', 'expired')),
	CONSTRAINT "preliminary_assessment_mode_check" CHECK ("preliminary_assessments"."mode" in ('conversational_contextual', 'structured_instrument')),
	CONSTRAINT "preliminary_assessment_instrument_mode_check" CHECK (("preliminary_assessments"."mode" = 'structured_instrument') = ("preliminary_assessments"."instrument_version_id" IS NOT NULL)),
	CONSTRAINT "preliminary_assessment_completion_check" CHECK (("preliminary_assessments"."status" = 'completed') = ("preliminary_assessments"."completed_at" IS NOT NULL)),
	CONSTRAINT "preliminary_assessment_withdrawal_check" CHECK (("preliminary_assessments"."status" = 'withdrawn') = ("preliminary_assessments"."withdrawn_at" IS NOT NULL)),
	CONSTRAINT "preliminary_assessment_timestamps_check" CHECK ("preliminary_assessments"."created_at" <= "preliminary_assessments"."started_at" AND "preliminary_assessments"."started_at" <= "preliminary_assessments"."updated_at" AND ("preliminary_assessments"."completed_at" IS NULL OR "preliminary_assessments"."started_at" <= "preliminary_assessments"."completed_at") AND ("preliminary_assessments"."withdrawn_at" IS NULL OR "preliminary_assessments"."started_at" <= "preliminary_assessments"."withdrawn_at"))
);
--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_assessment_id_preliminary_assessments_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."preliminary_assessments"("assessment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_assessment_version_fk" FOREIGN KEY ("assessment_id","instrument_version_id") REFERENCES "public"."preliminary_assessments"("assessment_id","instrument_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_question_version_fk" FOREIGN KEY ("instrument_version_id","question_id") REFERENCES "public"."assessment_instrument_questions"("instrument_version_id","question_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_instrument_questions" ADD CONSTRAINT "assessment_instrument_questions_instrument_version_id_assessment_instrument_versions_instrument_version_id_fk" FOREIGN KEY ("instrument_version_id") REFERENCES "public"."assessment_instrument_versions"("instrument_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_assessment_id_preliminary_assessments_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."preliminary_assessments"("assessment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_instrument_version_id_assessment_instrument_versions_instrument_version_id_fk" FOREIGN KEY ("instrument_version_id") REFERENCES "public"."assessment_instrument_versions"("instrument_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_version_match_fk" FOREIGN KEY ("assessment_id","instrument_version_id") REFERENCES "public"."preliminary_assessments"("assessment_id","instrument_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preliminary_assessments" ADD CONSTRAINT "preliminary_assessments_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preliminary_assessments" ADD CONSTRAINT "preliminary_assessments_instrument_version_id_assessment_instrument_versions_instrument_version_id_fk" FOREIGN KEY ("instrument_version_id") REFERENCES "public"."assessment_instrument_versions"("instrument_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preliminary_assessments" ADD CONSTRAINT "preliminary_assessments_consent_notice_version_id_consent_notice_versions_id_fk" FOREIGN KEY ("consent_notice_version_id") REFERENCES "public"."consent_notice_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_answers_assessment_question_uq" ON "assessment_answers" USING btree ("assessment_id","question_id");--> statement-breakpoint
CREATE INDEX "assessment_answers_assessment_version_idx" ON "assessment_answers" USING btree ("assessment_id","instrument_version_id");--> statement-breakpoint
CREATE INDEX "assessment_instrument_questions_version_idx" ON "assessment_instrument_questions" USING btree ("instrument_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_instrument_id_version_uq" ON "assessment_instrument_versions" USING btree ("instrument_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_instrument_version_id_instrument_id_uq" ON "assessment_instrument_versions" USING btree ("instrument_version_id","instrument_id");--> statement-breakpoint
CREATE INDEX "assessment_instrument_available_idx" ON "assessment_instrument_versions" USING btree ("instrument_id","status","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_results_assessment_uq" ON "assessment_results" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "preliminary_assessments_account_created_idx" ON "preliminary_assessments" USING btree ("account_id","created_at" DESC NULLS LAST,"assessment_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_assessment_instrument_mutation() RETURNS trigger AS $$
DECLARE question_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Instrument versions must be created as drafts' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Published instrument versions are immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'approved') THEN RAISE EXCEPTION 'Draft instrument can only remain draft or be approved' USING ERRCODE = '23514'; END IF;
    IF NEW.status = 'approved' THEN
      SELECT count(*) INTO question_count FROM assessment_instrument_questions WHERE instrument_version_id = NEW.instrument_version_id;
      IF question_count = 0 THEN RAISE EXCEPTION 'An instrument version needs questions before approval' USING ERRCODE = '23514'; END IF;
    END IF;
  ELSE
    IF NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id OR NEW.instrument_id IS DISTINCT FROM OLD.instrument_id OR
       NEW.version IS DISTINCT FROM OLD.version OR NEW.approval_status IS DISTINCT FROM OLD.approval_status OR
       NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approval_reference IS DISTINCT FROM OLD.approval_reference OR
       NEW.license_status IS DISTINCT FROM OLD.license_status OR NEW.license_reference IS DISTINCT FROM OLD.license_reference OR
       NEW.effective_at IS DISTINCT FROM OLD.effective_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Published instrument version content is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'retired') THEN RAISE EXCEPTION 'Approved instrument can only be retired' USING ERRCODE = '23514'; END IF;
    IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN RAISE EXCEPTION 'Retired instrument cannot be republished' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_instrument_immutable_trigger BEFORE INSERT OR UPDATE OR DELETE ON assessment_instrument_versions FOR EACH ROW EXECUTE FUNCTION prevent_assessment_instrument_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_instrument_questions() RETURNS trigger AS $$
DECLARE version_status varchar(20); version_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN version_id := OLD.instrument_version_id; ELSE version_id := NEW.instrument_version_id; END IF;
  SELECT status INTO version_status FROM assessment_instrument_versions WHERE instrument_version_id = version_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Instrument version does not exist' USING ERRCODE = '23503';
  END IF;
  IF version_status <> 'draft' THEN RAISE EXCEPTION 'Questions of published instrument versions are immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id THEN RAISE EXCEPTION 'Question version cannot be reassigned' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_instrument_questions_immutable_trigger BEFORE INSERT OR UPDATE OR DELETE ON assessment_instrument_questions FOR EACH ROW EXECUTE FUNCTION guard_assessment_instrument_questions();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_preliminary_assessment() RETURNS trigger AS $$
DECLARE notice_purpose varchar(64); notice_status varchar(20); notice_effective timestamptz;
        latest_action varchar(20); latest_notice uuid; instrument_status varchar(20); instrument_effective timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.account_id IS DISTINCT FROM OLD.account_id OR
       NEW.assessment_type IS DISTINCT FROM OLD.assessment_type OR NEW.mode IS DISTINCT FROM OLD.mode OR
       NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id OR NEW.consent_notice_version_id IS DISTINCT FROM OLD.consent_notice_version_id OR
       NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'Assessment identity and assigned versions are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'in_progress' AND NEW.status IN ('paused', 'completed', 'withdrawn', 'expired')) OR
      (OLD.status = 'paused' AND NEW.status IN ('in_progress', 'withdrawn', 'expired'))
    ) THEN RAISE EXCEPTION 'Invalid assessment state transition' USING ERRCODE = '23514'; END IF;
    IF NEW.status = OLD.status AND NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'Assessment timestamp cannot move backwards' USING ERRCODE = '23514'; END IF;
    IF NEW.status NOT IN ('withdrawn', 'expired') THEN
      PERFORM 1 FROM auth_accounts WHERE id = NEW.account_id FOR SHARE;
      SELECT action, notice_version_id INTO latest_action, latest_notice FROM account_consent_events
        WHERE account_id = NEW.account_id AND purpose = 'preliminary_assessment' ORDER BY sequence DESC LIMIT 1;
      IF latest_action <> 'granted' OR latest_notice IS DISTINCT FROM NEW.consent_notice_version_id THEN
        RAISE EXCEPTION 'Current preliminary assessment consent is required' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    PERFORM 1 FROM auth_accounts WHERE id = NEW.account_id FOR SHARE;
    SELECT purpose, status, effective_at INTO notice_purpose, notice_status, notice_effective
      FROM consent_notice_versions WHERE id = NEW.consent_notice_version_id;
    SELECT action, notice_version_id INTO latest_action, latest_notice FROM account_consent_events
      WHERE account_id = NEW.account_id AND purpose = 'preliminary_assessment' ORDER BY sequence DESC LIMIT 1;
    IF notice_purpose <> 'preliminary_assessment' OR notice_status <> 'published' OR notice_effective > NEW.started_at OR
       latest_action <> 'granted' OR latest_notice IS DISTINCT FROM NEW.consent_notice_version_id THEN
      RAISE EXCEPTION 'Current preliminary assessment consent is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.instrument_version_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status = 'in_progress') THEN
    SELECT status, effective_at INTO instrument_status, instrument_effective FROM assessment_instrument_versions
      WHERE instrument_version_id = NEW.instrument_version_id;
    IF instrument_status <> 'approved' OR instrument_effective > NEW.started_at THEN
      RAISE EXCEPTION 'Approved instrument version is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER preliminary_assessment_guard_trigger BEFORE INSERT OR UPDATE ON preliminary_assessments FOR EACH ROW EXECUTE FUNCTION guard_preliminary_assessment();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_answer() RETURNS trigger AS $$
DECLARE owner_id uuid; assessment_status varchar(20); consent_id uuid; latest_action varchar(20); latest_notice uuid; notice_status varchar(20); notice_effective timestamptz;
BEGIN
  SELECT account_id, status, consent_notice_version_id INTO owner_id, assessment_status, consent_id
    FROM preliminary_assessments WHERE assessment_id = NEW.assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assessment does not exist' USING ERRCODE = '23503'; END IF;
  IF assessment_status <> 'in_progress' THEN RAISE EXCEPTION 'Assessment is not open for answers' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM auth_accounts WHERE id = owner_id FOR SHARE;
  SELECT action, notice_version_id INTO latest_action, latest_notice FROM account_consent_events
    WHERE account_id = owner_id AND purpose = 'preliminary_assessment' ORDER BY sequence DESC LIMIT 1;
  SELECT status, effective_at INTO notice_status, notice_effective FROM consent_notice_versions WHERE id = consent_id;
  IF latest_action <> 'granted' OR latest_notice IS DISTINCT FROM consent_id OR notice_status <> 'published' OR notice_effective > NEW.updated_at THEN
    RAISE EXCEPTION 'Current preliminary assessment consent is required for answers' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.answer_id IS DISTINCT FROM OLD.answer_id OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id OR NEW.question_id IS DISTINCT FROM OLD.question_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Answer identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_answer_guard_trigger BEFORE INSERT OR UPDATE ON assessment_answers FOR EACH ROW EXECUTE FUNCTION guard_assessment_answer();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_result() RETURNS trigger AS $$
DECLARE current_status varchar(20); current_version uuid;
BEGIN
  SELECT status, instrument_version_id INTO current_status, current_version FROM preliminary_assessments
    WHERE assessment_id = NEW.assessment_id FOR UPDATE;
  IF NOT FOUND OR current_status <> 'completed' OR current_version IS DISTINCT FROM NEW.instrument_version_id THEN
    RAISE EXCEPTION 'A matching completed assessment is required for a result' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_result_guard_trigger BEFORE INSERT OR UPDATE ON assessment_results FOR EACH ROW EXECUTE FUNCTION guard_assessment_result();
