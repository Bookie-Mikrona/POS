CREATE TABLE IF NOT EXISTS pos_event_menu_items (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES pos_events(id) ON DELETE CASCADE,
  target_unit_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  source_article_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  target_article_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,target_unit_id,source_article_id), UNIQUE(event_id,target_unit_id,target_article_id)
);
CREATE TABLE IF NOT EXISTS pos_event_staff_grants (
  id serial PRIMARY KEY, event_id integer NOT NULL REFERENCES pos_events(id) ON DELETE CASCADE,
  pos_user_id integer NOT NULL REFERENCES pos_uporabniki(id) ON DELETE CASCADE,
  unit_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL, valid_to timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,pos_user_id,unit_id)
);
CREATE INDEX IF NOT EXISTS ix_pos_event_staff_active ON pos_event_staff_grants(pos_user_id,unit_id,valid_from,valid_to);
CREATE TABLE IF NOT EXISTS pos_stock_transfers (
  id serial PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  event_id integer NOT NULL REFERENCES pos_events(id) ON DELETE RESTRICT,
  source_unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  target_unit_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK(direction IN ('outbound','return')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed','cancelled')),
  return_of_id integer REFERENCES pos_stock_transfers(id) ON DELETE RESTRICT,
  created_by text NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,source_unit_id,target_unit_id,direction), CHECK(source_unit_id <> target_unit_id)
);
CREATE TABLE IF NOT EXISTS pos_stock_transfer_lines (
  id serial PRIMARY KEY, transfer_id integer NOT NULL REFERENCES pos_stock_transfers(id) ON DELETE CASCADE,
  source_article_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  target_article_id integer NOT NULL REFERENCES artikli(id) ON DELETE RESTRICT,
  quantity numeric(10,4) NOT NULL CHECK(quantity > 0),
  unit_cost numeric(14,6) NOT NULL CHECK(unit_cost >= 0),
  UNIQUE(transfer_id,source_article_id)
);