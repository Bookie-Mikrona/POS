-- test-bootstrap: schema
-- Pizza-size dough portions are unit-owned; do not add their ingredients to pizza norms.
CREATE TABLE IF NOT EXISTS pizza_dough_settings (
  enota_id integer PRIMARY KEY
    REFERENCES enote(id) ON DELETE CASCADE,
  normal_dough_article_id integer NOT NULL,
  small_dough_article_id integer NOT NULL,
  CONSTRAINT pizza_dough_settings_normal_article_unit_fk
    FOREIGN KEY (normal_dough_article_id, enota_id)
    REFERENCES artikli(id, enota_id) ON DELETE RESTRICT,
  CONSTRAINT pizza_dough_settings_small_article_unit_fk
    FOREIGN KEY (small_dough_article_id, enota_id)
    REFERENCES artikli(id, enota_id) ON DELETE RESTRICT
);

ALTER TABLE postavke
  ADD COLUMN IF NOT EXISTS pizza_dough_article_id integer;