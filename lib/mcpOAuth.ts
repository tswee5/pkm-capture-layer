// Minimal OAuth 2.1 authorization-server helpers backing /api/mcp/oauth/*.
// See supabase/migrations/0007_mcp_oauth.sql for the schema this reads and
// writes (mcp_oauth_clients/codes/tokens), and CLAUDE.md for why this exists
// instead of just a static token: Claude's "Add custom connector" flow
// requires a real OAuth handshake to invoke tools in a chat, confirmed
// 2026-11-16 (a custom static-token header only satisfied its initial
// reachability check, not actual tool use).
//
// Deliberately a *minimal* single-user AS, not a general-purpose one: public
// clients only (PKCE, no client secret), one resource owner (whoever can log
// in with this app's existing email+password auth), no consent screen (if
// you can log in, you're approved), no token revocation endpoint, no
// proactive cleanup of expired rows (same "nothing auto-deletes" stance as
// the rest of this app — expired rows are just ignored at verification time).
import { randomBytes, createHash } from "crypto";
import type { SupabaseLike } from "./capture";

export const CODE_TTL_MS = 60_000; // 60s to complete the authorize->token exchange
export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 180; // 180 days

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export interface McpOAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

export async function registerClient(
  supabase: SupabaseLike,
  input: { client_name?: string; redirect_uris: string[] },
): Promise<McpOAuthClient> {
  const client_id = randomToken("mcpclient");
  const { data, error } = await supabase
    .from("mcp_oauth_clients")
    .insert({ client_id, client_name: input.client_name ?? null, redirect_uris: input.redirect_uris })
    .select("client_id, client_name, redirect_uris")
    .single();
  if (error) throw new Error(error.message);
  return data as McpOAuthClient;
}

export async function getClient(supabase: SupabaseLike, clientId: string): Promise<McpOAuthClient | null> {
  const { data, error } = await supabase
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as McpOAuthClient | null) ?? null;
}

export async function issueAuthorizationCode(
  supabase: SupabaseLike,
  input: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    resource?: string;
    scope?: string;
    user_id: string;
  },
): Promise<string> {
  const code = randomToken("mcpcode");
  const { error } = await supabase.from("mcp_oauth_codes").insert({
    code,
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method,
    resource: input.resource ?? null,
    scope: input.scope ?? null,
    user_id: input.user_id,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

interface OAuthCodeRow {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  scope: string | null;
  user_id: string;
  expires_at: string;
}

// Single-use: the caller must delete the code after a successful exchange.
export async function consumeAuthorizationCode(
  supabase: SupabaseLike,
  code: string,
): Promise<OAuthCodeRow | null> {
  const { data, error } = await supabase
    .from("mcp_oauth_codes")
    .select("code, client_id, redirect_uri, code_challenge, code_challenge_method, resource, scope, user_id, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  await supabase.from("mcp_oauth_codes").delete().eq("code", code);
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as OAuthCodeRow;
}

export async function issueTokenPair(
  supabase: SupabaseLike,
  input: { client_id: string; user_id: string; scope?: string | null },
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const access_token = randomToken("mcpat");
  const refresh_token = randomToken("mcprt");
  const now = Date.now();
  const { error } = await supabase.from("mcp_oauth_tokens").insert({
    access_token_hash: sha256Hex(access_token),
    refresh_token_hash: sha256Hex(refresh_token),
    client_id: input.client_id,
    user_id: input.user_id,
    scope: input.scope ?? null,
    access_expires_at: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return { access_token, refresh_token, expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export async function rotateRefreshToken(
  supabase: SupabaseLike,
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const refresh_token_hash = sha256Hex(refreshToken);
  const { data, error } = await supabase
    .from("mcp_oauth_tokens")
    .select("id, client_id, user_id, scope, refresh_expires_at, revoked")
    .eq("refresh_token_hash", refresh_token_hash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.revoked) return null;
  if (!data.refresh_expires_at || new Date(data.refresh_expires_at).getTime() < Date.now()) return null;

  // Revoke the old token row and issue a fresh pair (refresh-token rotation).
  await supabase.from("mcp_oauth_tokens").update({ revoked: true }).eq("id", data.id);
  return issueTokenPair(supabase, { client_id: data.client_id, user_id: data.user_id, scope: data.scope });
}

export interface VerifiedAccessToken {
  user_id: string;
  client_id: string;
  scope: string | null;
}

export async function verifyAccessToken(supabase: SupabaseLike, token: string): Promise<VerifiedAccessToken | null> {
  const access_token_hash = sha256Hex(token);
  const { data, error } = await supabase
    .from("mcp_oauth_tokens")
    .select("user_id, client_id, scope, access_expires_at, revoked")
    .eq("access_token_hash", access_token_hash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.revoked) return null;
  if (new Date(data.access_expires_at).getTime() < Date.now()) return null;
  return { user_id: data.user_id, client_id: data.client_id, scope: data.scope };
}
