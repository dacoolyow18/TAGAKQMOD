CREATE TABLE payrex_checkouts (
  id uuid PRIMARY KEY,
  intent_id text NOT NULL UNIQUE,
  quote jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  paid_event_id text UNIQUE,
  ticket_no text UNIQUE REFERENCES orders(ticket_no),
  CHECK ((paid_event_id IS NULL) = (ticket_no IS NULL))
);
