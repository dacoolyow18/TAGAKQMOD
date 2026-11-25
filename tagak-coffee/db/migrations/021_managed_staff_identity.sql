ALTER TABLE accounts ADD COLUMN auth_user_id uuid UNIQUE;
ALTER TABLE sessions ADD COLUMN auth_provider text NOT NULL DEFAULT 'local'
  CHECK (auth_provider IN ('local','supabase'));
