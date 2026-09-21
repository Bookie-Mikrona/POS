BEGIN;

ALTER TABLE multicourse_menus
  ADD COLUMN IF NOT EXISTS selection_mode text NOT NULL DEFAULT 'fixed'
    CHECK (selection_mode IN ('fixed', 'choose')),
  ADD COLUMN IF NOT EXISTS selection_count smallint;
ALTER TABLE multicourse_menus
  DROP CONSTRAINT IF EXISTS multicourse_menus_selection_count_check;
ALTER TABLE multicourse_menus
  ADD CONSTRAINT multicourse_menus_selection_count_check
    CHECK (selection_count IS NULL OR selection_count BETWEEN 1 AND 20);

UPDATE multicourse_menus
SET selection_mode = 'choose',
    selection_count = 3
WHERE izbor = 'choose_three'
  AND selection_mode = 'fixed'
  AND selection_count IS NULL;

ALTER TABLE multicourse_menu_courses
  ADD COLUMN IF NOT EXISTS course_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS wine_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS informational boolean NOT NULL DEFAULT false;
ALTER TABLE multicourse_menu_courses
  DROP CONSTRAINT IF EXISTS multicourse_menu_courses_course_number_check,
  DROP CONSTRAINT IF EXISTS multicourse_menu_courses_number_check,
  DROP CONSTRAINT IF EXISTS multicourse_menu_courses_informational_wine_check;
ALTER TABLE multicourse_menu_courses
  ADD CONSTRAINT multicourse_menu_courses_number_check
  CHECK (course_number BETWEEN 1 AND 20),
  ADD CONSTRAINT multicourse_menu_courses_informational_wine_check
  CHECK (NOT informational OR NOT wine_required);

UPDATE multicourse_menu_courses
SET course_name = course_number::text || '. hod',
    wine_required = true,
    informational = false
WHERE course_name = '';

COMMIT;