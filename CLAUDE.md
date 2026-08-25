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
- **Login page uses a separate OAuth flow from Gmail connect**: `app/page.tsx` ("Sign in with Google") goes through Supabase's built-in `supabase.auth.signInWithOAuth`, a different path from the custom Gmail-scope flow above. It passes a dynamic `redirectTo: ${window.location.origin}/auth/callback`, but **Supabase silently ignores `redirectTo` if the URL isn't in its own allow-list** (Supabase Dashboard → Authentication → URL Configuration → Site URL / Redirect URLs) and falls back to the configured Site URL instead. This is independent of `NEXT_PUBLIC_APP_URL` and Google Cloud Console's authorized redirect URIs — all three (Google Console, Vercel env var, Supabase URL Configuration) must list the deployed URL, or login silently redirects back to `localhost`. Diagnose via DevTools Network tab: check the `redirect_to` param on the `.../auth/v1/authorize` request, then the `Location` header Supabase returns after the Google callback.
- **Twitter OAuth**: OAuth 2.0 PKCE, manual implementation. Requires ngrok (or a deployed URL) for the callback — Twitter rejects `http://localhost` callbacks for web apps.
- **TLDR classification**: Done via `utm_source` in the email HTML body (`tldrai` → `tldr_ai`, `tldrnewsletter` → `tldr`), not the subject line — TLDR changed their subject format in 2026.
- **TLDR tracking URLs**: All links are wrapped in `tracking.tldrnewsletter.com/CL0/<encoded-url>/` — must be decoded before filtering or storing.
- **TLDR articles can route through `links.tldrnewsletter.com/<code>` shortlinks, not just the publisher's own domain.** This is NOT an internal/admin TLDR link — do not add it to `SKIP_PATTERNS`. It was wrongly skip-listed as of 2026-08, which silently dropped real articles (confirmed via real fixture: "Grok Bot is now included with more plans," "Verifiable Domains Will Eat The World," "OpenAI temporarily cuts GPT-5.6 Sol API pricing" were all missing from parser output because of this).
- **Each TLDR article/sponsor item is wrapped in a consistent `<td class="container" style="padding: 15px 15px;">` block.** The parser splits on this marker and only treats the *first* `<a>` in each block as the headline — sponsor copy often contains multiple inline CTA links (e.g. "Try Wispr Flow Free →", "Download Flow") that are not separate articles.
- **TLDR renames its own section headers periodically.** As of the 2026-08-24 issue, TLDR AI's "Research & Innovation" section is now titled "Deep Dives & Analysis," and "Engineering & Resources" is now "Engineering & Research" (Resources→Research). `SECTION_PATTERNS` in `parseTLDR.ts` matches both old and new wording per section. If a section silently stops being detected again, check for another wording change before assuming it's a structural (emoji/length-cap) bug.
- **Middleware**: Uses `proxy.ts` with `export function proxy()` — `middleware.ts` is deprecated in this Next.js version.

## After any parser change
Always: clear TLDR articles from the DB, then trigger a fresh sync to verify with real data.
```sql
DELETE FROM articles WHERE source IN ('tldr', 'tldr_ai');
```

## Article sort order
`newsletter_date DESC, source ASC (tldr before tldr_ai), order_index ASC, created_at DESC`

## Known issues (as of 2026-08-25)
Issues 1 and 2 below (sponsor leakage, section ordering) were root-caused and fixed against a real TLDR AI fixture (`tests/fixtures/tldr-ai-2026-08-24.html`) — see git history on `lib/parseTLDR.ts` for the fix and `tests/lib/parseTLDR.test.ts` for coverage. The actual root causes were different from the original hypotheses documented here previously:
- Sponsor leakage was a regex typo: `/\(sponsored?\)/i` only made the trailing "d" optional, so it required literal "(Sponsore)" or "(Sponsored)" and never matched the real-world "(Sponsor)" label. Fixed to `/\(sponsor(?:ed)?\)/i`.
- Section detection failures were TLDR renaming section headers (see architectural decisions above), not emoji prefixes or the 80-char length cap on section markers — that cap was never actually the problem in the one real case investigated.
- A separate, previously-undiagnosed bug (`links.tldrnewsletter.com` wrongly in `SKIP_PATTERNS`) was also found and fixed — this was likely the real cause of "Big Tech & Startups missing entirely" and other reports of real articles disappearing.
- Still needs a TLDR (main, non-AI) real fixture to confirm the "Big Tech & Startups" section and order_index-starts-at-1 symptom are actually resolved there too — the AI fixture doesn't have that section.

1. **Twitter integration** — OAuth flow is coded but credentials (`TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`) are empty in `.env.local`. Also requires ngrok or a deployed URL for the callback.

## Tech debt
- **Google OAuth client is in "Testing" publish status.** Refresh tokens for restricted/sensitive scopes (incl. `gmail.readonly`) issued under Testing status expire after 7 days regardless of use, forcing a full manual reconnect on that cadence — this is a Google policy tied to publish status, not an app bug. `getValidGmailAccessToken` (`lib/gmail.ts`) already auto-refreshes access tokens from the stored refresh token on every sync, so once this is fixed no further code change is needed. Fix: Google Cloud Console → OAuth consent screen ("Google Auth Platform" → Audience) → change Publishing status from Testing to **In production**. Single-user app, so no formal verification is required to do this — the "Google hasn't verified this app" warning will still show on any *new* consent grant (harmless, click Continue), but refresh tokens will stop expiring on the 7-day cycle.

## Agentic workflow instructions
- Drive autonomously toward the stated goal. Surface only blockers that require the user (OAuth clicks, external portal configuration, credential input).
- After fixing the parser: query the DB to verify article counts and section labels before reporting success.
- After any OAuth change: the user must test the connect flow in their real browser — you cannot do this headlessly.
- Prefer the debug endpoint (`/api/sync/gmail/debug`) for inspecting parser output without a full re-sync.
- Use the `?raw=1` param on the debug endpoint to inspect raw email HTML when diagnosing section detection issues.
