BEGIN;

ALTER TABLE multicourse_menu_courses
  ADD COLUMN IF NOT EXISTS allowed_food_artikel_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Existing course rows had exactly one food component. Preserve that behavior
-- explicitly, while leaving the legacy column in place for older clients.
UPDATE multicourse_menu_courses
SET allowed_food_artikel_ids = jsonb_build_array(food_artikel_id)
WHERE allowed_food_artikel_ids = '[]'::jsonb;

COMMIT;