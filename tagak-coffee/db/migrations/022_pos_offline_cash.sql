CREATE TABLE pos_catalog_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id text NOT NULL REFERENCES branches,
  fingerprint text NOT NULL, catalog jsonb NOT NULL, UNIQUE(branch_id, fingerprint)
);
CREATE TABLE pos_offline_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id text NOT NULL, device_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES pos_catalog_snapshots, issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, can_fulfill boolean NOT NULL
);
CREATE TABLE pos_cash_transactions (
  id uuid PRIMARY KEY, shift_id uuid NOT NULL REFERENCES pos_offline_shifts,
  ticket_no text NOT NULL UNIQUE REFERENCES orders, fingerprint text NOT NULL,
  tender numeric(12,2) NOT NULL CHECK (tender >= 0), change_due numeric(12,2) NOT NULL CHECK (change_due >= 0),
  emergency boolean NOT NULL, committed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pos_offline_events (
  id uuid PRIMARY KEY, sale_id uuid NOT NULL REFERENCES pos_cash_transactions,
  status text NOT NULL, occurred_at timestamptz NOT NULL, UNIQUE(sale_id,status)
);
CREATE TABLE pos_recovery_audit (
  operation_id uuid PRIMARY KEY, sale_id uuid NOT NULL REFERENCES pos_cash_transactions,
  manager_id text NOT NULL, recovered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pos_inventory_discrepancies (
  ticket_no text PRIMARY KEY REFERENCES orders, usage jsonb NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by text
);
UPDATE role_permissions SET permissions = permissions || '{"fulfill_own_offline_orders":true}'::jsonb
 WHERE role='Cashier' AND NOT permissions ? 'fulfill_own_offline_orders';
DO $$
DECLARE tbl text; role_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['pos_catalog_snapshots','pos_offline_shifts','pos_cash_transactions','pos_offline_events','pos_inventory_discrepancies','pos_recovery_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tbl);
    FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
      EXECUTE format('REVOKE ALL ON %I FROM %I',tbl,role_name);
    END LOOP;
  END LOOP;
END $$;
