-- 035: trajno zapiranje POS prejemnic (konto 109) s prejetim računom.
-- Prejemnica se lahko uporabi samo pri enem računu; račun lahko zajame več enot
-- istega podjetja. Pripadnost podjetju in dobavitelju dodatno preverja API.

CREATE TABLE IF NOT EXISTS pos_invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  prejemnica_id integer NOT NULL REFERENCES prejemnice(id) ON DELETE RESTRICT,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('delivery_note_invoice', 'invoice_with_delivery_notes')),
  match_method text NOT NULL CHECK (match_method IN ('manual', 'suggested', 'exact')),
  matched_by text NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_invoice_links_prejemnica_unique
  ON pos_invoice_links(prejemnica_id);
CREATE UNIQUE INDEX IF NOT EXISTS pos_invoice_links_invoice_prejemnica_unique
  ON pos_invoice_links(invoice_id, prejemnica_id);
CREATE UNIQUE INDEX IF NOT EXISTS pos_invoice_links_company_invoice_prejemnica_unique
  ON pos_invoice_links(company_id, invoice_id, prejemnica_id);
CREATE INDEX IF NOT EXISTS pos_invoice_links_company_invoice_idx
  ON pos_invoice_links(company_id, invoice_id);