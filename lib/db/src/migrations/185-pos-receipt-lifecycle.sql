-- test-bootstrap: schema
DO $$
BEGIN
  CREATE TYPE prejemnica_status AS ENUM ('draft', 'confirmed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'prejemnice'
       AND column_name = 'status'
  ) THEN
    ALTER TABLE prejemnice
      ADD COLUMN status prejemnica_status NOT NULL DEFAULT 'draft';
    -- Every row predating this lifecycle is legacy history, including empty receipts.
    UPDATE prejemnice SET status = 'confirmed';
  END IF;
END
$$;