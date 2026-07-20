-- Article Triage and Capture Layer: initial schema

create table articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  source text check (source in ('tldr', 'twitter', 'manual')) not null,
  link text,
  headline text not null,
  summary text,
  personal_notes text,
  chat_summary text,
  depth_flag text check (depth_flag in ('surface', 'deep')),
  status text check (status in ('pending', 'keep', 'purge')) default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_articles_user_status on articles (user_id, status, created_at desc);

create table topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  description text,
  created_at timestamptz default now(),
  unique (user_id, name)
);

create index idx_topics_user on topics (user_id);

create table article_topics (
  article_id uuid references articles(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (article_id, topic_id)
);

create table user_integrations (
  user_id uuid references auth.users not null,
  provider text check (provider in ('gmail', 'twitter')) not null,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  primary key (user_id, provider)
);

-- Row Level Security: every table is scoped to the owning user.

alter table articles enable row level security;
alter table topics enable row level security;
alter table article_topics enable row level security;
alter table user_integrations enable row level security;

create policy "articles_owner_all" on articles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "topics_owner_all" on topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "article_topics_owner_all" on article_topics
  for all using (
    exists (select 1 from articles a where a.id = article_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from articles a where a.id = article_id and a.user_id = auth.uid())
  );

create policy "user_integrations_owner_all" on user_integrations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at current on article writes.

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger articles_set_updated_at
  before update on articles
  for each row
  execute function set_updated_at();
