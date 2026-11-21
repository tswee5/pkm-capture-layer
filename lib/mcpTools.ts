// Shared MCP tool registrations for the PKM Capture Layer — used by both the
// local stdio server (mcp-server/src/index.ts, for Claude Code/Desktop) and
// the remote HTTP server (app/api/mcp/route.ts, for Claude's mobile/web apps
// and any other remote MCP client). One set of tool definitions, two
// transports — don't let these drift into separate implementations.
//
// No Next-only APIs or "@/" aliases — mcp-server imports this relatively
// (../../lib/mcpTools.js), same constraint as capture.ts and resolveUser.ts.
// The `server` parameter is typed structurally (McpServerLike), not the
// exact McpServer class, for the same reason SupabaseLike exists: this file
// is imported by two projects with separate @modelcontextprotocol/sdk
// installs, and TS's nominal check on classes with protected members fails
// across two different installed copies of the same package version.

import { captureItem } from "./capture";
import { decodeHtmlEntities } from "./htmlEntities";
import type { SupabaseLike } from "./capture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface McpServerLike {
  registerTool(name: string, config: any, handler: (...args: any[]) => any): void;
}

interface HighlightRow {
  id: string;
  text: string;
  created_at: string;
}

interface ItemRow {
  id: string;
  link: string | null;
  headline: string;
  personal_notes: string | null;
  og_description: string | null;
  extracted_text: string | null;
  domain: string | null;
  depth_flag: "surface" | "deep" | null;
  created_at: string;
  source: string;
  read_at: string | null;
  last_captured_at: string | null;
  tweet_author_handle: string | null;
  article_topics?: { topic: { id: string; name: string } }[];
  highlights?: HighlightRow[];
}

function summarize(row: ItemRow) {
  return {
    id: row.id,
    kind: row.source === "twitter" ? "x_bookmark" : "link",
    title: decodeHtmlEntities(row.headline),
    url: row.link,
    domain: row.domain,
    notes: row.personal_notes,
    description: row.og_description ? decodeHtmlEntities(row.og_description) : null,
    reading_mode: row.depth_flag === "deep" ? "deep_dive" : row.depth_flag === "surface" ? "reference" : null,
    tags: (row.article_topics ?? []).map((t) => t.topic.name),
    quotes: (row.highlights ?? []).map((h) => ({
      id: h.id,
      text: decodeHtmlEntities(h.text),
      created_at: h.created_at,
    })),
    ...(row.tweet_author_handle ? { tweet_author: `@${row.tweet_author_handle}` } : {}),
    read: !!row.read_at,
    read_at: row.read_at,
    saved_at: row.last_captured_at ?? row.created_at,
  };
}

function toDepthFlag(mode: "reference" | "deep_dive" | undefined | null): "surface" | "deep" | null {
  if (mode === "deep_dive") return "deep";
  if (mode === "reference") return "surface";
  return null;
}

const ITEM_SELECT =
  "id, link, headline, personal_notes, og_description, extracted_text, domain, depth_flag, created_at, source, read_at, last_captured_at, tweet_author_handle, article_topics(topic:topics(id,name)), highlights(id,text,created_at)";

async function resolveOrCreateTagIds(supabase: SupabaseLike, userId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    const { data: existing, error: findError } = await supabase
      .from("topics")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", name)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const { data: created, error: createError } = await supabase
      .from("topics")
      .insert({ user_id: userId, name })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    ids.push(created.id);
  }
  return ids;
}

async function fetchFullItem(supabase: SupabaseLike, userId: string, id: string): Promise<ItemRow> {
  const { data, error } = await supabase
    .from("articles")
    .select(ITEM_SELECT)
    .eq("user_id", userId)
    .eq("id", id)
    .order("created_at", { foreignTable: "highlights", ascending: true })
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as ItemRow;
}

// Pulled in lazily (not at module scope) so this file has no hard dependency
// on zod's exact export shape beyond what's passed in — both the stdio
// server and the HTTP route already depend on zod directly and pass their
// own `z` in, avoiding a second, possibly-mismatched zod install mattering
// here the way the Supabase/MCP SDK classes did.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerPkmTools(server: McpServerLike, supabase: SupabaseLike, userId: string, z: any): void {
  server.registerTool(
    "search_saved_items",
    {
      title: "Search saved items",
      description:
        "Search the user's saved items — links they added themselves plus their X (Twitter) bookmarks — by title, notes, description, extracted page/tweet text, and quotes. Optionally filter by tag name, reading mode, or read status. Newest first.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search query"),
        tag: z.string().optional().describe("Exact tag name to filter by"),
        reading_mode: z.enum(["reference", "deep_dive"]).optional(),
        read: z.boolean().optional().describe("true = only items marked read, false = only unread"),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, tag, reading_mode, read, limit }: { query?: string; tag?: string; reading_mode?: "reference" | "deep_dive"; read?: boolean; limit?: number }) => {
      let q = supabase
        .from("articles")
        .select(ITEM_SELECT)
        .eq("user_id", userId)
        .or("source.eq.manual,and(source.eq.twitter,tweet_type.eq.bookmark)")
        .order("last_captured_at", { ascending: false })
        .order("created_at", { foreignTable: "highlights", ascending: true })
        .limit(limit ?? 20);

      if (query) q = q.textSearch("search_vector", query, { type: "websearch" });
      if (reading_mode) q = q.eq("depth_flag", reading_mode === "deep_dive" ? "deep" : "surface");
      if (read === true) q = q.not("read_at", "is", null);
      if (read === false) q = q.is("read_at", null);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      let rows = (data ?? []) as unknown as ItemRow[];
      if (tag) {
        rows = rows.filter((r) =>
          (r.article_topics ?? []).some((t) => t.topic.name.toLowerCase() === tag.toLowerCase()),
        );
      }

      return { content: [{ type: "text", text: JSON.stringify(rows.map(summarize), null, 2) }] };
    },
  );

  server.registerTool(
    "get_saved_item",
    {
      title: "Get a saved item",
      description: "Fetch one saved item by id, including its full extracted page text and quotes.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }: { id: string }) => {
      const row = await fetchFullItem(supabase, userId, id);
      return { content: [{ type: "text", text: JSON.stringify(summarize(row), null, 2) }] };
    },
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description: "List every tag the user has created, with how many saved items use each one.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { data, error } = await supabase
        .from("topics")
        .select("name, article_topics(count)")
        .eq("user_id", userId)
        .order("name");
      if (error) throw new Error(error.message);
      const tags = (data ?? []).map((t: { name: string; article_topics?: { count: number }[] }) => ({
        name: t.name,
        item_count: t.article_topics?.[0]?.count ?? 0,
      }));
      return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
    },
  );

  server.registerTool(
    "capture_saved_item",
    {
      title: "Save a link",
      description:
        "Save a new link to the user's Capture app, exactly like pasting it into the app's own quick-add bar: fetches the page title/image/description and extracts readable text, then stores it with an optional note, quote, tags, and reading mode. Sharing a link that's already saved merges into the existing item instead of creating a duplicate.",
      inputSchema: {
        url: z.string().url(),
        notes: z.string().optional(),
        quote: z.string().optional().describe("A passage from the page to save as a quote"),
        tags: z.array(z.string()).optional().describe("Tag names; created if they don't already exist"),
        reading_mode: z.enum(["reference", "deep_dive"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({
      url,
      notes,
      quote,
      tags,
      reading_mode,
    }: {
      url: string;
      notes?: string;
      quote?: string;
      tags?: string[];
      reading_mode?: "reference" | "deep_dive";
    }) => {
      const result = await captureItem(supabase, userId, {
        url,
        note: notes,
        quote,
        tag_names: tags,
        depth_flag: toDepthFlag(reading_mode),
      });
      const row = await fetchFullItem(supabase, userId, result.item.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ ...summarize(row), merged: result.merged }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "tag_saved_item",
    {
      title: "Tag a saved item",
      description: "Add one or more tags to an existing saved item. Tags are created if they don't already exist.",
      inputSchema: { id: z.string(), tags: z.array(z.string()).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, tags }: { id: string; tags: string[] }) => {
      const tagIds = await resolveOrCreateTagIds(supabase, userId, tags);
      const { error } = await supabase
        .from("article_topics")
        .upsert(
          tagIds.map((topic_id) => ({ article_id: id, topic_id })),
          { onConflict: "article_id,topic_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
      const row = await fetchFullItem(supabase, userId, id);
      return { content: [{ type: "text", text: JSON.stringify(summarize(row), null, 2) }] };
    },
  );

  server.registerTool(
    "update_saved_item",
    {
      title: "Update a saved item's title, notes, reading mode, or read status",
      description: "Change the title, personal note, reading mode, and/or read status of an existing saved item. Omit a field to leave it unchanged.",
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).optional(),
        read: z.boolean().optional(),
        notes: z.string().optional(),
        reading_mode: z.enum(["reference", "deep_dive"]).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({
      id,
      title,
      read,
      notes,
      reading_mode,
    }: {
      id: string;
      title?: string;
      read?: boolean;
      notes?: string;
      reading_mode?: "reference" | "deep_dive" | null;
    }) => {
      const update: Record<string, unknown> = {};
      if (title !== undefined && title.trim()) update.headline = title.trim();
      if (read !== undefined) update.read_at = read ? new Date().toISOString() : null;
      if (notes !== undefined) update.personal_notes = notes;
      if (reading_mode !== undefined) update.depth_flag = toDepthFlag(reading_mode);
      if (Object.keys(update).length > 0) {
        const { error } = await supabase.from("articles").update(update).eq("id", id).eq("user_id", userId);
        if (error) throw new Error(error.message);
      }
      const row = await fetchFullItem(supabase, userId, id);
      return { content: [{ type: "text", text: JSON.stringify(summarize(row), null, 2) }] };
    },
  );
}
