CREATE TABLE accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('Super Admin', 'Admin', 'Manager', 'Barista', 'Cashier')),
  email text UNIQUE CHECK (email IS NULL OR email = lower(email)),
  phone text NOT NULL DEFAULT '',
  password_hash text,
  pin text UNIQUE CHECK (pin IS NULL OR pin ~ '^[0-9]{4}$'),
  branch_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  location text NOT NULL DEFAULT '',
  manager_id text REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE accounts
  ADD CONSTRAINT accounts_branch_fk FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

CREATE TABLE role_permissions (
  role text PRIMARY KEY CHECK (role IN ('Super Admin', 'Admin', 'Manager', 'Barista', 'Cashier')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_items (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Drinks', 'Pastries')),
  price numeric(10, 2) NOT NULL CHECK (price >= 0),
  description text NOT NULL DEFAULT '',
  has_temperature boolean NOT NULL DEFAULT false,
  image_path text NOT NULL DEFAULT '',
  sold_out boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_temperature_drinks_only CHECK (category = 'Drinks' OR has_temperature = false)
);

CREATE TABLE supplies (
  id text PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL,
  stock numeric(12, 3) NOT NULL DEFAULT 0
);

CREATE TABLE supply_price_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id text NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  price numeric(12, 4) NOT NULL CHECK (price >= 0),
  effective_at timestamptz NOT NULL
);

CREATE TABLE menu_item_recipes (
  menu_item_id text NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  supply_id text NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  qty numeric(12, 3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (menu_item_id, supply_id)
);

CREATE TABLE add_ons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  applies_to text NOT NULL CHECK (applies_to IN ('drink', 'pastry')),
  price numeric(10, 2) NOT NULL CHECK (price >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('payIn', 'payOut')),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carousel_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position integer NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 5),
  file_path text NOT NULL,
  public_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE ticket_counters (
  day date PRIMARY KEY,
  last_value integer NOT NULL CHECK (last_value >= 0)
);

CREATE TABLE orders (
  ticket_no text PRIMARY KEY CHECK (ticket_no ~ '^TK-[0-9]{8}-[0-9]{4,}$'),
  order_date date NOT NULL,
  branch_id text REFERENCES branches(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued', 'brewing', 'ready', 'completed', 'cancelled')),
  payment text NOT NULL CHECK (payment IN ('cash', 'qr')),
  items jsonb NOT NULL,
  subtotal numeric(12, 2) NOT NULL,
  vat numeric(12, 2) NOT NULL,
  total numeric(12, 2) NOT NULL,
  time_in timestamptz NOT NULL,
  time_out timestamptz
);

CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_order_date_idx ON orders (order_date);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
