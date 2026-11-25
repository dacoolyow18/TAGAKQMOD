-- Customer nickname attached to each order so the barista can verify who is
-- claiming a drink, even if the customer's page refreshed or lost signal.
-- Customer-app orders must carry one; POS-entered orders may leave it blank.

ALTER TABLE orders
  ADD COLUMN customer_name text NOT NULL DEFAULT '';

ALTER TABLE orders
  ADD CONSTRAINT orders_customer_name_length CHECK (char_length(customer_name) <= 30);
