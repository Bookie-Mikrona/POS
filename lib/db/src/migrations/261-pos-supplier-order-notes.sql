-- test-bootstrap: schema
-- Keep the existing single-field notes as internal notes. Supplier-facing
-- instructions use a separate field so internal text is never printed.

ALTER TABLE pos_supplier_orders
  ADD COLUMN IF NOT EXISTS navodilo_dobavitelju text;
