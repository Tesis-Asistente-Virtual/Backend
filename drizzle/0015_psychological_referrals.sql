ALTER TABLE consent_notice_versions
  DROP CONSTRAINT consent_notice_purpose_check;
ALTER TABLE consent_notice_versions
  ADD CONSTRAINT consent_notice_purpose_check
  CHECK (purpose IN ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations', 'psychological_referral_sharing', 'longitudinal_monitoring', 'preliminary_assessment'));

ALTER TABLE account_consent_events
  DROP CONSTRAINT account_consent_purpose_check;
ALTER TABLE account_consent_events
  ADD CONSTRAINT account_consent_purpose_check
  CHECK (purpose IN ('ai_conversation_processing', 'structured_signal_extraction', 'conversational_signal_analysis', 'wellbeing_recommendations', 'psychological_referral_sharing', 'longitudinal_monitoring', 'preliminary_assessment'));

CREATE TABLE psychological_referrals (
  referral_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  source_analysis_id uuid REFERENCES conversational_signal_analyses(analysis_id) ON DELETE SET NULL,
  source_analysis_attached boolean NOT NULL DEFAULT false,
  consent_notice_version_id uuid NOT NULL REFERENCES consent_notice_versions(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL,
  recipient varchar(320) NOT NULL,
  reason text,
  report jsonb,
  preview_hash varchar(64),
  create_idempotency_key uuid NOT NULL,
  send_idempotency_key uuid,
  send_attempt_id uuid,
  delivery_reference varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT psychological_referrals_status_check
    CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'delivery_unknown', 'cancelled')),
  CONSTRAINT psychological_referrals_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) <= 1200),
  CONSTRAINT psychological_referrals_preview_shape_check
    CHECK ((status = 'cancelled' AND report IS NULL AND preview_hash IS NULL) OR
           (status <> 'cancelled' AND report IS NOT NULL AND preview_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT psychological_referrals_source_shape_check
    CHECK (source_analysis_attached OR source_analysis_id IS NULL),
  CONSTRAINT psychological_referrals_send_state_check
    CHECK ((status IN ('draft', 'cancelled') AND send_attempt_id IS NULL AND send_idempotency_key IS NULL AND sent_at IS NULL) OR
           (status IN ('sending', 'sent', 'failed', 'delivery_unknown') AND send_attempt_id IS NOT NULL AND send_idempotency_key IS NOT NULL AND
            ((status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL))))
);

CREATE UNIQUE INDEX psychological_referrals_account_create_idempotency_uq
  ON psychological_referrals(account_id, create_idempotency_key);
CREATE UNIQUE INDEX psychological_referrals_account_send_idempotency_uq
  ON psychological_referrals(account_id, send_idempotency_key)
  WHERE send_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX psychological_referrals_send_attempt_uq
  ON psychological_referrals(send_attempt_id)
  WHERE send_attempt_id IS NOT NULL;
CREATE INDEX psychological_referrals_owner_created_idx
  ON psychological_referrals(account_id, created_at DESC);
