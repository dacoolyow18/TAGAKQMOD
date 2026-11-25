ALTER TABLE orders
  ADD COLUMN payment_status text NOT NULL DEFAULT 'unknown'
    CHECK (payment_status IN ('unknown', 'unpaid', 'paid')),
  ADD COLUMN cash_collected_by text,
  ADD COLUMN cash_collected_at timestamptz,
  ADD COLUMN cash_retry_key uuid UNIQUE,
  ADD COLUMN cash_request_hash text;

-- Older regular cash tickets do not distinguish register sales from guest orders.
UPDATE orders SET payment_status = 'paid' WHERE payment = 'qr';
UPDATE orders o SET payment_status = 'paid', cash_collected_by = s.employee_id,
  cash_collected_at = o.time_in FROM pos_cash_transactions t
  JOIN pos_offline_shifts s ON s.id = t.shift_id WHERE o.ticket_no = t.ticket_no;
