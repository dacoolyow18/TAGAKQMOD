CREATE TABLE add_on_supplies (
  add_on_id uuid NOT NULL REFERENCES add_ons(id) ON DELETE CASCADE,
  supply_id text NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  qty numeric(12, 3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (add_on_id, supply_id)
);
