-- Minimal OAuth 2.1 authorization server backing /api/mcp/oauth/*, so
-- Claude's mobile/web "remote MCP connector" flow (which requires a real
-- OAuth handshake, not just a static header) can authenticate. Scoped for a
-- single-user personal app: public clients only (PKCE, no client secret),
-- no consent-screen complexity, no multi-tenant client management.

create table public.mcp_oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table public.mcp_oauth_codes (
  code text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  resource text,
  scope text,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null,
  scope text,
  created_at timestamptz not null default now(),
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  revoked boolean not null default false
);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
-- No policies: only the service-role admin client (lib/supabase/admin.ts)
-- ever touches these tables, same as every other write path in app/api/mcp.
