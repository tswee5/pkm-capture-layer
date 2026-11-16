// RFC 8414 Authorization Server Metadata — lets an MCP client discover the
// authorize/token/registration endpoints without them being hardcoded.
// Issuer is derived from the actual request origin rather than hardcoded,
// so this works identically on localhost during testing and in production.
export const maxDuration = 10;

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(
    JSON.stringify({
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
      token_endpoint: `${origin}/api/mcp/oauth/token`,
      registration_endpoint: `${origin}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
}
