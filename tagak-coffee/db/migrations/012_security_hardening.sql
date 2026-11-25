-- Record staff account_id on cash drawer logs and enforce bounded positive amounts and reason length.

ALTER TABLE cash_logs
  ADD COLUMN IF NOT EXISTS account_id text REFERENCES accounts(id) ON DELETE SET NULL;

DELETE FROM cash_logs WHERE amount <= 0 OR amount > 1000000;

ALTER TABLE cash_logs
  DROP CONSTRAINT IF EXISTS cash_logs_amount_check,
  ADD CONSTRAINT cash_logs_amount_bounds CHECK (amount > 0 AND amount <= 1000000),
  ADD CONSTRAINT cash_logs_reason_length CHECK (char_length(reason) <= 200);
