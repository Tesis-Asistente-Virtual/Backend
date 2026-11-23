CREATE OR REPLACE FUNCTION guard_preliminary_assessment() RETURNS trigger AS $$
DECLARE
  notice_purpose varchar(64);
  notice_status varchar(20);
  notice_effective timestamptz;
  latest_action varchar(20);
  latest_notice uuid;
  instrument_status varchar(20);
  instrument_effective timestamptz;
  instrument_approval_status varchar(20);
  instrument_approved_at timestamptz;
  instrument_approval_reference text;
  technical_test_enabled boolean;
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
    SELECT status, effective_at, approval_status, approved_at, approval_reference
      INTO instrument_status, instrument_effective, instrument_approval_status, instrument_approved_at, instrument_approval_reference
      FROM assessment_instrument_versions WHERE instrument_version_id = NEW.instrument_version_id;
    technical_test_enabled := COALESCE(current_setting('app.dass21_technical_test', true) = 'enabled', false);

    IF NOT (
      (instrument_status = 'approved' AND instrument_effective <= NEW.started_at)
      OR
      (technical_test_enabled
       AND NEW.instrument_version_id = '00000000-0000-4000-8000-000000008a92'::uuid
       AND instrument_status = 'draft'
       AND instrument_approval_status = 'pending'
       AND instrument_approved_at IS NULL
       AND instrument_approval_reference IS NULL
       AND instrument_effective <= NEW.started_at)
    ) THEN
      RAISE EXCEPTION 'Approved instrument version is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
