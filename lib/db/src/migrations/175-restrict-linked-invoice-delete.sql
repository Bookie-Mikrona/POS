-- test-bootstrap: integrity

DO $$
DECLARE
  existing_constraint text;
BEGIN
  IF to_regclass('public.documents') IS NULL
     OR to_regclass('public.invoices') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.conname
    INTO existing_constraint
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = c.confrelid
   WHERE c.contype = 'f'
     AND child_ns.nspname = 'public'
     AND child.relname = 'documents'
     AND parent.relname = 'invoices'
     AND c.conkey = ARRAY[
       (SELECT a.attnum
          FROM pg_attribute a
         WHERE a.attrelid = child.oid
           AND a.attname = 'linked_invoice_id')
     ]::smallint[]
   LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.documents DROP CONSTRAINT %I',
      existing_constraint
    );
  END IF;

  ALTER TABLE public.documents
    ADD CONSTRAINT documents_linked_invoice_id_invoices_id_fk
    FOREIGN KEY (linked_invoice_id)
    REFERENCES public.invoices(id)
    ON DELETE RESTRICT;
END
$$;