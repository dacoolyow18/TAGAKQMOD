CREATE TABLE media_uploads (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  object_path text UNIQUE NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  branch_id text REFERENCES branches(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  result jsonb
);
ALTER TABLE media_uploads ENABLE ROW LEVEL SECURITY;
