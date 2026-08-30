-- Persist the tweet's own ID so we can render a live embed (images, quote-tweets,
-- polls) instead of relying on our own text extraction.

ALTER TABLE articles ADD COLUMN IF NOT EXISTS tweet_id text;
