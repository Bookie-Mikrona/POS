-- §135: Tabela za repozitorij KIR/KPR XML oddaj za FURS
-- Shema: DDV_KIR_KPR_1.xsd (verzija 1.3, 22. 7. 2024)

CREATE TABLE IF NOT EXISTS vat_submissions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Kateri zavezanec / obdobje
    company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period_year         SMALLINT     NOT NULL,
    period              CHAR(4)      NOT NULL,           -- MMMM npr. 0707, 0709
    kind                VARCHAR(4)   NOT NULL CHECK (kind IN ('KIR', 'KPR', 'BOTH')),

    -- Životni cikel
    status              VARCHAR(10)  NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected')),

    -- Verzija sheme (za prihodnje migracije)
    schema_version      VARCHAR(30)  NOT NULL DEFAULT 'DDV_KIR_KPR_1.xsd',

    -- XML vsebina (object storage path ali inline fallback)
    xml_storage_path    TEXT,
    xml_inline          TEXT,

    -- Statistike
    kir_count           SMALLINT     NOT NULL DEFAULT 0,
    kpr_count           SMALLINT     NOT NULL DEFAULT 0,

    -- Časovne oznake
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    submitted_at        TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,

    -- Revizijska sled
    created_by          VARCHAR(128) NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_vat_submissions_company_period
    ON vat_submissions (company_id, period_year, period);
