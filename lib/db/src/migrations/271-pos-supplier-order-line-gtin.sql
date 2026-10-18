-- test-bootstrap: schema
-- Snapshot of the supplier's EAN on each order line, so later changes to the
-- supplier mapping do not alter old orders. Older lines stay NULL and fall back
-- to the current mapping when displayed.
ALTER TABLE pos_supplier_order_lines ADD COLUMN IF NOT EXISTS dobaviteljev_ean text;
