// Remote MCP server for Claude's mobile/web apps (and any other remote MCP
// client — the stdio-only mcp-server/ can't reach those at all, since they
// have no local filesystem/process access). Same tool definitions as the
// stdio server, shared via lib/mcpTools.ts — don't duplicate tool logic
// here, extend that file instead.
//
// Stateless Streamable HTTP per the MCP spec: a fresh McpServer + transport
// per request, no session persistence (matches how Vercel serverless
// functions work — no guarantee the same instance handles two requests).
//
// Auth: bearer token (MCP_API_TOKEN), same crypto.timingSafeEqual pattern as
// /api/capture's CAPTURE_API_TOKEN. Two of these tools write
// (capture_saved_item, tag_saved_item, update_saved_item), so this is not
// optional. No session cookie, so exempted from the redirect-to-/ check in
// lib/supabase/middleware.ts, same as /api/capture.
import { timingSafeEqual } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserId } from "@/lib/resolveUser";
import { registerPkmTools } from "@/lib/mcpTools";

export const maxDuration = 30;

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
}

function checkAuth(request: Request): boolean {
  const expected = process.env.MCP_API_TOKEN;
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  // TEMP diagnostic (2026-11-16): lengths only, never the actual values — see
  // CLAUDE.md note on this if it's still here later than expected.
  console.log(
    `[mcp] checkAuth: expectedSet=${!!expected} expectedLen=${expected?.length ?? 0} tokenLen=${token.length} match=${!!expected && !!token && expected.length === token.length ? tokensMatch(token, expected) : false}`,
  );
  if (!expected) return false;
  return !!token && tokensMatch(token, expected);
}

export async function POST(request: Request) {
  if (!checkAuth(request)) return unauthorized();

  try {
    const supabase = createAdminClient();
    const pinnedUserId = process.env.CAPTURE_USER_ID;
    const userId = pinnedUserId
      ? pinnedUserId
      : await Promise.race([
          resolveUserId(supabase),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("resolveUserId timed out after 10s")), 10000),
          ),
        ]);

    const server = new McpServer({ name: "pkm-capture-remote", version: "0.1.0" });
    registerPkmTools(server, supabase, userId, z);

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    console.log(`[mcp] failed: ${err instanceof Error ? err.message : err}`);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
