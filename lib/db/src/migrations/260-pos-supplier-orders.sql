-- test-bootstrap: schema
-- Supplier orders and reorder thresholds. Orders do not post inventory; a
-- confirmed linked receipt remains the only stock-affecting operation.

CREATE TABLE IF NOT EXISTS pos_supplier_reorder_settings (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  artikel_id integer NOT NULL,
  reorder_point numeric(18,6) NOT NULL,
  target_stock numeric(18,6) NOT NULL,
  preferred_mapping_id integer,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_supplier_reorder_settings_unit_article_uq UNIQUE (enota_id, artikel_id),
  CONSTRAINT pos_supplier_reorder_settings_article_unit_fk
    FOREIGN KEY (artikel_id, enota_id) REFERENCES artikli(id, enota_id) ON DELETE CASCADE,
  CONSTRAINT pos_supplier_reorder_settings_nonnegative_check CHECK (reorder_point >= 0),
  CONSTRAINT pos_supplier_reorder_settings_target_check CHECK (target_stock > reorder_point)
);

CREATE INDEX IF NOT EXISTS ix_pos_supplier_reorder_settings_unit
  ON pos_supplier_reorder_settings(enota_id);

CREATE TABLE IF NOT EXISTS pos_supplier_orders (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  dobavitelj_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  dobavitelj_naziv text NOT NULL,
  stevilka text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  datum_dobave date,
  opomba text,
  razlog_zaprtja text,
  ustvaril text,
  ustvarjeno timestamptz NOT NULL DEFAULT now(),
  posodobljeno timestamptz NOT NULL DEFAULT now(),
  poslano_dne timestamptz,
  zaprto_dne timestamptz,
  CONSTRAINT pos_supplier_orders_id_unit_uq UNIQUE (id, enota_id),
  CONSTRAINT pos_supplier_orders_status_check
    CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_supplier_orders_unit_number_uq
  ON pos_supplier_orders(enota_id, stevilka);
CREATE INDEX IF NOT EXISTS ix_pos_supplier_orders_unit_status_date
  ON pos_supplier_orders(enota_id, status, ustvarjeno);

CREATE TABLE IF NOT EXISTS pos_supplier_order_lines (
  id serial PRIMARY KEY,
  enota_id integer NOT NULL,
  narocilo_id integer NOT NULL,
  supplier_mapping_id integer NOT NULL,
  artikel_id integer NOT NULL,
  artikel_naziv text NOT NULL,
  dobaviteljev_naziv text,
  dobaviteljeva_sifra text,
  kolicina_pakiranj numeric(18,6) NOT NULL,
  faktor_pakiranja numeric(18,6) NOT NULL,
  naziv_pakiranja text,
  osnovna_enota text,
  cena_pakiranja numeric(15,6),
  CONSTRAINT pos_supplier_order_lines_order_unit_fk
    FOREIGN KEY (narocilo_id, enota_id)
    REFERENCES pos_supplier_orders(id, enota_id) ON DELETE CASCADE,
  CONSTRAINT pos_supplier_order_lines_article_unit_fk
    FOREIGN KEY (artikel_id, enota_id)
    REFERENCES artikli(id, enota_id) ON DELETE RESTRICT,
  CONSTRAINT pos_supplier_order_lines_package_qty_check CHECK (kolicina_pakiranj > 0),
  CONSTRAINT pos_supplier_order_lines_package_factor_check CHECK (faktor_pakiranja > 0),
  CONSTRAINT pos_supplier_order_lines_package_price_check
    CHECK (cena_pakiranja IS NULL OR cena_pakiranja >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_supplier_order_lines_order_mapping_uq
  ON pos_supplier_order_lines(narocilo_id, supplier_mapping_id);
CREATE INDEX IF NOT EXISTS ix_pos_supplier_order_lines_unit_article
  ON pos_supplier_order_lines(enota_id, artikel_id);

ALTER TABLE prejemnice_postavke
  ADD COLUMN IF NOT EXISTS supplier_order_line_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prejemnice_postavke_supplier_order_line_fk'
      AND conrelid = 'prejemnice_postavke'::regclass
  ) THEN
    ALTER TABLE prejemnice_postavke
      ADD CONSTRAINT prejemnice_postavke_supplier_order_line_fk
      FOREIGN KEY (supplier_order_line_id)
      REFERENCES pos_supplier_order_lines(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS prejemnice_postavke_supplier_order_line_receipt_uq
  ON prejemnice_postavke(prejemnica_id, supplier_order_line_id)
  WHERE supplier_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prejemnice_postavke_supplier_order_line
  ON prejemnice_postavke(supplier_order_line_id)
  WHERE supplier_order_line_id IS NOT NULL;
