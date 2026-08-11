@AGENTS.md

# PKM Capture Layer — Standing Orders

## What this app is
A personal article triage tool. It ingests TLDR/TLDR AI newsletters (via Gmail), Twitter likes/bookmarks, and manually pasted URLs. The user triages each article (keep/purge), flags reading depth (surface/deep dive), adds notes, and organizes into topics. Everything persists to Supabase.

## Environment
- Dev server runs on **port 3001** (3000 is occupied by another project)
- Start it via the `capture-layer-dev` launch config, not `npm run dev` directly
- Auth requires a real browser — OAuth flows cannot be tested headlessly

## Supabase
- Project ref: `rcxppzrbdvhhkczphudg`
- **Never use `supabase db push`** — we don't have the DB password
- Run all SQL via the Management API (PAT is in `.env.local` as `SUPABASE_PAT`):
  ```bash
  curl -s -X POST "https://api.supabase.com/v1/projects/rcxppzrbdvhhkczphudg/database/query" \
    -H "Authorization: Bearer $SUPABASE_PAT" \
    -H "Content-Type: application/json" \
    -d '{"query": "<SQL here>"}'
  ```
- Returns `[]` for DDL (success), JSON rows for SELECT
- The Supabase MCP is also configured and can be used for queries

## Key architectural decisions
- **Gmail OAuth**: Custom direct Google OAuth at `/api/auth/gmail` — NOT Supabase's built-in provider. Supabase doesn't forward `gmail.readonly` scope to `provider_token`, so we implement our own flow.
- **Twitter OAuth**: OAuth 2.0 PKCE, manual implementation. Requires ngrok (or a deployed URL) for the callback — Twitter rejects `http://localhost` callbacks for web apps.
- **TLDR classification**: Done via `utm_source` in the email HTML body (`tldrai` → `tldr_ai`, `tldrnewsletter` → `tldr`), not the subject line — TLDR changed their subject format in 2026.
- **TLDR tracking URLs**: All links are wrapped in `tracking.tldrnewsletter.com/CL0/<encoded-url>/` — must be decoded before filtering or storing.
- **Middleware**: Uses `proxy.ts` with `export function proxy()` — `middleware.ts` is deprecated in this Next.js version.

## After any parser change
Always: clear TLDR articles from the DB, then trigger a fresh sync to verify with real data.
```sql
DELETE FROM articles WHERE source IN ('tldr', 'tldr_ai');
```

## Article sort order
`newsletter_date DESC, source ASC (tldr before tldr_ai), order_index ASC, created_at DESC`

## Known issues (as of 2026-08-09)
1. **Sponsored content leaking through** — TLDR marks inline sponsors with `(SPONSOR)` or `(SPONSORED)` in the headline or as a separate short `<a>` tag immediately after the article link. Fix is in place (`SPONSOR_LABEL` check in `parseTLDR.ts`) but needs a clean re-sync to verify.
2. **Section ordering** — Sections should appear in newsletter order: Big Tech & Startups → Science & Futuristic Technology → Programming, Design & Data Science → Miscellaneous → Quick Links (for TLDR); Headlines & Launches → Research & Innovation → Engineering & Resources → Miscellaneous → Quick Links (for TLDR AI). Current hypothesis: the parser may be missing articles (causing a section to disappear entirely) or failing to detect section headers with emoji prefixes.
3. **Twitter integration** — OAuth flow is coded but credentials (`TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`) are empty in `.env.local`. Also requires ngrok or a deployed URL for the callback.

## Agentic workflow instructions
- Drive autonomously toward the stated goal. Surface only blockers that require the user (OAuth clicks, external portal configuration, credential input).
- After fixing the parser: query the DB to verify article counts and section labels before reporting success.
- After any OAuth change: the user must test the connect flow in their real browser — you cannot do this headlessly.
- Prefer the debug endpoint (`/api/sync/gmail/debug`) for inspecting parser output without a full re-sync.
- Use the `?raw=1` param on the debug endpoint to inspect raw email HTML when diagnosing section detection issues.
