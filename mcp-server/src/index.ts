#!/usr/bin/env node
// Read-only MCP server over the Capture app's saved items, for use from
// Claude Desktop, Claude Code, or any other MCP-compatible agent.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// The service role key bypasses RLS, so at startup we resolve the single
// account this app has (it's a personal, single-user tool) and scope every
// query to that user_id rather than trusting a caller-supplied id.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function resolveUserId(): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Could not list users: ${error.message}`);
  if (!data.users[0]) throw new Error("No user found in this Supabase project.");
  return data.users[0].id;
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

async function main() {
  const userId = await resolveUserId();

  const server = new McpServer({ name: "pkm-capture", version: "0.1.0" });

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
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, link, headline, personal_notes, og_description, extracted_text, domain, depth_flag, created_at, article_topics(topic:topics(id,name))")
        .eq("user_id", userId)
        .eq("id", id)
        .single();

      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(summarize(data as unknown as ItemRow), null, 2) }] };
    },
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description: "List every tag the user has created, with how many saved items use each one.",
      inputSchema: {},
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
