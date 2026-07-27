-- ============================================================================
-- Migration 001: vat_code + vat_ledger tabeli za KIR/KPR modul
-- Spec: ERP 3. del (DDV_KIR_KPR_1.xsd v1.3), razdelek D
-- ============================================================================

-- ── 1. Globalni FURS šifrant DDV kod ─────────────────────────────────────────
--
-- PK je UUID (surrogate). Naravni ključ je (code, valid_from) — UNIQUE constraint
-- dovoljuje zgodovinske verzije iste kode (sprememba stopnje ali mapiranja).
-- Nikoli ne posodabljaj obstoječih vrstic — dodaj novo z novim valid_from.
CREATE TABLE IF NOT EXISTS vat_code (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code             VARCHAR(16)  NOT NULL,
    description      TEXT         NOT NULL,
    direction        VARCHAR(3)   NOT NULL CHECK (direction IN ('IN', 'OUT')),
    rate             NUMERIC(5,2) NOT NULL,
    valid_from       DATE         NOT NULL,
    valid_to         DATE,
    -- KIR/KPR field mappings
    kir_base_field   VARCHAR(4),
    kpr_base_field   VARCHAR(4),
    kir_vat_field    VARCHAR(4),
    kpr_vat_field    VARCHAR(4),
    -- Dodatni obrazci
    triggers_rp_o    BOOLEAN      NOT NULL DEFAULT FALSE,
    rp_o_column      VARCHAR(2),
    triggers_pd_o    BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Zastavici
    is_reverse_charge BOOLEAN     NOT NULL DEFAULT FALSE,
    is_import        BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Naravni ključ — prepreči podvojene verzije
    CONSTRAINT uq_vat_code_version UNIQUE (code, valid_from)
);

-- ── 2. vat_ledger — centralna transakcijska DDV tabela ───────────────────────
--
-- Vsaka vrstica = en DDV vpis. Samoobdavčitve generirajo par (OUT+IN)
-- povezan z pair_id. Nespremenljive po oddaji (reported_at IS NOT NULL).
CREATE TABLE IF NOT EXISTS vat_ledger (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Three-way link (vse nullable — vpis je možen pred potrditvijo temeljnice)
    journal_entry_id     UUID          REFERENCES journal_entries(id) ON DELETE RESTRICT,
    invoice_id           UUID          REFERENCES invoices(id) ON DELETE RESTRICT,
    document_id          UUID          REFERENCES documents(id) ON DELETE RESTRICT,

    -- Partner (snapshot ob knjiženju)
    partner_id           UUID          REFERENCES counterparties(id) ON DELETE RESTRICT,
    partner_country_code CHAR(2),
    partner_vat_id       VARCHAR(32),
    partner_name         VARCHAR(250),

    -- Klasifikacija
    vat_code_id          UUID          NOT NULL REFERENCES vat_code(id),
    direction            VARCHAR(3)    NOT NULL CHECK (direction IN ('IN', 'OUT')),
    -- Self-ref za par pri samoobdavčitvah (OUT↔IN)
    pair_id              UUID          REFERENCES vat_ledger(id),
    asset_type           VARCHAR(16)   NOT NULL DEFAULT 'NONE'
                         CHECK (asset_type IN ('NONE', 'REALESTATE', 'OTHER_FA')),

    -- Datumi
    invoice_date         DATE          NOT NULL,   -- KIR P4 / KPR P5
    service_date         DATE          NOT NULL,   -- za tax_point
    receipt_date         DATE,                     -- KPR P4 (samo IN)
    posting_date         DATE          NOT NULL,   -- KIR/KPR P2
    tax_point_date       DATE          NOT NULL,   -- izračunan po ZDDV-1
    vat_period           CHAR(4)       NOT NULL,   -- 'MMMM': 0701=jan, 0709=Q3
    vat_period_year      SMALLINT      NOT NULL,

    -- Zneski (EUR, negativno = dobropis)
    base_amount          NUMERIC(15,2) NOT NULL,
    vat_amount           NUMERIC(15,2) NOT NULL DEFAULT 0,
    non_deductible_vat   NUMERIC(15,2) NOT NULL DEFAULT 0,  -- KPR P17
    deduction_percent    NUMERIC(5,2)  NOT NULL DEFAULT 100.00
                         CHECK (deduction_percent >= 0 AND deduction_percent <= 100),

    -- Reference
    document_no          VARCHAR(50)   NOT NULL,  -- KIR/KPR P3
    mrn                  VARCHAR(50),              -- uvoz
    remarks              VARCHAR(250),             -- KIR P28 / KPR P22

    -- Samoprijava (OBRAVNAVA)
    treatment            SMALLINT      NOT NULL DEFAULT 1 CHECK (treatment IN (1,2,3)),
    correction_period    CHAR(8),                  -- MMMMLLLL
    correction_amount    NUMERIC(15,2),

    -- Revizijska sled + nespremenljivost
    reported_at          TIMESTAMPTZ,             -- SET → trigger zaklene vrstico
    reported_period      CHAR(6),                 -- YYYYMM
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by           TEXT          NOT NULL,  -- Clerk user ID
    -- Self-ref na storno vrstico
    reversed_by_id       UUID          REFERENCES vat_ledger(id)
);

-- ── 3. Indeksi ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_vat_ledger_period
    ON vat_ledger (vat_period_year, vat_period);
CREATE INDEX IF NOT EXISTS ix_vat_ledger_invoice
    ON vat_ledger (invoice_id);
CREATE INDEX IF NOT EXISTS ix_vat_ledger_document
    ON vat_ledger (document_id);
CREATE INDEX IF NOT EXISTS ix_vat_ledger_partner
    ON vat_ledger (partner_id);
CREATE INDEX IF NOT EXISTS ix_vat_ledger_vat_code
    ON vat_ledger (vat_code_id);
CREATE INDEX IF NOT EXISTS ix_vat_ledger_reported
    ON vat_ledger (reported_period)
    WHERE reported_at IS NOT NULL;

-- ── 4. Immutability trigger ───────────────────────────────────────────────────
--
-- Prepreči UPDATE in DELETE na vrsticah ki so že bile oddane FURS-u.
-- Pogoj: reported_at IS NOT NULL

CREATE OR REPLACE FUNCTION vat_ledger_immutability_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.reported_at IS NOT NULL THEN
        RAISE EXCEPTION
            'vat_ledger: Vrstice oddane evidence ni dovoljeno spremeniti. '
            'id=%, reported_period=%', OLD.id, OLD.reported_period;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION vat_ledger_immutability_check_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.reported_at IS NOT NULL THEN
        RAISE EXCEPTION
            'vat_ledger: Vrstice oddane evidence ni dovoljeno izbrisati. '
            'id=%, reported_period=%', OLD.id, OLD.reported_period;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_vat_ledger_no_update_after_report ON vat_ledger;
CREATE TRIGGER trg_vat_ledger_no_update_after_report
    BEFORE UPDATE ON vat_ledger
    FOR EACH ROW EXECUTE FUNCTION vat_ledger_immutability_check();

DROP TRIGGER IF EXISTS trg_vat_ledger_no_delete_after_report ON vat_ledger;
CREATE TRIGGER trg_vat_ledger_no_delete_after_report
    BEFORE DELETE ON vat_ledger
    FOR EACH ROW EXECUTE FUNCTION vat_ledger_immutability_check_delete();
