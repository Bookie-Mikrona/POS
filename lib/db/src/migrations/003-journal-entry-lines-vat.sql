-- ============================================================================
-- Migration 003: Dodaj DDV polja na journal_entry_lines za KIR/KPR knjiženje
-- Spec: ERP 3. del, naloga #133
-- ============================================================================

-- vat_code_id: FK na globalni FURS šifrant (vat_code.id)
-- Ko je nastavljeno, vrstica nosi DDV informacijo za KIR/KPR evidenco.
ALTER TABLE journal_entry_lines
    ADD COLUMN IF NOT EXISTS vat_code_id UUID REFERENCES vat_code(id);

-- vat_amount: Znesek DDV za to vrstico (0 pri oproščenih, NULL = ni DDV vrstice)
-- Osnova = amount; DDV = vat_amount; bruto = amount + vat_amount
ALTER TABLE journal_entry_lines
    ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(18,2) DEFAULT 0;

-- vat_deduction_percent: Odbitni delež DDV v % (0–100); 100 = polna pravica
-- Relevatnno samo pri direction='IN'; za direction='OUT' vedno 0 (ni odbitka)
ALTER TABLE journal_entry_lines
    ADD COLUMN IF NOT EXISTS vat_deduction_percent NUMERIC(5,2) DEFAULT 100.00;

-- Indeks za hitrejše poizvedbe pri gradnji KIR/KPR
CREATE INDEX IF NOT EXISTS ix_jel_vat_code ON journal_entry_lines (vat_code_id)
    WHERE vat_code_id IS NOT NULL;
