// RFC 9728 Protected Resource Metadata. Points at this project's own
// authorization server (same origin acts as both AS and RS — fine for a
// single-user personal deployment). Catch-all route so this answers both
// the bare /.well-known/oauth-protected-resource and the resource-path-
// suffixed /.well-known/oauth-protected-resource/api/mcp that different MCP
// client implementations probe (the suffixed form is the convention the
// MCP SDK's own getOAuthProtectedResourceMetadataUrl() helper produces) —
// there's only one resource here, so both return the same metadata.
export const maxDuration = 10;

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(
    JSON.stringify({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
}
