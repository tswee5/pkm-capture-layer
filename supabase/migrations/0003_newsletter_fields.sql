ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS newsletter_date date,
  ADD COLUMN IF NOT EXISTS order_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS section_label text,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

CREATE INDEX IF NOT EXISTS articles_date_order_idx
  ON articles (user_id, newsletter_date DESC NULLS LAST, order_index ASC);
