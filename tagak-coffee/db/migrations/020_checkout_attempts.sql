CREATE TABLE xendit_checkout_attempts (
  retry_key uuid PRIMARY KEY,
  checkout_id uuid NOT NULL UNIQUE,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  qr_image text
);
CREATE INDEX xendit_attempts_created_idx ON xendit_checkout_attempts(created_at);
ALTER TABLE xendit_checkout_attempts ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON xendit_checkout_attempts FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON xendit_checkout_attempts FROM PUBLIC;
