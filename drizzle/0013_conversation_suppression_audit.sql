CREATE TABLE conversation_suppression_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  deleted_conversation_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_suppression_deleted_count_check CHECK (deleted_conversation_count > 0)
);

CREATE INDEX conversation_suppression_account_created_idx
  ON conversation_suppression_audits (account_id, created_at);
