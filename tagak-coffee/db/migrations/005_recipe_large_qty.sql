ALTER TABLE menu_item_recipes
  ADD COLUMN large_qty numeric(12, 3) CHECK (large_qty IS NULL OR large_qty > 0);
