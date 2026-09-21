-- 000-pre-init.sql
-- Razširitve in funkcije, ki jih Drizzle shema referira v generiranih stolpcih.
-- Mora biti aplicirano PRED drizzle-kit push.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Wrapper za unaccent (potreben za generiran stolpec artikel_dobavitelj.naziv_norm)
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$;

-- Normalizator naziva za iskanje po podobnosti
CREATE OR REPLACE FUNCTION public.naziv_norm(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(lower(public.unaccent('public.unaccent', coalesce(p,''))),
                            '(\d),(\d)', '\1.\2', 'g'),
             '[^a-z0-9. ]+', ' ', 'g'),
           '\s+', ' ', 'g')
$$;

-- GTIN pomožni funkciji (referencirani v Drizzle shemi)
CREATE OR REPLACE FUNCTION public.gtin_veljaven(p_gtin TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v TEXT; s INT := 0; i INT;
BEGIN
    IF p_gtin IS NULL OR p_gtin !~ '^\d+$'
       OR length(p_gtin) NOT IN (8,12,13,14) THEN RETURN FALSE; END IF;
    v := lpad(p_gtin, 14, '0');
    FOR i IN 1..13 LOOP
        s := s + substr(v,i,1)::INT * CASE WHEN (14-i) % 2 = 0 THEN 1 ELSE 3 END;
    END LOOP;
    RETURN ((10 - (s % 10)) % 10) = substr(v,14,1)::INT;
END $$;

CREATE OR REPLACE FUNCTION public.gtin_norm(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p ~ '^\d{8,14}$' THEN lpad(p, 14, '0') END $$;

-- neto po kaskadnih rabatih
CREATE OR REPLACE FUNCTION public.neto_po_rabatih(
    p_bruto NUMERIC, p_r1 NUMERIC, p_r2 NUMERIC
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT p_bruto * (1 - COALESCE(p_r1,0)/100) * (1 - COALESCE(p_r2,0)/100)
$$;
