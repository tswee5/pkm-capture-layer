-- Quotes (highlights), the canonical-URL link dedup/merge key, and the
-- search_vector regeneration that includes quote text. Applied via the
-- Supabase MCP in stages, matching the order below:
--   1. Everything down to "search_vector regeneration".
--   2. Snapshot + backfill + duplicate consolidation (see
--      scripts/backfill-canonical-urls.ts and the commit message for the
--      merge log of ids kept / folded — there were no duplicates in this
--      project's data as of 2026-11-11, so nothing was actually folded).
--   3. The partial unique index at the bottom, once canonical_url is clean.

-- R1: quotes ---------------------------------------------------------------

create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  article_id uuid not null references articles(id) on delete cascade,
  text text not null,
  created_at timestamptz default now(),
  constraint highlights_text_not_blank check (btrim(text) <> '')
);

create index if not exists highlights_article_created_idx
  on highlights (article_id, created_at);

-- Normalized (whitespace-collapsed, trimmed) dedup: sharing the same quote
-- twice for the same article is a no-op, regardless of minor whitespace
-- differences between the two shares.
create unique index if not exists highlights_article_normalized_text_idx
  on highlights (article_id, md5(regexp_replace(btrim(text), '\s+', ' ', 'g')));

alter table highlights enable row level security;

create policy "highlights_owner_all" on highlights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- R3: canonical URL + merge-on-recapture ------------------------------------

alter table articles add column if not exists canonical_url text;

alter table articles add column if not exists last_captured_at timestamptz;
update articles set last_captured_at = created_at where last_captured_at is null;
alter table articles alter column last_captured_at set default now();
alter table articles alter column last_captured_at set not null;

-- R1 search: highlights_text -------------------------------------------------

alter table articles add column if not exists highlights_text text default '';

create or replace function sync_article_highlights_text()
returns trigger as $$
declare
  target_article_id uuid;
begin
  target_article_id := coalesce(new.article_id, old.article_id);
  update articles
  set highlights_text = coalesce((
    select string_agg(h.text, ' ' order by h.created_at)
    from highlights h
    where h.article_id = target_article_id
  ), '')
  where id = target_article_id;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists highlights_sync_article_text on highlights;
create trigger highlights_sync_article_text
  after insert or update or delete on highlights
  for each row execute function sync_article_highlights_text();

-- Regenerate search_vector to include highlights_text. Generated columns
-- can't be altered in place, so drop and recreate (existing ?q= search
-- behavior is unchanged, just with quotes now included).
drop index if exists articles_search_idx;
alter table articles drop column if exists search_vector;

alter table articles
  add column search_vector tsvector
  generated always as (
    to_tsvector('english',
      coalesce(headline, '') || ' ' ||
      coalesce(personal_notes, '') || ' ' ||
      coalesce(og_description, '') || ' ' ||
      coalesce(extracted_text, '') || ' ' ||
      coalesce(highlights_text, '')
    )
  ) stored;

create index articles_search_idx on articles using gin (search_vector);

-- Backfill (scripts/backfill-canonical-urls.ts) + duplicate consolidation
-- happens here, before the index below can be created.

create unique index if not exists articles_manual_canonical_url_idx
  on articles (user_id, canonical_url)
  where source = 'manual' and canonical_url is not null;
