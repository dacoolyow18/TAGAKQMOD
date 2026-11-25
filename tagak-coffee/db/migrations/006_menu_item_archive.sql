-- Soft delete for menu items. Deleting an item archives it instead of removing
-- the row, so past orders, recipes, and reports keep pointing at real data.
ALTER TABLE menu_items
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz;

-- Items the old delete route "deactivated" stay as unpublished drafts; there is
-- nothing to backfill. Keep the flag and its timestamp in step.
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_archived_at_matches
  CHECK ((is_archived AND archived_at IS NOT NULL) OR (NOT is_archived AND archived_at IS NULL));

CREATE INDEX menu_items_active_menu_idx ON menu_items (category, name) WHERE NOT is_archived;
