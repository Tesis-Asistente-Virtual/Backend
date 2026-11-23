ALTER TABLE "preliminary_assessments" ADD CONSTRAINT "preliminary_assessments_id_account_uq" UNIQUE("assessment_id","account_id");--> statement-breakpoint
CREATE TABLE "assessment_psychometric_scores" (
	"score_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"instrument_version_id" uuid NOT NULL,
	"mapping_id" uuid NOT NULL,
	"mapping_version" varchar(40) NOT NULL,
	"scoring_version" varchar(40) NOT NULL,
	"schema_version" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"depression_raw_score" smallint NOT NULL,
	"depression_equivalent_score" smallint NOT NULL,
	"anxiety_raw_score" smallint NOT NULL,
	"anxiety_equivalent_score" smallint NOT NULL,
	"stress_raw_score" smallint NOT NULL,
	"stress_equivalent_score" smallint NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assessment_psychometric_scores_status_check" CHECK ("assessment_psychometric_scores"."status" = 'calculated'),
	CONSTRAINT "assessment_psychometric_scores_schema_check" CHECK ("assessment_psychometric_scores"."schema_version" = '1.0'),
	CONSTRAINT "assessment_psychometric_scores_mapping_version_check" CHECK (length(trim("assessment_psychometric_scores"."mapping_version")) > 0 AND length(trim("assessment_psychometric_scores"."scoring_version")) > 0),
	CONSTRAINT "assessment_psychometric_scores_depression_check" CHECK ("assessment_psychometric_scores"."depression_raw_score" between 0 and 21 AND "assessment_psychometric_scores"."depression_equivalent_score" = "assessment_psychometric_scores"."depression_raw_score" * 2),
	CONSTRAINT "assessment_psychometric_scores_anxiety_check" CHECK ("assessment_psychometric_scores"."anxiety_raw_score" between 0 and 21 AND "assessment_psychometric_scores"."anxiety_equivalent_score" = "assessment_psychometric_scores"."anxiety_raw_score" * 2),
	CONSTRAINT "assessment_psychometric_scores_stress_check" CHECK ("assessment_psychometric_scores"."stress_raw_score" between 0 and 21 AND "assessment_psychometric_scores"."stress_equivalent_score" = "assessment_psychometric_scores"."stress_raw_score" * 2)
);
--> statement-breakpoint
CREATE TABLE "assessment_scoring_item_mappings" (
	"mapping_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"instrument_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"item_number" smallint NOT NULL,
	CONSTRAINT "assessment_scoring_item_mapping_pk" PRIMARY KEY("mapping_id","question_id"),
	CONSTRAINT "assessment_scoring_item_mapping_item_uq" UNIQUE("mapping_id","item_number"),
	CONSTRAINT "assessment_scoring_item_mapping_number_check" CHECK ("assessment_scoring_item_mappings"."item_number" between 1 and 21)
);
--> statement-breakpoint
CREATE TABLE "assessment_scoring_mapping_versions" (
	"mapping_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"instrument_version_id" uuid NOT NULL,
	"mapping_version" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "assessment_scoring_mapping_version_uq" UNIQUE("instrument_version_id","mapping_version"),
	CONSTRAINT "assessment_scoring_mapping_identity_uq" UNIQUE("mapping_id","instrument_version_id","instrument_id"),
	CONSTRAINT "assessment_scoring_mapping_status_check" CHECK ("assessment_scoring_mapping_versions"."status" in ('draft', 'frozen')),
	CONSTRAINT "assessment_scoring_mapping_frozen_check" CHECK (("assessment_scoring_mapping_versions"."status" = 'frozen') = ("assessment_scoring_mapping_versions"."frozen_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "assessment_psychometric_scores" ADD CONSTRAINT "assessment_psychometric_scores_assessment_owner_fk" FOREIGN KEY ("assessment_id","account_id") REFERENCES "public"."preliminary_assessments"("assessment_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_psychometric_scores" ADD CONSTRAINT "assessment_psychometric_scores_assessment_version_fk" FOREIGN KEY ("assessment_id","instrument_version_id") REFERENCES "public"."preliminary_assessments"("assessment_id","instrument_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_psychometric_scores" ADD CONSTRAINT "assessment_psychometric_scores_instrument_fk" FOREIGN KEY ("instrument_version_id","instrument_id") REFERENCES "public"."assessment_instrument_versions"("instrument_version_id","instrument_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_psychometric_scores" ADD CONSTRAINT "assessment_psychometric_scores_mapping_fk" FOREIGN KEY ("mapping_id","instrument_version_id","instrument_id") REFERENCES "public"."assessment_scoring_mapping_versions"("mapping_id","instrument_version_id","instrument_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_scoring_item_mappings" ADD CONSTRAINT "assessment_scoring_item_mapping_version_fk" FOREIGN KEY ("mapping_id","instrument_version_id","instrument_id") REFERENCES "public"."assessment_scoring_mapping_versions"("mapping_id","instrument_version_id","instrument_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_scoring_item_mappings" ADD CONSTRAINT "assessment_scoring_item_mapping_question_fk" FOREIGN KEY ("instrument_version_id","question_id") REFERENCES "public"."assessment_instrument_questions"("instrument_version_id","question_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_scoring_mapping_versions" ADD CONSTRAINT "assessment_scoring_mapping_instrument_fk" FOREIGN KEY ("instrument_version_id","instrument_id") REFERENCES "public"."assessment_instrument_versions"("instrument_version_id","instrument_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_psychometric_scores_assessment_uq" ON "assessment_psychometric_scores" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "assessment_psychometric_scores_owner_time_idx" ON "assessment_psychometric_scores" USING btree ("account_id","calculated_at" DESC NULLS LAST,"score_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_scoring_mapping_version() RETURNS trigger AS $$
DECLARE instrument_status varchar(20); approval_status varchar(20); instrument_license varchar(20); approved_at timestamptz; instrument_effective_at timestamptz;
        item_count integer; distinct_items integer; min_item smallint; max_item smallint; valid_questions integer; instrument_question_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'frozen' THEN RAISE EXCEPTION 'Frozen scoring mapping is immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.mapping_id IS DISTINCT FROM OLD.mapping_id OR NEW.instrument_id IS DISTINCT FROM OLD.instrument_id OR
       NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id OR NEW.mapping_version IS DISTINCT FROM OLD.mapping_version OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Scoring mapping identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'frozen' THEN RAISE EXCEPTION 'Frozen scoring mapping is immutable' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW.status = 'frozen' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'frozen' THEN RAISE EXCEPTION 'Scoring mapping is already frozen' USING ERRCODE = '23514'; END IF;
    NEW.frozen_at := COALESCE(NEW.frozen_at, now());
    SELECT iv.status, iv.approval_status, iv.license_status, iv.approved_at, iv.effective_at
      INTO instrument_status, approval_status, instrument_license, approved_at, instrument_effective_at
      FROM assessment_instrument_versions AS iv WHERE iv.instrument_version_id = NEW.instrument_version_id AND iv.instrument_id = NEW.instrument_id;
    IF NOT FOUND OR instrument_status <> 'approved' OR approval_status <> 'approved' OR approved_at IS NULL OR
       instrument_license NOT IN ('authorized', 'not_applicable') OR instrument_effective_at > NEW.frozen_at THEN
      RAISE EXCEPTION 'Only an approved and licensed instrument can freeze its scoring map' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO instrument_question_count FROM assessment_instrument_questions WHERE instrument_version_id = NEW.instrument_version_id;
    SELECT count(*), count(DISTINCT item_number), min(item_number), max(item_number),
           count(*) FILTER (WHERE q.question_id IS NOT NULL AND q.definition->>'responseType' = 'number' AND
             q.definition->>'required' = 'true' AND q.definition->>'minimum' = '0' AND q.definition->>'maximum' = '3')
      INTO item_count, distinct_items, min_item, max_item, valid_questions
      FROM assessment_scoring_item_mappings m
      LEFT JOIN assessment_instrument_questions q ON q.instrument_version_id = m.instrument_version_id AND q.question_id = m.question_id
      WHERE m.mapping_id = NEW.mapping_id;
    IF instrument_question_count <> 21 OR item_count <> 21 OR distinct_items <> 21 OR min_item <> 1 OR max_item <> 21 OR valid_questions <> 21 THEN
      RAISE EXCEPTION 'Scoring map must cover 21 distinct valid question references' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_scoring_mapping_version_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON assessment_scoring_mapping_versions FOR EACH ROW EXECUTE FUNCTION guard_assessment_scoring_mapping_version();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_scoring_item_mapping() RETURNS trigger AS $$
DECLARE target_mapping_id uuid; mapping_status varchar(20);
BEGIN
  target_mapping_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.mapping_id ELSE NEW.mapping_id END;
  SELECT status INTO mapping_status FROM assessment_scoring_mapping_versions WHERE mapping_id = target_mapping_id FOR UPDATE;
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT FOUND OR mapping_status <> 'draft' THEN
    RAISE EXCEPTION 'Scoring items can only change while their map is draft' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_scoring_item_mapping_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON assessment_scoring_item_mappings FOR EACH ROW EXECUTE FUNCTION guard_assessment_scoring_item_mapping();--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_psychometric_score() RETURNS trigger AS $$
DECLARE assessment_owner uuid; assessment_status varchar(20); assessment_version uuid; assessment_notice uuid; assessment_completed_at timestamptz;
        current_notice uuid; latest_action varchar(20); latest_notice uuid; mapping_status varchar(20); mapping_version varchar(40);
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Psychometric score records are immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() <= 1 THEN RAISE EXCEPTION 'Psychometric score records cannot be deleted directly' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN RETURN OLD; END IF;
  PERFORM 1 FROM auth_accounts WHERE id = NEW.account_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Score owner is unavailable' USING ERRCODE = '23514'; END IF;
  SELECT id INTO current_notice FROM consent_notice_versions
    WHERE purpose = 'preliminary_assessment' AND status = 'published' AND effective_at <= NEW.calculated_at
    FOR SHARE;
  SELECT action, notice_version_id INTO latest_action, latest_notice FROM account_consent_events
    WHERE account_id = NEW.account_id AND purpose = 'preliminary_assessment' ORDER BY sequence DESC LIMIT 1;
  SELECT account_id, status, instrument_version_id, consent_notice_version_id, completed_at
    INTO assessment_owner, assessment_status, assessment_version, assessment_notice, assessment_completed_at
    FROM preliminary_assessments WHERE assessment_id = NEW.assessment_id FOR UPDATE;
  IF NOT FOUND OR assessment_owner IS DISTINCT FROM NEW.account_id OR assessment_status <> 'completed' OR
     assessment_version IS DISTINCT FROM NEW.instrument_version_id OR assessment_notice IS DISTINCT FROM current_notice OR
     assessment_completed_at IS NULL OR NEW.calculated_at < assessment_completed_at OR
     latest_action <> 'granted' OR latest_notice IS DISTINCT FROM current_notice THEN
    RAISE EXCEPTION 'Completed assessment with current consent is required for scores' USING ERRCODE = '23514';
  END IF;
  SELECT mv.status, mv.mapping_version INTO mapping_status, mapping_version FROM assessment_scoring_mapping_versions AS mv
    WHERE mv.mapping_id = NEW.mapping_id AND mv.instrument_id = NEW.instrument_id AND mv.instrument_version_id = NEW.instrument_version_id FOR SHARE;
  IF mapping_status <> 'frozen' OR mapping_version IS DISTINCT FROM NEW.mapping_version THEN
    RAISE EXCEPTION 'A matching frozen scoring map is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assessment_psychometric_scores_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON assessment_psychometric_scores FOR EACH ROW EXECUTE FUNCTION guard_assessment_psychometric_score();
