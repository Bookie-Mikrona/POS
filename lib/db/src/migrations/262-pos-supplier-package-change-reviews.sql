-- test-bootstrap: audit
CREATE TABLE IF NOT EXISTS pos_supplier_package_change_reviews (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  prejemnica_id integer NOT NULL REFERENCES prejemnice(id) ON DELETE RESTRICT,
  supplier_order_line_id integer NOT NULL
    REFERENCES pos_supplier_order_lines(id) ON DELETE RESTRICT,
  article_name text NOT NULL,
  order_package_name text,
  order_factor numeric(18, 6),
  order_base_unit text,
  current_package_name text,
  current_factor numeric(18, 6),
  current_base_unit text,
  actor_clerk_user_id text NOT NULL,
  actor_natakar_id integer,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_supplier_package_change_reviews_receipt_line_uq
    UNIQUE (prejemnica_id, supplier_order_line_id)
);

CREATE INDEX IF NOT EXISTS pos_supplier_package_change_reviews_unit_receipt_time_idx
  ON pos_supplier_package_change_reviews (enota_id, prejemnica_id, reviewed_at);

CREATE OR REPLACE FUNCTION prevent_pos_supplier_package_change_reviews_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pos_supplier_package_change_reviews is append-only';
END;
$$;

DROP TRIGGER IF EXISTS pos_supplier_package_change_reviews_append_only
  ON pos_supplier_package_change_reviews;
CREATE TRIGGER pos_supplier_package_change_reviews_append_only
BEFORE UPDATE OR DELETE ON pos_supplier_package_change_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_pos_supplier_package_change_reviews_mutation();

DROP TRIGGER IF EXISTS pos_supplier_package_change_reviews_truncate_guard
  ON pos_supplier_package_change_reviews;
CREATE TRIGGER pos_supplier_package_change_reviews_truncate_guard
BEFORE TRUNCATE ON pos_supplier_package_change_reviews
FOR EACH STATEMENT EXECUTE FUNCTION prevent_pos_supplier_package_change_reviews_mutation();
