BEGIN;

CREATE TABLE IF NOT EXISTS multicourse_menus (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  menu_artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE CASCADE,
  izbor text NOT NULL CHECK (izbor IN ('fixed_four', 'choose_three')),
  aktivno boolean NOT NULL DEFAULT true,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT multicourse_menus_article_unique UNIQUE (menu_artikel_id)
);
CREATE INDEX IF NOT EXISTS ix_multicourse_menus_enota ON multicourse_menus (enota_id, aktivno);

CREATE TABLE IF NOT EXISTS multicourse_menu_courses (
  id serial PRIMARY KEY,
  menu_id integer NOT NULL REFERENCES multicourse_menus(id) ON DELETE CASCADE,
  course_number smallint NOT NULL CHECK (course_number BETWEEN 1 AND 4),
  food_artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  allowed_wine_artikel_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT multicourse_menu_courses_number_unique UNIQUE (menu_id, course_number)
);

CREATE TABLE IF NOT EXISTS qr_waiter_requests (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  miza_id integer NOT NULL REFERENCES mize(id) ON DELETE CASCADE,
  qr_naprava_id text NOT NULL,
  stanje text NOT NULL DEFAULT 'caka' CHECK (stanje IN ('caka', 'potrjeno', 'zakljuceno')),
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  potrjeno timestamptz,
  zakljuceno timestamptz,
  actor_clerk_user_id text
);
CREATE INDEX IF NOT EXISTS ix_qr_waiter_requests_enota_stanje ON qr_waiter_requests (enota_id, stanje, ustvarjeno);
CREATE INDEX IF NOT EXISTS ix_qr_waiter_requests_table_device ON qr_waiter_requests (enota_id, miza_id, qr_naprava_id, stanje);

COMMIT;