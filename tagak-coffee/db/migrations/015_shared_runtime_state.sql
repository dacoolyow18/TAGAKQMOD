CREATE TABLE request_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route text NOT NULL,
  ip text NOT NULL,
  email text NOT NULL,
  threshold integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX request_attempts_ip ON request_attempts(route, ip, expires_at);
CREATE INDEX request_attempts_email ON request_attempts(email, route, expires_at);
CREATE INDEX request_attempts_expiry ON request_attempts(expires_at);

CREATE TABLE oauth_states (
  state text PRIMARY KEY,
  return_url text,
  expires_at timestamptz NOT NULL
);

-- These internal tables are accessed only through the server's PostgreSQL role.
ALTER TABLE request_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
