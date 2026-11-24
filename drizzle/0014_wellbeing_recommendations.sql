ALTER TABLE conversational_signal_analyses
  ADD CONSTRAINT conversational_signal_analyses_id_account_uq UNIQUE (analysis_id, account_id);

ALTER TABLE consent_notice_versions
  DROP CONSTRAINT consent_notice_purpose_check;
ALTER TABLE consent_notice_versions
  ADD CONSTRAINT consent_notice_purpose_check
  CHECK (purpose IN ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations', 'longitudinal_monitoring', 'preliminary_assessment'));

ALTER TABLE account_consent_events
  DROP CONSTRAINT account_consent_purpose_check;
ALTER TABLE account_consent_events
  ADD CONSTRAINT account_consent_purpose_check
  CHECK (purpose IN ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations', 'longitudinal_monitoring', 'preliminary_assessment'));

CREATE TABLE wellbeing_recommendations (
  recommendation_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  source_analysis_id uuid NOT NULL,
  consent_notice_version_id uuid NOT NULL REFERENCES consent_notice_versions(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL,
  generation_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  generated_at timestamptz,
  expires_at timestamptz NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wellbeing_recommendations_source_owner_fk
    FOREIGN KEY (source_analysis_id, account_id)
    REFERENCES conversational_signal_analyses(analysis_id, account_id) ON DELETE CASCADE,
  CONSTRAINT wellbeing_recommendations_status_check
    CHECK (status IN ('generating', 'available')),
  CONSTRAINT wellbeing_recommendations_payload_state_check
    CHECK ((status = 'generating' AND payload IS NULL AND generated_at IS NULL) OR
           (status = 'available' AND payload IS NOT NULL AND generated_at IS NOT NULL)),
  CONSTRAINT wellbeing_recommendations_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT wellbeing_recommendations_source_analysis_uq UNIQUE(source_analysis_id)
);

CREATE INDEX wellbeing_recommendations_owner_latest_idx
  ON wellbeing_recommendations(account_id, generated_at DESC);
CREATE INDEX wellbeing_recommendations_expiry_idx
  ON wellbeing_recommendations(expires_at);
