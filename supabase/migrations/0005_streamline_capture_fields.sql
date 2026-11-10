-- Streamlined capture: link-unfurl metadata + full-text search for manually
-- saved items. Applied via Supabase Management API per CLAUDE.md (no DB
-- password available) — this file documents what ran.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS og_image_url text,
  ADD COLUMN IF NOT EXISTS og_description text,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS extracted_text text;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(headline, '') || ' ' ||
      coalesce(personal_notes, '') || ' ' ||
      coalesce(og_description, '') || ' ' ||
      coalesce(extracted_text, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS articles_search_idx ON articles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS articles_source_created_idx ON articles (user_id, source, created_at DESC);
