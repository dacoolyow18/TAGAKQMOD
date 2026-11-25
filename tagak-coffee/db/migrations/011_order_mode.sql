-- Store whether an order is Dine-In ('dine-in') or Take-Out ('takeout')
-- so both customer-app and POS register orders persist their service mode
-- and baristas can see how to prepare and pack each order.

ALTER TABLE orders
  ADD COLUMN order_mode text NOT NULL DEFAULT 'dine-in';

ALTER TABLE orders
  ADD CONSTRAINT orders_order_mode_check CHECK (order_mode IN ('dine-in', 'takeout'));
