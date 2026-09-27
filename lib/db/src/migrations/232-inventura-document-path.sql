-- test-bootstrap: schema
ALTER TABLE inventure
  ADD COLUMN IF NOT EXISTS document_path text;