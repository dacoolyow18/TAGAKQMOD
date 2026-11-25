ALTER TABLE orders ADD COLUMN cash_due_at timestamptz, ADD COLUMN cash_expired boolean NOT NULL DEFAULT false;
UPDATE orders SET cash_due_at=time_in + interval '5 minutes'
 WHERE payment='cash' AND payment_status='unpaid' AND status='queued';
CREATE INDEX orders_pending_cash_due ON orders(cash_due_at)
 WHERE payment_status='unpaid' AND status='queued';
