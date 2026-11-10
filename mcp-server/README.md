# pkm-capture-mcp

MCP server over this app's saved items — lets Claude Desktop, Claude Code, or
any other MCP-compatible agent search, read, save, and tag what you've saved,
without needing to open the dashboard.

Read tools: `search_saved_items`, `get_saved_item`, `list_tags`.

Write tools: `capture_saved_item` (saves a link exactly like the app's own
quick-add bar — fetches title/image/description, extracts page text, applies
notes/tags/reading mode), `tag_saved_item`, `update_saved_item` (notes /
reading mode). There is deliberately no delete tool — removing a saved item
stays a human-in-the-UI action.

## Setup

1. Install dependencies:

   ```bash
   cd mcp-server
   npm install
   ```

2. Get your Supabase **secret key** (not the publishable key — Supabase
   renamed `service_role` to "Secret key" in their newer API key system,
   same privileges) from the
   [Supabase dashboard](https://supabase.com/dashboard/project/rcxppzrbdvhhkczphudg/settings/api-keys) →
   Project Settings → API Keys → Secret keys → `default` → reveal (eye icon)
   → copy. It looks like `sb_secret_...`. This key bypasses row-level
   security, so keep it out of git — it's only ever read from an environment
   variable here, never committed.

3. Create `mcp-server/.env` (or export these in your shell) with:

   ```
   SUPABASE_URL=https://rcxppzrbdvhhkczphudg.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<the secret key from step 2>
   ```

4. Add it to your MCP client's config. For Claude Desktop
   (`~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "pkm-capture": {
         "command": "npx",
         "args": ["tsx", "/Users/timothysweeny/Coding/PKM-FE-Capture-Layer/mcp-server/src/index.ts"],
         "env": {
           "SUPABASE_URL": "https://rcxppzrbdvhhkczphudg.supabase.co",
           "SUPABASE_SERVICE_ROLE_KEY": "<the secret key from step 2>"
         }
       }
     }
   }
   ```

   Restart Claude Desktop (or Claude Code) after editing the config.

## Notes

- **Two Google accounts have signed into this app** (`timsweeny17@gmail.com`
  with 1 stray article, `pkmcapturelayer@gmail.com` with the real saved
  data). `listUsers()` order isn't guaranteed, so this server resolves the
  account by whichever one actually has saved items — not by picking the
  first one. If that heuristic ever picks wrong, set `CAPTURE_USER_EMAIL` in
  `mcp-server/.env` (or the Claude Desktop config's `env` block) to pin it
  explicitly.
- Only `source = 'manual'` items (things saved through the app's own capture
  flow) are searchable/writable — TLDR/Twitter-synced rows are excluded,
  matching the main dashboard.
- Needs Node 18+. On Node <22, `@supabase/supabase-js` requires a global
  `WebSocket` just to construct the client (even though this server never
  uses realtime) — `src/index.ts` polyfills it via the `ws` package, so no
  Node upgrade is required.
