-- test-bootstrap: schema

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS destination_iban text,
  ADD COLUMN IF NOT EXISTS destination_bic text,
  ADD COLUMN IF NOT EXISTS payment_model text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_purpose text;

UPDATE invoices AS i
SET
  due_date = COALESCE(i.due_date, p.datum_zapadlosti),
  destination_iban = COALESCE(i.destination_iban, NULLIF(upper(regexp_replace(p.dobavitelj_iban, '\s+', '', 'g')), '')),
  destination_bic = COALESCE(i.destination_bic, NULLIF(upper(regexp_replace(p.dobavitelj_bic, '\s+', '', 'g')), '')),
  payment_model = COALESCE(i.payment_model, NULLIF(btrim(p.placilni_model), '')),
  payment_reference = COALESCE(i.payment_reference, NULLIF(btrim(p.placilni_sklic), '')),
  payment_purpose = COALESCE(i.payment_purpose, NULLIF(btrim(p.placilni_namen), ''))
FROM pos_invoice_links AS l
JOIN prejemnice AS p ON p.id = l.prejemnica_id
WHERE l.invoice_id = i.id
  AND l.mode = 'delivery_note_invoice'
  AND i.type = 'received';