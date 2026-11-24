ALTER TABLE consent_notice_versions
  DROP CONSTRAINT consent_notice_purpose_check;
ALTER TABLE consent_notice_versions
  ADD CONSTRAINT consent_notice_purpose_check
  CHECK (purpose IN ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'longitudinal_monitoring', 'preliminary_assessment'));

ALTER TABLE account_consent_events
  DROP CONSTRAINT account_consent_purpose_check;
ALTER TABLE account_consent_events
  ADD CONSTRAINT account_consent_purpose_check
  CHECK (purpose IN ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'longitudinal_monitoring', 'preliminary_assessment'));

CREATE TABLE conversational_signal_analyses (
  analysis_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  consent_notice_version_id uuid NOT NULL REFERENCES consent_notice_versions(id) ON DELETE RESTRICT,
  analysis_version varchar(40) NOT NULL,
  model_version varchar(100) NOT NULL,
  analyzed_at timestamptz NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT conversational_signal_analyses_owner_fk
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations(id, account_id) ON DELETE CASCADE,
  CONSTRAINT conversational_signal_analyses_period_check
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  CONSTRAINT conversational_signal_analyses_expiry_check
    CHECK (expires_at > analyzed_at)
);

CREATE INDEX conversational_signal_analyses_owner_latest_idx
  ON conversational_signal_analyses (account_id, analyzed_at DESC);
CREATE INDEX conversational_signal_analyses_expiry_idx
  ON conversational_signal_analyses (expires_at);
