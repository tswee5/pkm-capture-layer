@AGENTS.md

# PKM Capture Layer — Standing Orders

## What this app is
A personal save-for-later / inventory tool, Sublime.app-inspired. The primary (and as of 2026-11-09, only UI-surfaced) journey is: paste a link, optionally add a note, assign tags, done. There is no triage gate — nothing added is treated as noise, so there's no keep/purge decision to make. The one classification that survived is reading mode (DB column `depth_flag`, values `surface`/`deep`) relabeled in the UI as **Reference** vs **Deep Dive**.

The dashboard (`app/dashboard/DashboardClient.tsx`) is a single unified feed, not tabs: a persistent `QuickCapture` bar at the top (URL + inline note/tag/reading-mode entry), a `FilterBar` (search + reading-mode chips + tag chips), and a list of `ItemCard`s. `TagPicker` is the shared tag-assign dropdown used by both. The feed only ever queries `source = 'manual'` — see "Gmail/Twitter ingestion is now dormant" below.

### Gmail/Twitter ingestion is now dormant, not deleted
Per explicit user decision on 2026-11-09: the feed should only ever show links the user adds themselves, not auto-pulled TLDR/Twitter content. The Gmail OAuth + TLDR parser (`lib/gmail.ts`, `lib/parseTLDR.ts`, `/api/auth/gmail*`, `/api/sync/gmail*`) and Twitter OAuth + sync (`lib/twitter.ts`, `/api/auth/twitter*`, `/api/sync/twitter`) are all still fully intact and functional — they are just no longer wired into any UI (no connect/sync buttons exist anymore in `DashboardClient`). Historical TLDR/Twitter rows already in `articles` were **not deleted**; they're simply excluded by the `source = 'manual'` filter the dashboard always applies. If this ever needs to come back, the backend needs no changes — only new UI wiring.

**Do not reintroduce the old auto-purge/auto-delete logic.** `/api/articles` (GET) used to silently mark pending articles as `purge` after 2 weeks and hard-delete `purge`d rows after 24 hours — that logic has been removed entirely. The user explicitly does not want anything they save ever auto-deleted. If a future change needs cleanup behavior, it must be an explicit user-triggered action, never automatic.

### Link metadata + search
Manual captures go through `lib/linkMetadata.ts` (best-effort og:title/description/image fetch + a crude HTML-strip "extracted text", not a real readability algorithm) at save time (`/api/articles/upload`, despite the legacy path name, is the capture endpoint). Migration `0005_streamline_capture_fields.sql` added `og_image_url`, `og_description`, `domain`, `extracted_text`, and a generated `search_vector tsvector` + GIN index; `/api/articles?q=` uses `textSearch` against it.

### MCP server for AI-agent access
`mcp-server/` is a standalone (not bundled into the Next.js app) MCP server over stdio, for Claude Desktop/Code or any other MCP client. It needs its own `SUPABASE_SERVICE_ROLE_KEY` — **this is currently blank in `.env.local`** (the main app never needed it, since it only ever uses the anon key + RLS). The user needs to paste the real `service_role` key from the Supabase dashboard into `mcp-server/.env` (see `mcp-server/README.md`) before the MCP server can run.

Read tools: `search_saved_items`, `get_saved_item`, `list_tags`. Write tools (added 2026-11-10, on explicit user request — v1 shipped read-only deliberately): `capture_saved_item` (reuses `lib/linkMetadata.ts` via a relative import — `../../lib/linkMetadata.js` from `mcp-server/src/index.ts` — so capture behavior matches the web app exactly, not a reimplementation), `tag_saved_item`, `update_saved_item`. No delete tool exists on purpose — that stays a human-in-the-UI action.

**Two Google accounts have actually signed into this app**, discovered 2026-11-10 while wiring up the MCP server: `timsweeny17@gmail.com` (1 stray article from initial testing, effectively abandoned) and `pkmcapturelayer@gmail.com` (the account with all the real saved data — this is the one shown signed in throughout this file's examples). `supabase.auth.admin.listUsers()` does not guarantee order, so `resolveUserId()` in `mcp-server/src/index.ts` does NOT just take `users[0]` — it resolves to whichever account actually has saved articles (or `CAPTURE_USER_EMAIL` if set). Don't reintroduce a naive `users[0]` pick here or anywhere else that touches `auth.users` in this project.

`@supabase/supabase-js` (current version) requires a global `WebSocket` just to construct the client, even for code paths that never touch realtime — this throws on Node <22. `mcp-server/src/index.ts` polyfills `globalThis.WebSocket` via the `ws` package before calling `createClient`. If a similar error ever shows up elsewhere (`Node.js detected but native WebSocket not found`), this is why, and the same fix applies.

## Deploying — critical: merging to a feature branch does NOT deploy
Vercel Production is aliased to whatever is newest on **`main`**, not to any feature branch. Pushing commits to a working branch (e.g. one set up for a Claude Code session) only creates a *preview* deployment — production keeps serving the old `main` build until you actually merge into `main` and push that. This caused a real incident (2026-08-25): a full parser-fix session pushed ~10 commits to a feature branch, and the user kept testing against unfixed production code for over an hour before this was caught. If you're verifying a fix is live, don't assume — use the Vercel MCP (`list_deployments`/`get_deployment`) to confirm the deployment aliased to `pkm-capture-layer.vercel.app` actually matches your latest commit SHA before telling the user to test.

## Any new subdirectory with its own package.json must be excluded from the root tsconfig
Hit on 2026-11-09 shipping `mcp-server/`: root `tsconfig.json`'s `include` is `**/*.ts`, so Next's build-time type-check sweeps up *any* `.ts` file anywhere in the repo, including a standalone sub-project with its own dependencies. The build passed locally only because `mcp-server/node_modules` happened to exist from manually running `npm install` there; it's correctly gitignored, so Vercel's clean checkout never has it, and the production build failed with `Cannot find module '@modelcontextprotocol/sdk/...'`. Before trusting a local `npm run build` as proof a new subdirectory-with-its-own-package.json won't break deployment, either add it to root `tsconfig.json`'s `exclude`, or test by temporarily moving that subdirectory's `node_modules` aside and rebuilding.

## Start-of-session sync check — critical: local checkouts go stale silently
`git fetch` updates the remote-tracking ref (`origin/main`) but never moves your local branch. If another session (a different Claude Code window, a worktree, a cloud session) pushed directly to `origin/main` since this checkout was last synced, local `main` just sits there unaware — and any new work gets built on a stale base with no error or warning. This caused a real incident (2026-08-29): a session's local `main` was ~20 commits behind `origin/main` — a full Twitter tweet-metadata schema, tabbed feed UI, TLDR parser fixes, and mobile/OAuth fixes had already been built and deployed by a separate session — and new work was built on the old base, including a second Supabase migration with a schema that duplicated/conflicted with what was already live, before the divergence was caught.

**At the start of any session that will touch code or push commits:**
1. `git fetch origin`, then compare `git log --oneline -5 main` against `git log --oneline -5 origin/main`. If they've diverged, stop and reconcile before writing any code.
2. If local `main` is behind with no local-only commits of value, just sync up: `git reset --hard origin/main`.
3. If local `main` has uncommitted or unpushed work *and* `origin/main` has also moved, don't blindly reset — save local work first (`git checkout -b <descriptive-wip-branch>`, commit there), *then* reset `main` to `origin/main`, then decide what (if anything) from the side branch is still needed on top of the real base.

**At the end of any session:** push finished work to `origin/main` promptly rather than leaving it committed-but-local or sitting on an unpushed feature branch. An unpushed local commit is invisible to every other session and to Vercel — that's the same failure mode as above, just in reverse.

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
- The Supabase MCP is also configured and can be used for queries — confirmed working as of 2026-08-25 (project shows up as "PKM Content Capture Layer"). Prefer it over the curl/PAT flow when available: `apply_migration` for DDL, `execute_sql` for one-off queries/data fixes, `list_tables` to check current schema before writing migrations.
- The Vercel MCP is similarly available for this project (`pkm-capture-layer`, team `tim-sweenys-projects`) — use it to check deployment state/logs instead of asking the user to screenshot the Vercel dashboard.

### `articles` table columns beyond the original schema
- `tweet_type` (`'like' | 'bookmark'`, nullable) — only set for `source = 'twitter'` rows. Required because likes and bookmarks are now separate UI tabs; dedup on sync is scoped to `(link, tweet_type)` so the same tweet can legitimately appear in both.
- `tweet_author_name`, `tweet_author_handle`, `tweet_author_avatar_url`, `tweet_posted_at` — populated from the Twitter API's `author_id`/`expansions=author_id` response, used by `TweetCard` for the tweet-style rendering.
- **150 pre-2026-08-25 Twitter rows were backfilled to `tweet_type = 'like'`** since the old sync code merged likes+bookmarks before storage with no discriminator — there was no way to recover which were actually bookmarks. If the user reports a specific tweet showing under the wrong tab, that's why; it's a one-time, non-reversible assumption, not a bug in current sync logic.

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

Twitter integration is fully working as of 2026-08-25 (connect, sync, likes/bookmarks tabs) — the credentials-empty issue from earlier is resolved; the token exchange also needed a `Basic` auth header (confidential client) that the original code was missing.

## Sync windowing (both Gmail and Twitter)
- **Gmail**: `/api/sync/gmail` derives its "since" cutoff from `MAX(newsletter_date)` in the `articles` table, not from `user_integrations.last_synced_at`. This is deliberate — tying it to `last_synced_at` meant clearing `articles` for parser verification (the routine workflow above) without also resetting that timestamp caused the next sync to fetch almost nothing. Deriving from the data itself means "clear the table" always means "next sync refetches everything," with no second field to remember.
- **Twitter**: likes/bookmarks are fetched already in most-recent-first order from the API; each sub-tab sorts by `created_at DESC` (DB insertion order), which is sufficient to preserve "order liked/bookmarked" now that likes and bookmarks insert into separate lists instead of being interleaved. First sync caps at 100 likes / 50 bookmarks to avoid a huge backfill; later syncs pull a smaller batch (25 each) and rely on `(link, tweet_type)` dedup.

## Mobile
- `app/layout.tsx` previously had **no viewport meta export at all** — the app rendered at desktop width on phones and scaled down, which no amount of responsive CSS could fix on its own. Fixed via `export const viewport: Viewport = { width: "device-width", initialScale: 1, ... }`. If mobile layout issues resurface, verify this wasn't reverted before chasing CSS.
- Form inputs/textareas need `text-base` (16px) minimum — anything smaller triggers Safari's auto-zoom-on-focus on iOS.
- `TopicSidebar` is a slide-over drawer below the `md` breakpoint (hamburger toggle in the header), not a persistent column.

## Tech debt
- **Google OAuth client is in "Testing" publish status.** Refresh tokens for restricted/sensitive scopes (incl. `gmail.readonly`) issued under Testing status expire after 7 days regardless of use, forcing a full manual reconnect on that cadence — this is a Google policy tied to publish status, not an app bug. `getValidGmailAccessToken` (`lib/gmail.ts`) already auto-refreshes access tokens from the stored refresh token on every sync, so once this is fixed no further code change is needed. Fix: Google Cloud Console → OAuth consent screen ("Google Auth Platform" → Audience) → change Publishing status from Testing to **In production**. Single-user app, so no formal verification is required to do this — the "Google hasn't verified this app" warning will still show on any *new* consent grant (harmless, click Continue), but refresh tokens will stop expiring on the 7-day cycle.

## Agentic workflow instructions
- Drive autonomously toward the stated goal. Surface only blockers that require the user (OAuth clicks, external portal configuration, credential input).
- After fixing the parser: query the DB to verify article counts and section labels before reporting success.
- After any OAuth change: the user must test the connect flow in their real browser — you cannot do this headlessly.
- Prefer the debug endpoint (`/api/sync/gmail/debug`) for inspecting parser output without a full re-sync.
- Use the `?raw=1` param on the debug endpoint to inspect raw email HTML when diagnosing section detection issues.
