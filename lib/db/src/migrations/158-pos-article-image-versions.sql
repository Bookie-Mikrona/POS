BEGIN;

CREATE TABLE IF NOT EXISTS article_image_versions (
  id serial PRIMARY KEY,
  artikel_id integer NOT NULL REFERENCES artikli(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  slika_url text NOT NULL,
  alt_text text,
  prompt text,
  source text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_article_image_versions_artikel
  ON article_image_versions (artikel_id, created_at);
CREATE INDEX IF NOT EXISTS ix_article_image_versions_current
  ON article_image_versions (artikel_id, is_current);

-- Preserve images that existed before versioning was introduced.
INSERT INTO article_image_versions (artikel_id, storage_key, slika_url, alt_text, prompt, source, is_current)
SELECT id,
       regexp_replace(slika_url, '^/api/storage/public-objects/', ''),
       slika_url, NULL, opis_slike, 'legacy', true
FROM artikli
WHERE slika_url IS NOT NULL
  AND slika_url LIKE '/api/storage/public-objects/%'
  AND NOT EXISTS (
    SELECT 1 FROM article_image_versions v
    WHERE v.artikel_id = artikli.id AND v.is_current
  );

COMMIT;