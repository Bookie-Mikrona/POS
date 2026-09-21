-- Dogodkovni meni, osebje in zaloga: podjetje ter izvorna/ciljna enota
-- postanejo del sestavljene DB-identitete vseh podrejenih zapisov.

ALTER TABLE pos_event_menu_items
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS source_unit_id integer;
ALTER TABLE pos_event_staff_grants
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE pos_stock_transfer_lines
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS source_unit_id integer,
  ADD COLUMN IF NOT EXISTS target_unit_id integer;

UPDATE pos_event_menu_items menu
SET company_id = event.company_id,
    source_unit_id = event.enota_id
FROM pos_events event
WHERE event.id = menu.event_id
  AND (
    menu.company_id IS DISTINCT FROM event.company_id
    OR menu.source_unit_id IS DISTINCT FROM event.enota_id
  );

UPDATE pos_event_staff_grants grant_row
SET company_id = event.company_id
FROM pos_events event
WHERE event.id = grant_row.event_id
  AND grant_row.company_id IS DISTINCT FROM event.company_id;

UPDATE pos_stock_transfer_lines line
SET company_id = transfer.company_id,
    source_unit_id = transfer.source_unit_id,
    target_unit_id = transfer.target_unit_id
FROM pos_stock_transfers transfer
WHERE transfer.id = line.transfer_id
  AND (
    line.company_id IS DISTINCT FROM transfer.company_id
    OR line.source_unit_id IS DISTINCT FROM transfer.source_unit_id
    OR line.target_unit_id IS DISTINCT FROM transfer.target_unit_id
  );

-- Vsako vrsto starega neskladja preštejemo posebej. Celotna migracija odpove,
-- zato noben poslovni zapis ni tiho izbrisan ali prevezan.
DO $$
DECLARE
  invalid_menu integer;
  invalid_staff integer;
  invalid_transfers integer;
  invalid_lines integer;
BEGIN
  SELECT count(*) INTO invalid_menu
  FROM pos_event_menu_items menu
  JOIN pos_events event ON event.id = menu.event_id
  JOIN enote target_unit ON target_unit.id = menu.target_unit_id
  JOIN artikli source_article ON source_article.id = menu.source_article_id
  JOIN artikli target_article ON target_article.id = menu.target_article_id
  WHERE menu.company_id IS DISTINCT FROM event.company_id
     OR menu.source_unit_id IS DISTINCT FROM event.enota_id
     OR target_unit.company_id IS DISTINCT FROM menu.company_id
     OR source_article.enota_id IS DISTINCT FROM menu.source_unit_id
     OR target_article.enota_id IS DISTINCT FROM menu.target_unit_id;

  SELECT count(*) INTO invalid_staff
  FROM pos_event_staff_grants grant_row
  JOIN pos_events event ON event.id = grant_row.event_id
  JOIN pos_uporabniki pos_user ON pos_user.id = grant_row.pos_user_id
  JOIN enote unit_row ON unit_row.id = grant_row.unit_id
  WHERE grant_row.company_id IS DISTINCT FROM event.company_id
     OR pos_user.company_id IS DISTINCT FROM grant_row.company_id
     OR unit_row.company_id IS DISTINCT FROM grant_row.company_id;

  SELECT count(*) INTO invalid_transfers
  FROM pos_stock_transfers transfer
  JOIN pos_events event ON event.id = transfer.event_id
  JOIN enote source_unit ON source_unit.id = transfer.source_unit_id
  JOIN enote target_unit ON target_unit.id = transfer.target_unit_id
  LEFT JOIN pos_stock_transfers original ON original.id = transfer.return_of_id
  WHERE event.company_id IS DISTINCT FROM transfer.company_id
     OR source_unit.company_id IS DISTINCT FROM transfer.company_id
     OR target_unit.company_id IS DISTINCT FROM transfer.company_id
     OR (
       transfer.return_of_id IS NOT NULL
       AND original.company_id IS DISTINCT FROM transfer.company_id
     );

  SELECT count(*) INTO invalid_lines
  FROM pos_stock_transfer_lines line
  JOIN pos_stock_transfers transfer ON transfer.id = line.transfer_id
  JOIN artikli source_article ON source_article.id = line.source_article_id
  JOIN artikli target_article ON target_article.id = line.target_article_id
  WHERE line.company_id IS DISTINCT FROM transfer.company_id
     OR line.source_unit_id IS DISTINCT FROM transfer.source_unit_id
     OR line.target_unit_id IS DISTINCT FROM transfer.target_unit_id
     OR source_article.enota_id IS DISTINCT FROM line.source_unit_id
     OR target_article.enota_id IS DISTINCT FROM line.target_unit_id;

  IF invalid_menu + invalid_staff + invalid_transfers + invalid_lines > 0 THEN
    RAISE EXCEPTION
      'Dogodkovni podatki niso usklajeni med podjetji (meni %, osebje %, prenosi %, vrstice %). Potrebna je ročna uskladitev.',
      invalid_menu, invalid_staff, invalid_transfers, invalid_lines;
  END IF;
END $$;

ALTER TABLE pos_event_menu_items
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN source_unit_id SET NOT NULL;
ALTER TABLE pos_event_staff_grants
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE pos_stock_transfer_lines
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN source_unit_id SET NOT NULL,
  ALTER COLUMN target_unit_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artikli_id_enota_unique') THEN
    ALTER TABLE artikli
      ADD CONSTRAINT artikli_id_enota_unique UNIQUE (id, enota_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_uporabniki_id_company_unique') THEN
    ALTER TABLE pos_uporabniki
      ADD CONSTRAINT pos_uporabniki_id_company_unique UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_events_id_company_unit_unique') THEN
    ALTER TABLE pos_events
      ADD CONSTRAINT pos_events_id_company_unit_unique UNIQUE (id, company_id, enota_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfers_id_scope_unique') THEN
    ALTER TABLE pos_stock_transfers
      ADD CONSTRAINT pos_stock_transfers_id_scope_unique
      UNIQUE (id, company_id, source_unit_id, target_unit_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfers_id_company_unique') THEN
    ALTER TABLE pos_stock_transfers
      ADD CONSTRAINT pos_stock_transfers_id_company_unique UNIQUE (id, company_id);
  END IF;
END $$;

DO $$
DECLARE
  index_name text;
BEGIN
  FOREACH index_name IN ARRAY ARRAY[
    'ux_pos_event_menu_source',
    'ux_pos_event_menu_target',
    'ux_pos_event_staff_grant',
    'ux_pos_stock_transfer_event_units_direction',
    'ux_pos_stock_transfer_line'
  ]
  LOOP
    IF to_regclass(index_name) IS NOT NULL
       AND position('(company_id,' IN pg_get_indexdef(to_regclass(index_name))) = 0 THEN
      EXECUTE format('DROP INDEX %I', index_name);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_event_menu_source
  ON pos_event_menu_items(company_id, event_id, target_unit_id, source_article_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_event_menu_target
  ON pos_event_menu_items(company_id, event_id, target_unit_id, target_article_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_event_staff_grant
  ON pos_event_staff_grants(company_id, event_id, pos_user_id, unit_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_stock_transfer_event_units_direction
  ON pos_stock_transfers(company_id, event_id, source_unit_id, target_unit_id, direction);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_stock_transfer_line
  ON pos_stock_transfer_lines(company_id, transfer_id, source_article_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_menu_event_source_unit_fk') THEN
    ALTER TABLE pos_event_menu_items ADD CONSTRAINT pos_event_menu_event_source_unit_fk
      FOREIGN KEY (event_id, company_id, source_unit_id)
      REFERENCES pos_events(id, company_id, enota_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_menu_target_unit_company_fk') THEN
    ALTER TABLE pos_event_menu_items ADD CONSTRAINT pos_event_menu_target_unit_company_fk
      FOREIGN KEY (target_unit_id, company_id)
      REFERENCES enote(id, company_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_menu_source_article_unit_fk') THEN
    ALTER TABLE pos_event_menu_items ADD CONSTRAINT pos_event_menu_source_article_unit_fk
      FOREIGN KEY (source_article_id, source_unit_id)
      REFERENCES artikli(id, enota_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_menu_target_article_unit_fk') THEN
    ALTER TABLE pos_event_menu_items ADD CONSTRAINT pos_event_menu_target_article_unit_fk
      FOREIGN KEY (target_article_id, target_unit_id)
      REFERENCES artikli(id, enota_id) ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_staff_event_company_fk') THEN
    ALTER TABLE pos_event_staff_grants ADD CONSTRAINT pos_event_staff_event_company_fk
      FOREIGN KEY (event_id, company_id)
      REFERENCES pos_events(id, company_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_staff_user_company_fk') THEN
    ALTER TABLE pos_event_staff_grants ADD CONSTRAINT pos_event_staff_user_company_fk
      FOREIGN KEY (pos_user_id, company_id)
      REFERENCES pos_uporabniki(id, company_id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_staff_unit_company_fk') THEN
    ALTER TABLE pos_event_staff_grants ADD CONSTRAINT pos_event_staff_unit_company_fk
      FOREIGN KEY (unit_id, company_id)
      REFERENCES enote(id, company_id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfers_event_company_fk') THEN
    ALTER TABLE pos_stock_transfers ADD CONSTRAINT pos_stock_transfers_event_company_fk
      FOREIGN KEY (event_id, company_id)
      REFERENCES pos_events(id, company_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfers_source_unit_company_fk') THEN
    ALTER TABLE pos_stock_transfers ADD CONSTRAINT pos_stock_transfers_source_unit_company_fk
      FOREIGN KEY (source_unit_id, company_id)
      REFERENCES enote(id, company_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfers_target_unit_company_fk') THEN
    ALTER TABLE pos_stock_transfers ADD CONSTRAINT pos_stock_transfers_target_unit_company_fk
      FOREIGN KEY (target_unit_id, company_id)
      REFERENCES enote(id, company_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfers_return_company_fk') THEN
    ALTER TABLE pos_stock_transfers ADD CONSTRAINT pos_stock_transfers_return_company_fk
      FOREIGN KEY (return_of_id, company_id)
      REFERENCES pos_stock_transfers(id, company_id) ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfer_lines_transfer_scope_fk') THEN
    ALTER TABLE pos_stock_transfer_lines ADD CONSTRAINT pos_stock_transfer_lines_transfer_scope_fk
      FOREIGN KEY (transfer_id, company_id, source_unit_id, target_unit_id)
      REFERENCES pos_stock_transfers(id, company_id, source_unit_id, target_unit_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfer_lines_source_article_unit_fk') THEN
    ALTER TABLE pos_stock_transfer_lines ADD CONSTRAINT pos_stock_transfer_lines_source_article_unit_fk
      FOREIGN KEY (source_article_id, source_unit_id)
      REFERENCES artikli(id, enota_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stock_transfer_lines_target_article_unit_fk') THEN
    ALTER TABLE pos_stock_transfer_lines ADD CONSTRAINT pos_stock_transfer_lines_target_article_unit_fk
      FOREIGN KEY (target_article_id, target_unit_id)
      REFERENCES artikli(id, enota_id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE pos_event_menu_items VALIDATE CONSTRAINT pos_event_menu_event_source_unit_fk;
ALTER TABLE pos_event_menu_items VALIDATE CONSTRAINT pos_event_menu_target_unit_company_fk;
ALTER TABLE pos_event_menu_items VALIDATE CONSTRAINT pos_event_menu_source_article_unit_fk;
ALTER TABLE pos_event_menu_items VALIDATE CONSTRAINT pos_event_menu_target_article_unit_fk;
ALTER TABLE pos_event_staff_grants VALIDATE CONSTRAINT pos_event_staff_event_company_fk;
ALTER TABLE pos_event_staff_grants VALIDATE CONSTRAINT pos_event_staff_user_company_fk;
ALTER TABLE pos_event_staff_grants VALIDATE CONSTRAINT pos_event_staff_unit_company_fk;
ALTER TABLE pos_stock_transfers VALIDATE CONSTRAINT pos_stock_transfers_event_company_fk;
ALTER TABLE pos_stock_transfers VALIDATE CONSTRAINT pos_stock_transfers_source_unit_company_fk;
ALTER TABLE pos_stock_transfers VALIDATE CONSTRAINT pos_stock_transfers_target_unit_company_fk;
ALTER TABLE pos_stock_transfers VALIDATE CONSTRAINT pos_stock_transfers_return_company_fk;
ALTER TABLE pos_stock_transfer_lines VALIDATE CONSTRAINT pos_stock_transfer_lines_transfer_scope_fk;
ALTER TABLE pos_stock_transfer_lines VALIDATE CONSTRAINT pos_stock_transfer_lines_source_article_unit_fk;
ALTER TABLE pos_stock_transfer_lines VALIDATE CONSTRAINT pos_stock_transfer_lines_target_article_unit_fk;