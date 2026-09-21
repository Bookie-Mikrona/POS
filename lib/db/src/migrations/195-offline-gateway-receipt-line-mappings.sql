-- test-bootstrap: schema
-- Durable primed-gateway source line bindings.  Additive and safe for
-- bootstrap/test databases that may already have the table.
CREATE TABLE IF NOT EXISTS offline_gateway_receipt_line_mappings (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES offline_fiscal_receipts(id) ON DELETE RESTRICT,
  source_line_ref text NOT NULL,
  cloud_line_id integer NOT NULL REFERENCES postavke(id) ON DELETE RESTRICT,
  company_id text NOT NULL,
  enota_id integer NOT NULL,
  order_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS offline_gateway_receipt_line_mappings_receipt_source
  ON offline_gateway_receipt_line_mappings(receipt_id, source_line_ref);
CREATE UNIQUE INDEX IF NOT EXISTS offline_gateway_receipt_line_mappings_receipt_cloud
  ON offline_gateway_receipt_line_mappings(receipt_id, cloud_line_id);