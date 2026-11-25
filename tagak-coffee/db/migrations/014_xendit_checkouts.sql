CREATE TABLE xendit_checkouts (
  id uuid PRIMARY KEY,
  request_id text NOT NULL UNIQUE,
  business_id text NOT NULL,
  quote jsonb NOT NULL,
  expires_at timestamptz,
  failed boolean NOT NULL DEFAULT false,
  payment_id text UNIQUE,
  ticket_no text UNIQUE REFERENCES orders(ticket_no),
  CHECK ((payment_id IS NULL) = (ticket_no IS NULL))
);
