-- Branch isolation for menu items, supplies, add-ons, carousel images, and settings.

ALTER TABLE menu_items
  ADD COLUMN branch_id text REFERENCES branches(id) ON DELETE CASCADE;

CREATE INDEX menu_items_branch_idx ON menu_items (branch_id);

ALTER TABLE supplies
  ADD COLUMN branch_id text REFERENCES branches(id) ON DELETE CASCADE;

CREATE INDEX supplies_branch_idx ON supplies (branch_id);

ALTER TABLE add_ons
  ADD COLUMN branch_id text REFERENCES branches(id) ON DELETE CASCADE;

CREATE INDEX add_ons_branch_idx ON add_ons (branch_id);

ALTER TABLE carousel_images
  ADD COLUMN branch_id text REFERENCES branches(id) ON DELETE CASCADE;

ALTER TABLE carousel_images
  DROP CONSTRAINT IF EXISTS carousel_images_position_key;

CREATE UNIQUE INDEX carousel_images_branch_pos_idx
  ON carousel_images (branch_id, position)
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX carousel_images_global_pos_idx
  ON carousel_images (position)
  WHERE branch_id IS NULL;

ALTER TABLE settings
  ADD COLUMN branch_id text NOT NULL DEFAULT '';

ALTER TABLE settings
  DROP CONSTRAINT settings_pkey;

ALTER TABLE settings
  ADD PRIMARY KEY (branch_id, key);
