ALTER TABLE orders ADD COLUMN tracking_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX orders_tracking_token_key ON orders (tracking_token);
