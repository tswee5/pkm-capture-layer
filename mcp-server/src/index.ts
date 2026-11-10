#!/usr/bin/env node
// MCP server over the Capture app's saved items, for use from Claude Desktop,
// Claude Code, or any other MCP-compatible agent. Read tools (search/get/list
// tags) plus write tools (capture/tag/update) — no delete, deliberately: that
// stays a human-in-the-UI action for now.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// The service role key bypasses RLS, so at startup we resolve the single
// account this app has (it's a personal, single-user tool) and scope every
// query to that user_id rather than trusting a caller-supplied id.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchLinkMetadata } from "../../lib/linkMetadata.js";

// supabase-js constructs a realtime client (which this server never uses) at
// createClient() time, and that construction hard-requires a global
// WebSocket. Node only ships one natively from v22 — polyfill it so this
// still works on Node 20/21 rather than forcing a Node upgrade.
if (typeof globalThis.WebSocket === "undefined") {
  const { WebSocket } = await import("ws");
  // @ts-expect-error -- ws's WebSocket is a close-enough shape for supabase-js's needs
  globalThis.WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Despite the "single-user" assumption, this project has in practice had two
// Google accounts sign into it at different times (only one of which has any
// real saved data) — listUsers() order is not guaranteed, so picking
// data.users[0] risks silently operating on the wrong, empty account. Resolve
// by explicit email (CAPTURE_USER_EMAIL) if set, else by whichever account
// actually has saved items.
async function resolveUserId(): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Could not list users: ${error.message}`);
  if (data.users.length === 0) throw new Error("No user found in this Supabase project.");

  const pinnedEmail = process.env.CAPTURE_USER_EMAIL?.toLowerCase();
  if (pinnedEmail) {
    const match = data.users.find((u) => u.email?.toLowerCase() === pinnedEmail);
    if (!match) throw new Error(`No user found with email ${process.env.CAPTURE_USER_EMAIL}`);
    return match.id;
  }

  if (data.users.length === 1) return data.users[0].id;

  const withCounts = await Promise.all(
    data.users.map(async (u) => {
      const { count } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", u.id);
      return { id: u.id, email: u.email, count: count ?? 0 };
    }),
  );
  withCounts.sort((a, b) => b.count - a.count);
  console.error(
    `Multiple Supabase accounts found; using ${withCounts[0].email} (${withCounts[0].count} saved items). Set CAPTURE_USER_EMAIL in mcp-server/.env to pin a different account explicitly.`,
  );
  return withCounts[0].id;
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
  article_topics?: { topic: { id: string; name: string } }[];
}

function summarize(row: ItemRow) {
  return {
    id: row.id,
    title: row.headline,
    url: row.link,
    domain: row.domain,
    notes: row.personal_notes,
    description: row.og_description,
    reading_mode: row.depth_flag === "deep" ? "deep_dive" : row.depth_flag === "surface" ? "reference" : null,
    tags: (row.article_topics ?? []).map((t) => t.topic.name),
    saved_at: row.created_at,
  };
}

function toDepthFlag(mode: "reference" | "deep_dive" | undefined | null): "surface" | "deep" | null {
  if (mode === "deep_dive") return "deep";
  if (mode === "reference") return "surface";
  return null;
}

async function main() {
  const userId = await resolveUserId();

  // Tags are matched case-insensitively against existing ones and created on
  // first use, mirroring the app's own TagPicker ("+ New tag") behavior.
  async function resolveOrCreateTagIds(names: string[]): Promise<string[]> {
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

  async function fetchFullItem(id: string): Promise<ItemRow> {
    const { data, error } = await supabase
      .from("articles")
      .select("id, link, headline, personal_notes, og_description, extracted_text, domain, depth_flag, created_at, article_topics(topic:topics(id,name))")
      .eq("user_id", userId)
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ItemRow;
  }

  const server = new McpServer({ name: "pkm-capture", version: "0.2.0" });

  server.registerTool(
    "search_saved_items",
    {
      title: "Search saved items",
      description:
        "Search the user's manually saved links (title, notes, description, and extracted page text). Optionally filter by tag name or reading mode.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search query"),
        tag: z.string().optional().describe("Exact tag name to filter by"),
        reading_mode: z.enum(["reference", "deep_dive"]).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, tag, reading_mode, limit }) => {
      let q = supabase
        .from("articles")
        .select("id, link, headline, personal_notes, og_description, extracted_text, domain, depth_flag, created_at, article_topics(topic:topics(id,name))")
        .eq("user_id", userId)
        .eq("source", "manual")
        .order("created_at", { ascending: false })
        .limit(limit ?? 20);

      if (query) q = q.textSearch("search_vector", query, { type: "websearch" });
      if (reading_mode) q = q.eq("depth_flag", reading_mode === "deep_dive" ? "deep" : "surface");

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      let rows = (data ?? []) as unknown as ItemRow[];
      if (tag) {
        rows = rows.filter((r) =>
          (r.article_topics ?? []).some((t) => t.topic.name.toLowerCase() === tag.toLowerCase()),
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(rows.map(summarize), null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_saved_item",
    {
      title: "Get a saved item",
      description: "Fetch one saved item by id, including its full extracted page text.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const row = await fetchFullItem(id);
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
      const tags = (data ?? []).map((t) => ({
        name: t.name,
        item_count: (t as unknown as { article_topics?: { count: number }[] }).article_topics?.[0]?.count ?? 0,
      }));
      return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
    },
  );

  server.registerTool(
    "capture_saved_item",
    {
      title: "Save a link",
      description:
        "Save a new link to the user's Capture app, exactly like pasting it into the app's own quick-add bar: fetches the page title/image/description and extracts readable text, then stores it with an optional note, tags, and reading mode.",
      inputSchema: {
        url: z.string().url(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Tag names; created if they don't already exist"),
        reading_mode: z.enum(["reference", "deep_dive"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ url, notes, tags, reading_mode }) => {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("url must be http(s)");
      }

      const meta = await fetchLinkMetadata(parsed.toString());
      const { data: inserted, error: insertError } = await supabase
        .from("articles")
        .insert({
          user_id: userId,
          source: "manual",
          link: parsed.toString(),
          headline: meta.title || parsed.hostname,
          og_image_url: meta.imageUrl,
          og_description: meta.description,
          domain: meta.domain,
          extracted_text: meta.extractedText,
          personal_notes: notes ?? null,
          depth_flag: toDepthFlag(reading_mode),
        })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);

      if (tags && tags.length > 0) {
        const tagIds = await resolveOrCreateTagIds(tags);
        const { error: tagError } = await supabase
          .from("article_topics")
          .insert(tagIds.map((topic_id) => ({ article_id: inserted.id, topic_id })));
        if (tagError) throw new Error(tagError.message);
      }

      const row = await fetchFullItem(inserted.id);
      return { content: [{ type: "text", text: JSON.stringify(summarize(row), null, 2) }] };
    },
  );

  server.registerTool(
    "tag_saved_item",
    {
      title: "Tag a saved item",
      description: "Add one or more tags to an existing saved item. Tags are created if they don't already exist.",
      inputSchema: {
        id: z.string(),
        tags: z.array(z.string()).min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, tags }) => {
      const tagIds = await resolveOrCreateTagIds(tags);
      const { error } = await supabase
        .from("article_topics")
        .upsert(
          tagIds.map((topic_id) => ({ article_id: id, topic_id })),
          { onConflict: "article_id,topic_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);

      const row = await fetchFullItem(id);
      return { content: [{ type: "text", text: JSON.stringify(summarize(row), null, 2) }] };
    },
  );

  server.registerTool(
    "update_saved_item",
    {
      title: "Update a saved item's notes or reading mode",
      description: "Change the personal note and/or reading mode on an existing saved item. Omit a field to leave it unchanged.",
      inputSchema: {
        id: z.string(),
        notes: z.string().optional(),
        reading_mode: z.enum(["reference", "deep_dive"]).nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, notes, reading_mode }) => {
      const update: Record<string, unknown> = {};
      if (notes !== undefined) update.personal_notes = notes;
      if (reading_mode !== undefined) update.depth_flag = toDepthFlag(reading_mode);

      if (Object.keys(update).length > 0) {
        const { error } = await supabase.from("articles").update(update).eq("id", id).eq("user_id", userId);
        if (error) throw new Error(error.message);
      }

      const row = await fetchFullItem(id);
      return { content: [{ type: "text", text: JSON.stringify(summarize(row), null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
