ALTER TABLE "assessment_instrument_questions" ADD COLUMN "display_order" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_instrument_questions_order_uq" ON "assessment_instrument_questions" USING btree ("instrument_version_id","display_order") WHERE "assessment_instrument_questions"."display_order" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_instrument_questions" ADD CONSTRAINT "assessment_instrument_question_display_order_check" CHECK ("assessment_instrument_questions"."display_order" IS NULL OR "assessment_instrument_questions"."display_order" BETWEEN 1 AND 200);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_assessment_question_order_on_publish() RETURNS trigger AS $$
DECLARE question_count integer; ordered_count integer; minimum_position integer; maximum_position integer;
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    SELECT count(*), count(display_order), min(display_order), max(display_order)
      INTO question_count, ordered_count, minimum_position, maximum_position
      FROM assessment_instrument_questions WHERE instrument_version_id = NEW.instrument_version_id;
    IF question_count = 0 OR ordered_count <> question_count OR minimum_position <> 1 OR maximum_position <> question_count THEN
      RAISE EXCEPTION 'Instrument questions need a complete contiguous display order before publication' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER assessment_instrument_question_order_publish_trigger
BEFORE UPDATE OF status ON assessment_instrument_versions
FOR EACH ROW EXECUTE FUNCTION guard_assessment_question_order_on_publish();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_preliminary_assessment() RETURNS trigger AS $$
DECLARE notice_purpose varchar(64); notice_status varchar(20); notice_effective timestamptz;
        latest_action varchar(20); latest_notice uuid; instrument_status varchar(20); instrument_effective timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assessment_id IS DISTINCT FROM OLD.assessment_id OR NEW.account_id IS DISTINCT FROM OLD.account_id OR
       NEW.assessment_type IS DISTINCT FROM OLD.assessment_type OR NEW.mode IS DISTINCT FROM OLD.mode OR
       NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id OR
       NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'Assessment identity and instrument version are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.consent_notice_version_id IS DISTINCT FROM OLD.consent_notice_version_id AND
       (OLD.status NOT IN ('in_progress', 'paused') OR NEW.status NOT IN ('in_progress', 'paused')) THEN
      RAISE EXCEPTION 'Only an open assessment can be reauthorized' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'in_progress' AND NEW.status IN ('paused', 'completed', 'withdrawn', 'expired')) OR
      (OLD.status = 'paused' AND NEW.status IN ('in_progress', 'withdrawn', 'expired'))
    ) THEN RAISE EXCEPTION 'Invalid assessment state transition' USING ERRCODE = '23514'; END IF;
    IF NEW.status = OLD.status AND NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'Assessment timestamp cannot move backwards' USING ERRCODE = '23514'; END IF;
    IF NEW.status NOT IN ('withdrawn', 'expired') THEN
      PERFORM 1 FROM auth_accounts WHERE id = NEW.account_id FOR SHARE;
      SELECT purpose, status, effective_at INTO notice_purpose, notice_status, notice_effective
        FROM consent_notice_versions WHERE id = NEW.consent_notice_version_id;
      SELECT action, notice_version_id INTO latest_action, latest_notice FROM account_consent_events
        WHERE account_id = NEW.account_id AND purpose = 'preliminary_assessment' ORDER BY sequence DESC LIMIT 1;
      IF notice_purpose IS DISTINCT FROM 'preliminary_assessment' OR notice_status IS DISTINCT FROM 'published' OR
         notice_effective > NEW.updated_at OR latest_action IS DISTINCT FROM 'granted' OR
         latest_notice IS DISTINCT FROM NEW.consent_notice_version_id THEN
        RAISE EXCEPTION 'Current preliminary assessment consent is required' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    PERFORM 1 FROM auth_accounts WHERE id = NEW.account_id FOR SHARE;
    SELECT purpose, status, effective_at INTO notice_purpose, notice_status, notice_effective
      FROM consent_notice_versions WHERE id = NEW.consent_notice_version_id;
    SELECT action, notice_version_id INTO latest_action, latest_notice FROM account_consent_events
      WHERE account_id = NEW.account_id AND purpose = 'preliminary_assessment' ORDER BY sequence DESC LIMIT 1;
    IF notice_purpose IS DISTINCT FROM 'preliminary_assessment' OR notice_status IS DISTINCT FROM 'published' OR
       notice_effective > NEW.started_at OR latest_action IS DISTINCT FROM 'granted' OR
       latest_notice IS DISTINCT FROM NEW.consent_notice_version_id THEN
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
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER preliminary_assessment_guard_trigger ON preliminary_assessments;
--> statement-breakpoint
CREATE TRIGGER preliminary_assessment_guard_trigger BEFORE INSERT OR UPDATE ON preliminary_assessments
FOR EACH ROW EXECUTE FUNCTION guard_preliminary_assessment();
