ALTER TABLE orders
  ADD COLUMN supply_usage jsonb NOT NULL DEFAULT '{}'::jsonb;
