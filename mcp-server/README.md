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

2. Get your Supabase **service role key** (not the anon key) from the
   [Supabase dashboard](https://supabase.com/dashboard/project/rcxppzrbdvhhkczphudg/settings/api-keys) →
   Project Settings → API Keys → `service_role`. This key bypasses row-level
   security, so keep it out of git — it's only ever read from an environment
   variable here, never committed.

3. Create `mcp-server/.env` (or export these in your shell) with:

   ```
   SUPABASE_URL=https://rcxppzrbdvhhkczphudg.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<the service_role key from step 2>
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
           "SUPABASE_SERVICE_ROLE_KEY": "<the service_role key from step 2>"
         }
       }
     }
   }
   ```

   Restart Claude Desktop (or Claude Code) after editing the config.

## Notes

- This assumes a single-user Supabase project: at startup it looks up the
  one account in `auth.users` and scopes every query to that user. If this
  project ever becomes multi-user, this server needs real per-caller auth
  instead.
- Only `source = 'manual'` items (things saved through the app's own capture
  flow) are searchable — TLDR/Twitter-synced rows are excluded, matching the
  main dashboard.
