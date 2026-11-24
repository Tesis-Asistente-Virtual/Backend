CREATE TABLE IF NOT EXISTS dass21_version_publication_audit (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL,
  instrument_version_id uuid NOT NULL REFERENCES assessment_instrument_versions(instrument_version_id) ON DELETE RESTRICT,
  instrument_version varchar(40) NOT NULL,
  question_set_sha256 varchar(64) NOT NULL,
  operator_name varchar(200) NOT NULL,
  operator_role varchar(150) NOT NULL,
  decision_bundle jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT dass21_version_publication_audit_identity_fk
    FOREIGN KEY (instrument_version_id, instrument_id)
    REFERENCES assessment_instrument_versions(instrument_version_id, instrument_id) ON DELETE RESTRICT,
  CONSTRAINT dass21_version_publication_audit_hash_check
    CHECK (question_set_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS dass21_version_publication_audit_version_uq
  ON dass21_version_publication_audit (instrument_version_id);

CREATE OR REPLACE FUNCTION reject_dass21_publication_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DASS-21 publication audit events are append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dass21_version_publication_audit_immutable ON dass21_version_publication_audit;
CREATE TRIGGER dass21_version_publication_audit_immutable
  BEFORE UPDATE OR DELETE ON dass21_version_publication_audit
  FOR EACH ROW EXECUTE FUNCTION reject_dass21_publication_audit_mutation();
