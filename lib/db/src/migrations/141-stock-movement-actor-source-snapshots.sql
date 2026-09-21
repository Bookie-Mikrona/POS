BEGIN;

DROP TRIGGER IF EXISTS zaloga_gibi_history_append_only ON zaloga_gibi;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'zaloga_gibi'::regclass
      AND tgname = 'zaloga_gibi_event_transfer_guard'
      AND NOT tgisinternal
  ) THEN
    ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_event_transfer_guard;
  END IF;
END;
$$;

ALTER TABLE zaloga_gibi
  ADD COLUMN IF NOT EXISTS actor_snapshot text,
  ADD COLUMN IF NOT EXISTS source_snapshot text,
  ADD COLUMN IF NOT EXISTS reversal_of_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'zaloga_gibi'
      AND column_name = 'effective_at_snapshot'
  ) THEN
    ALTER TABLE zaloga_gibi
      ADD COLUMN effective_at_snapshot timestamp DEFAULT now();

    UPDATE zaloga_gibi zg
    SET effective_at_snapshot = COALESCE(
      CASE WHEN zg.tip = 'prejemnica' THEN (
        SELECT p.datum FROM prejemnice p WHERE p.id = zg.referenca_id
      ) END,
      CASE WHEN zg.opomba LIKE 'Začetne zaloge%' THEN (
        SELECT zz.datum FROM zacetne_zaloge zz WHERE zz.id = zg.referenca_id
      ) END,
      CASE WHEN zg.tip = 'inventura'
        AND (zg.opomba IS NULL OR zg.opomba NOT LIKE 'Začetne zaloge%') THEN (
        SELECT i.datum FROM inventure i WHERE i.id = zg.referenca_id
      ) END,
      CASE WHEN zg.tip = 'izdajnica' THEN (
        SELECT i.datum FROM izdajnice i WHERE i.id = zg.referenca_id
      ) END,
      zg.ustvarjeno
    )
    ;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'zaloga_gibi'::regclass
      AND tgname = 'zaloga_gibi_event_transfer_guard'
      AND NOT tgisinternal
  ) THEN
    ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_event_transfer_guard;
  END IF;
END;
$$;

COMMENT ON COLUMN zaloga_gibi.actor_snapshot IS
  'Neposredni uporabnik ali sistemski akter ob nastanku; NULL pomeni, da legacy ali sistemski tok akterja ni dokazljivo zabeležil.';
COMMENT ON COLUMN zaloga_gibi.source_snapshot IS
  'Nespremenljiv tip poslovnega procesa ali dokumenta, ki je ustvaril premik.';
COMMENT ON COLUMN zaloga_gibi.reversal_of_id IS
  'Izvorna nespremenljiva vrstica, ki jo ta izravnalni gib stornira.';
COMMENT ON COLUMN zaloga_gibi.effective_at_snapshot IS
  'Nespremenljiv poslovni datum, po katerem se premik vključi v WAC.';

-- Legacy vrednosti zamrznemo, dokler izvorni dokumenti še obstajajo. Poznejši
-- edit/delete zato ne more spremeniti cene ali kronologije starega premika.
UPDATE zaloga_gibi zg
SET cena_kos = COALESCE(
      zg.cena_kos,
      CASE WHEN zg.tip = 'prejemnica' THEN (
        SELECT pp.cena_kos
        FROM prejemnice_postavke pp
        WHERE pp.prejemnica_id = zg.referenca_id
          AND pp.artikel_id = zg.artikel_id
        ORDER BY pp.id
        LIMIT 1
      ) END,
      CASE WHEN zg.opomba LIKE 'Začetne zaloge%' THEN (
        SELECT zzp.cena_kos
        FROM zacetne_zaloge_postavke zzp
        WHERE zzp.zacetna_zaloga_id = zg.referenca_id
          AND zzp.artikel_id = zg.artikel_id
        ORDER BY zzp.id
        LIMIT 1
      ) END
    )
WHERE zg.cena_kos IS NULL
  AND zg.tip NOT IN (
    'event_transfer_out', 'event_transfer_in',
    'event_return_out', 'event_return_in'
  );

UPDATE zaloga_gibi
SET vrednost = kolicina * cena_kos
WHERE vrednost IS NULL
  AND cena_kos IS NOT NULL;

ALTER TABLE zaloga_gibi
  ALTER COLUMN effective_at_snapshot SET DEFAULT now(),
  ALTER COLUMN effective_at_snapshot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'zaloga_gibi_reversal_of_id_fkey'
      AND conrelid = 'zaloga_gibi'::regclass
  ) THEN
    ALTER TABLE zaloga_gibi
      ADD CONSTRAINT zaloga_gibi_reversal_of_id_fkey
      FOREIGN KEY (reversal_of_id) REFERENCES zaloga_gibi(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS zaloga_gibi_reversal_of_id_unique
  ON zaloga_gibi (reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_zaloga_gibi_insert_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_snapshot IS NULL THEN
    RAISE EXCEPTION 'Nov zalogovni premik mora imeti source_snapshot'
      USING ERRCODE = '23514',
            CONSTRAINT = 'zaloga_gibi_insert_snapshot_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zaloga_gibi_insert_snapshot_required ON zaloga_gibi;
CREATE TRIGGER zaloga_gibi_insert_snapshot_required
BEFORE INSERT ON zaloga_gibi
FOR EACH ROW
EXECUTE FUNCTION enforce_zaloga_gibi_insert_snapshot();

CREATE OR REPLACE FUNCTION protect_zaloga_gibi_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_stock_movement_cleanup', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Zgodovina zalogovnih premikov je append-only'
    USING ERRCODE = '23514',
          CONSTRAINT = 'zaloga_gibi_history_append_only';
END;
$$;

DROP TRIGGER IF EXISTS zaloga_gibi_snapshots_immutable ON zaloga_gibi;
DROP TRIGGER IF EXISTS zaloga_gibi_history_append_only ON zaloga_gibi;
CREATE TRIGGER zaloga_gibi_history_append_only
BEFORE UPDATE OR DELETE ON zaloga_gibi
FOR EACH ROW
EXECUTE FUNCTION protect_zaloga_gibi_history();

COMMIT;