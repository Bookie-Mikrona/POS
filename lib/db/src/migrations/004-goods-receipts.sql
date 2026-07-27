-- §2026-07: ERP Prejemnica brez računa
-- Prehodni konto 221 (Neobračunano blago): DR Zaloga / CR 221 ob prejemu,
-- DR 221 / CR 220 ob ujemanju z računom.

CREATE TABLE IF NOT EXISTS goods_receipts (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    counterparty_id     UUID         NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
    period_id           UUID         NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
    receipt_date        DATE         NOT NULL,
    delivery_note_no    TEXT         NOT NULL,
    description         TEXT,
    status              TEXT         NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'matched', 'voided')),
    transit_account_id  UUID         NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    inventory_account_id UUID        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    total_amount        NUMERIC(15,2) NOT NULL,
    linked_entry_id     UUID         REFERENCES journal_entries(id) ON DELETE SET NULL,
    matched_invoice_id  UUID         REFERENCES invoices(id) ON DELETE RESTRICT,
    match_entry_id      UUID         REFERENCES journal_entries(id) ON DELETE SET NULL,
    notes               TEXT,
    created_by          TEXT         NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_receipt_id    UUID         NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    description         TEXT         NOT NULL,
    account_id          UUID         REFERENCES accounts(id) ON DELETE RESTRICT,
    quantity            NUMERIC(12,4) NOT NULL DEFAULT 1,
    unit_price          NUMERIC(15,4) NOT NULL,
    amount              NUMERIC(15,2) NOT NULL,
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS ix_goods_receipts_company
    ON goods_receipts (company_id);
CREATE INDEX IF NOT EXISTS ix_goods_receipts_company_status
    ON goods_receipts (company_id, status);
CREATE INDEX IF NOT EXISTS ix_goods_receipts_counterparty
    ON goods_receipts (counterparty_id);
CREATE INDEX IF NOT EXISTS ix_goods_receipt_lines_receipt
    ON goods_receipt_lines (goods_receipt_id);
