CREATE OR REPLACE FUNCTION guard_assessment_scoring_mapping_version() RETURNS trigger AS $$
DECLARE
  instrument_status varchar(20);
  approval_status varchar(20);
  instrument_license varchar(20);
  approved_at timestamptz;
  instrument_effective_at timestamptz;
  instrument_approval_reference varchar(300);
  instrument_license_reference varchar(300);
  instrument_version varchar(40);
  technical_test_enabled boolean;
  item_count integer;
  distinct_items integer;
  min_item smallint;
  max_item smallint;
  valid_questions integer;
  instrument_question_count integer;
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
    SELECT iv.status, iv.approval_status, iv.license_status, iv.approved_at, iv.effective_at,
           iv.approval_reference, iv.license_reference, iv.version
      INTO instrument_status, approval_status, instrument_license, approved_at, instrument_effective_at,
           instrument_approval_reference, instrument_license_reference, instrument_version
      FROM assessment_instrument_versions AS iv
      WHERE iv.instrument_version_id = NEW.instrument_version_id AND iv.instrument_id = NEW.instrument_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Scoring map instrument is unavailable' USING ERRCODE = '23514'; END IF;
    technical_test_enabled := COALESCE(current_setting('app.dass21_technical_test', true) = 'enabled', false);
    IF NOT (
      (instrument_status = 'approved' AND approval_status = 'approved' AND approved_at IS NOT NULL AND
       instrument_license IN ('authorized', 'not_applicable'))
      OR
      (technical_test_enabled
       AND NEW.instrument_id = '00000000-0000-4000-8000-000000008a91'::uuid
       AND NEW.instrument_version_id = '00000000-0000-4000-8000-000000008a92'::uuid
       AND NEW.mapping_id = '00000000-0000-4000-8000-000000008a94'::uuid
       AND NEW.mapping_version = 'dass21-technical-test-map-1.0'
       AND instrument_version = 'dass21-spanish-candidate-1.1'
       AND instrument_status = 'draft' AND approval_status = 'pending' AND approved_at IS NULL
       AND instrument_approval_reference IS NULL AND instrument_license = 'not_reviewed'
       AND instrument_license_reference IS NULL)
    ) OR instrument_effective_at > NEW.frozen_at THEN
      RAISE EXCEPTION 'Scoring map requires an approved instrument or the isolated synthetic technical fixture' USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO instrument_question_count
      FROM assessment_instrument_questions WHERE instrument_version_id = NEW.instrument_version_id;
    SELECT count(*), count(DISTINCT m.item_number), min(m.item_number), max(m.item_number),
      count(*) FILTER (
        WHERE q.question_id IS NOT NULL AND q.display_order = m.item_number AND q.definition->>'required' = 'true' AND (
          (q.definition->>'responseType' = 'number' AND q.definition->>'minimum' = '0' AND q.definition->>'maximum' = '3')
          OR
          (q.definition->>'responseType' = 'single_choice' AND opts.option_count = 4 AND
           opts.distinct_scoring_values = 4 AND opts.valid_scoring_values = 4)
        )
      ) INTO item_count, distinct_items, min_item, max_item, valid_questions
      FROM assessment_scoring_item_mappings m
      LEFT JOIN assessment_instrument_questions q ON q.instrument_version_id = m.instrument_version_id AND q.question_id = m.question_id
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS option_count,
               count(DISTINCT option_value->>'scoringValue')::integer AS distinct_scoring_values,
               (count(*) FILTER (WHERE option_value->>'scoringValue' IN ('0', '1', '2', '3')))::integer AS valid_scoring_values
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(q.definition->'options') = 'array' THEN q.definition->'options' ELSE '[]'::jsonb END
          ) AS option_row(option_value)
      ) AS opts ON true
      WHERE m.mapping_id = NEW.mapping_id;
    IF instrument_question_count <> 21 OR item_count <> 21 OR distinct_items <> 21 OR min_item <> 1 OR max_item <> 21 OR valid_questions <> 21 THEN
      RAISE EXCEPTION 'Scoring map must cover 21 distinct valid question references' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
