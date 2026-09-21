-- 114: skupna identiteta dobaviteljeve listine čez POS uvoz, ERP OCR in ERP prejem blaga.

CREATE TABLE IF NOT EXISTS purchase_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('invoice', 'delivery_note', 'credit_note', 'debit_note')),
  normalized_number text,
  display_number text,
  document_date date,
  currency text NOT NULL DEFAULT 'EUR',
  content_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (normalized_number IS NOT NULL OR content_sha256 IS NOT NULL)
);

DROP INDEX IF EXISTS purchase_source_documents_business_unique;
CREATE UNIQUE INDEX purchase_source_documents_business_unique
  ON purchase_source_documents(company_id, counterparty_id, normalized_number)
  WHERE normalized_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_source_documents_hash_unique
  ON purchase_source_documents(company_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_source_documents_company_idx
  ON purchase_source_documents(company_id);
CREATE INDEX IF NOT EXISTS purchase_source_documents_counterparty_idx
  ON purchase_source_documents(counterparty_id);

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES purchase_source_documents(id) ON DELETE RESTRICT;
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES purchase_source_documents(id) ON DELETE RESTRICT;
ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES purchase_source_documents(id) ON DELETE RESTRICT;
ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES purchase_source_documents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_document_unique
  ON invoices(source_document_id) WHERE source_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_source_document_unique
  ON goods_receipts(source_document_id) WHERE source_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS prejemnice_source_document_unique
  ON prejemnice(source_document_id) WHERE source_document_id IS NOT NULL;

-- Legacy backfill. Datum namenoma ni del poslovne identitete; uporablja se le
-- kot metapodatek. Če ima isti tok več zapisov iste identitete, skupine ne
-- povežemo samodejno, ampak jo zabeležimo za ročno razrešitev.
CREATE TABLE IF NOT EXISTS purchase_source_document_conflicts (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  normalized_number text NOT NULL,
  reason text NOT NULL,
  records jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_source_document_conflicts_open_unique
  ON purchase_source_document_conflicts(company_id, counterparty_id, normalized_number, reason)
  WHERE resolved_at IS NULL;

DROP TABLE IF EXISTS purchase_source_backfill_candidates;
CREATE TEMP TABLE purchase_source_backfill_candidates (
  source_table text NOT NULL,
  source_pk text NOT NULL,
  company_id uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  normalized_number text NOT NULL,
  display_number text NOT NULL,
  document_date date,
  currency text NOT NULL,
  kind text NOT NULL
);

INSERT INTO purchase_source_backfill_candidates
  (source_table, source_pk, company_id, counterparty_id, normalized_number,
   display_number, document_date, currency, kind)
SELECT 'invoices', i.id::text, i.company_id, i.counterparty_id,
       regexp_replace(upper(normalize(i.invoice_number, NFKC)), '[[:space:][:punct:]]', '', 'g'),
       i.invoice_number, i.invoice_date, 'EUR', 'invoice'
  FROM invoices i
 WHERE i.type = 'received'
   AND i.source_document_id IS NULL
   AND nullif(trim(i.invoice_number), '') IS NOT NULL
   AND regexp_replace(upper(normalize(i.invoice_number, NFKC)), '[[:space:][:punct:]]', '', 'g') <> '';

INSERT INTO purchase_source_backfill_candidates
  (source_table, source_pk, company_id, counterparty_id, normalized_number,
   display_number, document_date, currency, kind)
SELECT 'goods_receipts', gr.id::text, gr.company_id, gr.counterparty_id,
       regexp_replace(upper(normalize(gr.delivery_note_no, NFKC)), '[[:space:][:punct:]]', '', 'g'),
       gr.delivery_note_no, gr.receipt_date, 'EUR', 'delivery_note'
  FROM goods_receipts gr
 WHERE gr.source_document_id IS NULL
   AND nullif(trim(gr.delivery_note_no), '') IS NOT NULL
   AND regexp_replace(upper(normalize(gr.delivery_note_no, NFKC)), '[[:space:][:punct:]]', '', 'g') <> '';

INSERT INTO purchase_source_backfill_candidates
  (source_table, source_pk, company_id, counterparty_id, normalized_number,
   display_number, document_date, currency, kind)
SELECT 'prejemnice', p.id::text, e.company_id, p.dobavitelj_id,
       regexp_replace(upper(normalize(p.st_dokumenta, NFKC)), '[[:space:][:punct:]]', '', 'g'),
       p.st_dokumenta, p.datum_dokumenta, coalesce(p.valuta, 'EUR'),
       CASE p.vrsta_dokumenta::text
         WHEN 'RACUN' THEN 'invoice'
         WHEN 'DOBROPIS' THEN 'credit_note'
         WHEN 'BREMEPIS' THEN 'debit_note'
         ELSE 'delivery_note'
       END
  FROM prejemnice p
  JOIN enote e ON e.id = p.enota_id
 WHERE p.source_document_id IS NULL
   AND p.dobavitelj_id IS NOT NULL
   AND nullif(trim(p.st_dokumenta), '') IS NOT NULL
   AND regexp_replace(upper(normalize(p.st_dokumenta, NFKC)), '[[:space:][:punct:]]', '', 'g') <> '';

WITH ambiguous AS (
  SELECT company_id, counterparty_id, normalized_number
    FROM purchase_source_backfill_candidates
   GROUP BY company_id, counterparty_id, normalized_number
  HAVING count(*) FILTER (WHERE source_table = 'invoices') > 1
      OR count(*) FILTER (WHERE source_table = 'goods_receipts') > 1
      OR count(*) FILTER (WHERE source_table = 'prejemnice') > 1
), details AS (
  SELECT c.company_id, c.counterparty_id, c.normalized_number,
         jsonb_agg(
           jsonb_build_object('table', c.source_table, 'id', c.source_pk)
           ORDER BY c.source_table, c.source_pk
         ) AS records
    FROM purchase_source_backfill_candidates c
    JOIN ambiguous a USING (company_id, counterparty_id, normalized_number)
   GROUP BY c.company_id, c.counterparty_id, c.normalized_number
)
INSERT INTO purchase_source_document_conflicts
  (company_id, counterparty_id, normalized_number, reason, records)
SELECT company_id, counterparty_id, normalized_number,
       'multiple_records_in_same_flow', records
  FROM details
ON CONFLICT (company_id, counterparty_id, normalized_number, reason)
  WHERE resolved_at IS NULL
DO UPDATE SET records = EXCLUDED.records;

WITH eligible AS (
  SELECT c.*
    FROM purchase_source_backfill_candidates c
   WHERE NOT EXISTS (
     SELECT 1
       FROM purchase_source_document_conflicts x
      WHERE x.company_id = c.company_id
        AND x.counterparty_id = c.counterparty_id
        AND x.normalized_number = c.normalized_number
        AND x.resolved_at IS NULL
   )
), grouped AS (
  SELECT company_id, counterparty_id, normalized_number,
         (array_agg(display_number ORDER BY
           CASE kind WHEN 'invoice' THEN 0 WHEN 'delivery_note' THEN 1 ELSE 2 END,
           source_table, source_pk))[1] AS display_number,
         min(document_date) AS document_date,
         (array_agg(currency ORDER BY source_table, source_pk))[1] AS currency,
         (array_agg(kind ORDER BY
           CASE kind WHEN 'invoice' THEN 0 WHEN 'delivery_note' THEN 1 ELSE 2 END,
           source_table, source_pk))[1] AS kind
    FROM eligible
   GROUP BY company_id, counterparty_id, normalized_number
)
INSERT INTO purchase_source_documents
  (company_id, counterparty_id, kind, normalized_number, display_number,
   document_date, currency)
SELECT company_id, counterparty_id, kind, normalized_number, display_number,
       document_date, currency
  FROM grouped
ON CONFLICT DO NOTHING;

UPDATE invoices i
   SET source_document_id = psd.id
  FROM purchase_source_backfill_candidates c
  JOIN purchase_source_documents psd
    ON psd.company_id = c.company_id
   AND psd.counterparty_id = c.counterparty_id
   AND psd.normalized_number = c.normalized_number
 WHERE c.source_table = 'invoices'
   AND c.source_pk = i.id::text
   AND i.source_document_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM purchase_source_document_conflicts x
      WHERE x.company_id = c.company_id
        AND x.counterparty_id = c.counterparty_id
        AND x.normalized_number = c.normalized_number
        AND x.resolved_at IS NULL
   );

UPDATE goods_receipts gr
   SET source_document_id = psd.id
  FROM purchase_source_backfill_candidates c
  JOIN purchase_source_documents psd
    ON psd.company_id = c.company_id
   AND psd.counterparty_id = c.counterparty_id
   AND psd.normalized_number = c.normalized_number
 WHERE c.source_table = 'goods_receipts'
   AND c.source_pk = gr.id::text
   AND gr.source_document_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM purchase_source_document_conflicts x
      WHERE x.company_id = c.company_id
        AND x.counterparty_id = c.counterparty_id
        AND x.normalized_number = c.normalized_number
        AND x.resolved_at IS NULL
   );

UPDATE prejemnice p
   SET source_document_id = psd.id
  FROM purchase_source_backfill_candidates c
  JOIN purchase_source_documents psd
    ON psd.company_id = c.company_id
   AND psd.counterparty_id = c.counterparty_id
   AND psd.normalized_number = c.normalized_number
 WHERE c.source_table = 'prejemnice'
   AND c.source_pk = p.id::text
   AND p.source_document_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM purchase_source_document_conflicts x
      WHERE x.company_id = c.company_id
        AND x.counterparty_id = c.counterparty_id
        AND x.normalized_number = c.normalized_number
        AND x.resolved_at IS NULL
   );

UPDATE documents d
   SET source_document_id = i.source_document_id
  FROM invoices i
 WHERE d.linked_invoice_id = i.id
   AND d.source_document_id IS NULL
   AND i.source_document_id IS NOT NULL;

DROP TABLE purchase_source_backfill_candidates;