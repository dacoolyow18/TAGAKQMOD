ALTER TABLE cash_logs
  ADD COLUMN branch_id text REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX cash_logs_branch_idx ON cash_logs (branch_id);
