// Token endpoint: exchanges an authorization code (+ PKCE verifier) or a
// refresh token for a fresh access/refresh token pair. See lib/mcpOAuth.ts
// for the actual code/token storage and verification logic.
import { base64UrlSha256 } from "@/lib/mcpOAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeAuthorizationCode, issueTokenPair, rotateRefreshToken } from "@/lib/mcpOAuth";

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

function oauthError(error: string, description: string, status = 400): Response {
  return withCors(
    new Response(JSON.stringify({ error, error_description: description }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function tokenJson(pair: { access_token: string; refresh_token: string; expires_in: number }, scope?: string | null): Response {
  return withCors(
    new Response(
      JSON.stringify({
        access_token: pair.access_token,
        token_type: "Bearer",
        expires_in: pair.expires_in,
        refresh_token: pair.refresh_token,
        ...(scope ? { scope } : {}),
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    ),
  );
}

async function parseBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v)]));
  }
  const form = await request.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
}

export async function POST(request: Request) {
  const body = await parseBody(request);
  const grant_type = body.grant_type;
  const supabase = createAdminClient();

  if (grant_type === "authorization_code") {
    const { code, redirect_uri, client_id, code_verifier } = body;
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return oauthError("invalid_request", "code, redirect_uri, client_id, and code_verifier are all required.");
    }

    const stored = await consumeAuthorizationCode(supabase, code);
    if (!stored) return oauthError("invalid_grant", "Authorization code is invalid, expired, or already used.");
    if (stored.client_id !== client_id) return oauthError("invalid_grant", "client_id does not match the authorization code.");
    if (stored.redirect_uri !== redirect_uri) return oauthError("invalid_grant", "redirect_uri does not match the authorization code.");
    if (base64UrlSha256(code_verifier) !== stored.code_challenge) {
      return oauthError("invalid_grant", "PKCE verification failed.");
    }

    const pair = await issueTokenPair(supabase, { client_id, user_id: stored.user_id, scope: stored.scope });
    return tokenJson(pair, stored.scope);
  }

  if (grant_type === "refresh_token") {
    const { refresh_token } = body;
    if (!refresh_token) return oauthError("invalid_request", "refresh_token is required.");
    const pair = await rotateRefreshToken(supabase, refresh_token);
    if (!pair) return oauthError("invalid_grant", "Refresh token is invalid, expired, or revoked.");
    return tokenJson(pair);
  }

  return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}
