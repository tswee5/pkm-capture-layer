-- Bookmarked tweets back in the feed + a per-item "read" toggle.
-- Applied via the Supabase MCP (apply_migration), 2026-11-21.

-- Read state: null = unread, timestamp = when it was marked read. A
-- timestamp rather than a boolean so the AI librarian can later reason
-- about "read but never tagged/noted" etc.
alter table articles add column if not exists read_at timestamptz;

-- One row per (user, tweet, like|bookmark). Twitter sync now runs on every
-- dashboard load and before every manual capture, so two syncs can race;
-- this makes the loser's insert a no-op (23505) instead of a duplicate.
create unique index if not exists articles_twitter_tweet_uniq_idx
  on articles (user_id, tweet_type, tweet_id)
  where source = 'twitter' and tweet_id is not null;

-- The unified feed query: manual OR twitter bookmark, by last_captured_at.
create index if not exists articles_feed_sort_idx
  on articles (user_id, last_captured_at desc);
