-- 052-os-amortizacija-nastavitve-unique.sql
--
-- Preimenuje UNIQUE constraint na os_amortizacija_nastavitve.company_id
-- iz PostgreSQL-privzetega imena (_key) v Drizzle-pričakovano ime (_unique).
-- Brez podatkovnih sprememb — samo preimenovanje constraint-a.
--
-- Vzrok: drizzle-kit push je zaznal drift ker Drizzle shema pričakuje
-- ime "os_amortizacija_nastavitve_company_id_unique", v DB pa je bil
-- constraint ustvarjen s privzetim imenom "os_amortizacija_nastavitve_company_id_key".

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'os_amortizacija_nastavitve_company_id_key'
      AND conrelid = 'os_amortizacija_nastavitve'::regclass
  ) THEN
    ALTER TABLE os_amortizacija_nastavitve
      RENAME CONSTRAINT os_amortizacija_nastavitve_company_id_key
      TO os_amortizacija_nastavitve_company_id_unique;
  END IF;
END $$;
