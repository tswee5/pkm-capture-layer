#!/usr/bin/env node
// MCP server over the Capture app's saved items, for use from Claude Desktop,
// Claude Code, or any other stdio-based MCP-compatible agent. Tool
// definitions live in ../../lib/mcpTools.ts, shared with the remote HTTP
// server (app/api/mcp/route.ts) for Claude's mobile/web apps and other
// remote clients — this file is just the stdio-specific bootstrap.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// The service role key bypasses RLS, so at startup we resolve the single
// account this app has (it's a personal, single-user tool) and scope every
// query to that user_id rather than trusting a caller-supplied id.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveUserId } from "../../lib/resolveUser.js";
import { registerPkmTools } from "../../lib/mcpTools.js";

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

async function main() {
  const userId = await resolveUserId(supabase);
  const server = new McpServer({ name: "pkm-capture", version: "0.3.0" });
  registerPkmTools(server, supabase, userId, z);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
