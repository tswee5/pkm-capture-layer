// Authorization endpoint. GET renders a minimal login form (preserving all
// OAuth params as hidden fields); POST validates the submitted email+password
// against this app's existing Supabase auth (the same credentials used to
// log into the dashboard) and, on success, issues a short-lived
// authorization code and redirects back to the client's redirect_uri.
//
// No separate consent screen: this is a single-user personal app, so
// successfully authenticating IS the consent decision. No session cookie is
// set here either — the resource owner re-authenticates once per connector
// setup, which is an acceptable trade for not having to reconcile this
// route's auth with the dashboard's cookie-based session.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClient, issueAuthorizationCode } from "@/lib/mcpOAuth";

export const maxDuration = 30;

interface OAuthRequestParams {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  resource: string | null;
}

function parseParams(searchParams: URLSearchParams): OAuthRequestParams | { error: string } {
  const client_id = searchParams.get("client_id");
  const redirect_uri = searchParams.get("redirect_uri");
  const code_challenge = searchParams.get("code_challenge");
  const code_challenge_method = searchParams.get("code_challenge_method") ?? "S256";
  const response_type = searchParams.get("response_type");

  if (response_type !== "code") return { error: "Only response_type=code is supported." };
  if (!client_id) return { error: "Missing client_id." };
  if (!redirect_uri) return { error: "Missing redirect_uri." };
  if (!code_challenge) return { error: "Missing code_challenge (PKCE is required)." };
  if (code_challenge_method !== "S256") return { error: "Only code_challenge_method=S256 is supported." };

  return {
    client_id,
    redirect_uri,
    state: searchParams.get("state"),
    code_challenge,
    code_challenge_method,
    scope: searchParams.get("scope"),
    resource: searchParams.get("resource"),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderLoginPage(params: OAuthRequestParams, errorMessage?: string): string {
  const hidden = Object.entries({
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state ?? "",
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    scope: params.scope ?? "",
    resource: params.resource ?? "",
  })
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
    .join("\n      ");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — PKM Capture</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #eee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  form { background: #1a1a1a; padding: 2rem; border-radius: 12px; width: 320px; max-width: 90vw; }
  h1 { font-size: 1.1rem; margin: 0 0 1.25rem; }
  label { display: block; font-size: 0.85rem; margin-bottom: 0.25rem; color: #aaa; }
  input[type="email"], input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.6rem; margin-bottom: 1rem; border-radius: 6px; border: 1px solid #333; background: #0d0d0d; color: #eee; font-size: 16px; }
  button { width: 100%; padding: 0.7rem; border-radius: 6px; border: none; background: #4f7cff; color: white; font-size: 1rem; cursor: pointer; }
  .error { color: #ff6b6b; font-size: 0.85rem; margin-bottom: 1rem; }
  .subtitle { font-size: 0.8rem; color: #888; margin-bottom: 1.25rem; }
</style>
</head>
<body>
  <form method="POST">
      <h1>Sign in to PKM Capture</h1>
      <div class="subtitle">Authorizing a connector to access your saved items.</div>
      ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ""}
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
      ${hidden}
      <button type="submit">Sign in &amp; authorize</button>
  </form>
</body>
</html>`;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = parseParams(searchParams);
  if ("error" in parsed) {
    // TEMP diagnostic (2026-11-18): log the raw query string so we can see
    // exactly what the client sent — strip once this is resolved.
    console.log(`[mcp-oauth] authorize validation failed: ${parsed.error} | query=${searchParams.toString()}`);
    return htmlResponse(`<p>Invalid request: ${escapeHtml(parsed.error)}</p>`, 400);
  }

  const supabase = createAdminClient();
  const client = await getClient(supabase, parsed.client_id);
  if (!client) return htmlResponse("<p>Unknown client_id. This connector may need to be re-added.</p>", 400);
  if (!client.redirect_uris.includes(parsed.redirect_uri)) {
    return htmlResponse("<p>redirect_uri does not match this client's registration.</p>", 400);
  }

  return htmlResponse(renderLoginPage(parsed));
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = parseParams(new URLSearchParams(Array.from(form.entries()).map(([k, v]) => [k, String(v)])));
  if ("error" in params) return htmlResponse(`<p>Invalid request: ${escapeHtml(params.error)}</p>`, 400);

  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const admin = createAdminClient();
  const client = await getClient(admin, params.client_id);
  if (!client) return htmlResponse("<p>Unknown client_id. This connector may need to be re-added.</p>", 400);
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return htmlResponse("<p>redirect_uri does not match this client's registration.</p>", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return htmlResponse("<p>Server misconfigured.</p>", 500);

  const authClient = createSupabaseClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return htmlResponse(renderLoginPage(params, "Incorrect email or password."), 401);
  }

  const code = await issueAuthorizationCode(admin, {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    resource: params.resource ?? undefined,
    scope: params.scope ?? undefined,
    user_id: data.user.id,
  });

  const redirectUrl = new URL(params.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (params.state) redirectUrl.searchParams.set("state", params.state);

  return Response.redirect(redirectUrl.toString(), 302);
}
