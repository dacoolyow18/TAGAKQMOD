-- Strict branch ownership for products (drinks, pastries), supplies, and add-ons.
-- Rows created before branch isolation had branch_id NULL and were shown to every branch.
-- They now belong to the primary (oldest) branch only, and are stamped with its id.

CREATE OR REPLACE FUNCTION primary_branch_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT id FROM branches ORDER BY created_at, code LIMIT 1 $$;

UPDATE menu_items SET branch_id = primary_branch_id()
 WHERE branch_id IS NULL AND primary_branch_id() IS NOT NULL;

UPDATE supplies SET branch_id = primary_branch_id()
 WHERE branch_id IS NULL AND primary_branch_id() IS NOT NULL;

UPDATE add_ons SET branch_id = primary_branch_id()
 WHERE branch_id IS NULL AND primary_branch_id() IS NOT NULL;

UPDATE carousel_images c SET branch_id = primary_branch_id()
 WHERE c.branch_id IS NULL
   AND primary_branch_id() IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM carousel_images existing
      WHERE existing.branch_id = primary_branch_id()
        AND existing.position = c.position
   );

