-- Naloga #139/#141: D4-2 napaka preprečena
-- Dodamo stolpec receipt_date v journal_entries.
--
-- receipt_date = datum fizičnega prejema računa (§ 67. člen ZDDV-1).
-- To je ločeno od document_date (datum na računu) in entry_date (datum knjiženja).
-- Vrednost se shrani ob vnosu temeljnice; pri DDV evidenci
-- vatLedger.ts ga prebere z: entry.receiptDate ?? entry.documentDate ?? entry.entryDate.
--
-- Stolpec je NULL za obstoječe vrstice — privzeto se DDV poroča po documentDate
-- tako kot doslej, kar je kompatibilna sprememba.

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS receipt_date date;

COMMENT ON COLUMN journal_entries.receipt_date IS
  'Datum fizičnega prejema računa (§ 67. člen ZDDV-1). '
  'Obvezno pri vhodnih DDV vpisih (KPR) za D4-2 polje. '
  'NULL = ni nastavljeno; vatLedger.ts pade nazaj na document_date.';
