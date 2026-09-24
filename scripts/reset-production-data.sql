-- MANUAL OPERATION ONLY. Run this ONE statement in Database > Production > SQL runner.
-- It permanently removes every row from every public application table,
-- including the two previously exempted companies. Table definitions,
-- the _system migration table, and files outside PostgreSQL are not removed.
-- The observed production baseline is 181 public tables, 1124 companies,
-- 1316 units and 1723 receipts. If anything differs, the whole operation
-- aborts without deleting rows; review the inventory instead of weakening
-- the guards. Never paste this into the Development SQL runner.
--
-- A DO statement is one PostgreSQL transaction. Any error rolls it all back.
DO $production_reset$
DECLARE
  table_count integer;
  table_list text;
  entry record;
  has_rows boolean;
BEGIN
  PERFORM set_config('lock_timeout', '15s', true);

  IF (SELECT count(*) FROM public.companies) <> 1124
     OR (SELECT count(*) FROM public.enote) <> 1316
     OR (SELECT count(*) FROM public.racuni) <> 1723 THEN
    RAISE EXCEPTION 'Production baseline differs (or wrong database selected); nothing deleted';
  END IF;

  SELECT count(*)::integer,
         string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO table_count, table_list
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT c.relispartition;

  IF table_count <> 181 THEN
    RAISE EXCEPTION 'Public table inventory changed (% tables); nothing deleted', table_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('p', 'f', 'm')
  ) OR EXISTS (
    SELECT 1 FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'Partitioned, foreign, materialized or inherited tables need manual review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint k
    JOIN pg_class child ON child.oid = k.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = k.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE k.contype = 'f'
      AND child_ns.nspname <> parent_ns.nspname
      AND (child_ns.nspname = 'public' OR parent_ns.nspname = 'public')
  ) THEN
    RAISE EXCEPTION 'Cross-schema foreign key found; nothing deleted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public' AND (t.tgtype & 32) <> 0
  ) THEN
    RAISE EXCEPTION 'Application TRUNCATE trigger found; nothing deleted';
  END IF;

  -- No CASCADE: only the explicitly inventoried 181 public tables are targeted.
  EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY';

  FOR entry IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relispartition
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I)',
                   entry.nspname, entry.relname) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'Table %.% is not empty; all changes rolled back',
        entry.nspname, entry.relname;
    END IF;
  END LOOP;
END
$production_reset$;