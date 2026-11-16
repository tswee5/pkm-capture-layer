// Dynamic Client Registration (RFC 7591) — MCP clients (Claude included)
// register themselves automatically on first connecting to a remote MCP
// server that advertises an authorization server, rather than using a
// pre-shared client_id. Public clients only (no client_secret): PKCE in the
// authorize/token exchange is what actually secures this, consistent with
// OAuth 2.1's recommendation to avoid secrets in public/native clients.
import { createAdminClient } from "@/lib/supabase/admin";
import { registerClient } from "@/lib/mcpOAuth";

export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function badRequest(error: string, description: string): Response {
  return withCors(
    new Response(JSON.stringify({ error, error_description: description }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_client_metadata", "Request body must be JSON.");
  }

  const { redirect_uris, client_name } = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0 || !redirect_uris.every((u) => typeof u === "string")) {
    return badRequest("invalid_redirect_uri", "redirect_uris must be a non-empty array of strings.");
  }

  const supabase = createAdminClient();
  const client = await registerClient(supabase, {
    client_name: typeof client_name === "string" ? client_name : undefined,
    redirect_uris,
  });

  return withCors(
    new Response(
      JSON.stringify({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ),
  );
}

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}
