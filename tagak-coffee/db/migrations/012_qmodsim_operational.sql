-- QMODSIM Operational & Simulation Schema Migration (Modules 1-12)
-- 1. Expand orders status check constraint to support full DTMC 7-state lifecycle:
--    S0: held (Cart/Held), S1: queued, S2: brewing, S3: ready,
--    S4: completed (Absorbing), S5: cancelled (Canceled/Voided Absorbing), S6: refunded (Absorbing)

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('held', 'queued', 'brewing', 'ready', 'completed', 'cancelled', 'refunded'));

-- 2. Add multi-channel tracking ('pos' vs 'mobile'), intermediate queue latency timestamps,
--    void/refund authorization metadata, and offline queue idempotency + HMAC signature columns.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'pos' CHECK (channel IN ('pos', 'mobile')),
  ADD COLUMN IF NOT EXISTS brewing_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE,
  ADD COLUMN IF NOT EXISTS offline_signature text NOT NULL DEFAULT '';

-- 3. Empirical DTMC state transition log table (Module 5)
CREATE TABLE IF NOT EXISTS order_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL REFERENCES orders(ticket_no) ON DELETE CASCADE,
  branch_id text,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_id text,
  approved_by text,
  reason text NOT NULL DEFAULT '',
  transitioned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_transitions_ticket_idx ON order_state_transitions (ticket_no);
CREATE INDEX IF NOT EXISTS order_transitions_branch_idx ON order_state_transitions (branch_id);

-- 4. Blind Shift Drawer Reconciliation table (Module 4: FAIR Risk & Cash Shrinkage)
CREATE TABLE IF NOT EXISTS shift_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id text,
  cashier_id text,
  cashier_name text NOT NULL DEFAULT '',
  counted_cash numeric(12, 2) NOT NULL CHECK (counted_cash >= 0),
  expected_cash numeric(12, 2) NOT NULL,
  discrepancy numeric(12, 2) NOT NULL,
  cash_sales_total numeric(12, 2) NOT NULL DEFAULT 0,
  pay_in_total numeric(12, 2) NOT NULL DEFAULT 0,
  pay_out_total numeric(12, 2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_reconciliations_branch_idx ON shift_reconciliations (branch_id, created_at DESC);

-- 5. Cashier Audit & Void Authorization Log table (Module 7: Game Theory Inspection Game)
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id text,
  ticket_no text,
  event_type text NOT NULL CHECK (event_type IN ('void_override', 'refund_override', 'spot_audit', 'offline_sync_verified', 'offline_tamper_rejected')),
  cashier_id text,
  manager_id text,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  spot_audit_triggered boolean NOT NULL DEFAULT false,
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
