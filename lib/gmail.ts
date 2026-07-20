import { createClient } from "@/lib/supabase/server";

const TLDR_SENDER = "dan@tldrnewsletter.com";

interface GmailMessage {
  id: string;
  subject: string;
  html: string;
  text: string;
  date: string; // ISO date string, e.g. "2026-07-17"
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Google access token: ${res.status}`);
  }

  return res.json();
}

export async function getValidGmailAccessToken(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data: integration, error } = await supabase
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .single();

  if (error || !integration) {
    throw new Error("Gmail is not connected for this user");
  }

  const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
  const isExpired = expiresAt < Date.now() + 60 * 1000;

  if (!isExpired) {
    return integration.access_token as string;
  }

  if (!integration.refresh_token) {
    throw new Error("Gmail access token expired and no refresh token is stored");
  }

  const refreshed = await refreshAccessToken(integration.refresh_token);
  await supabase
    .from("user_integrations")
    .update({
      access_token: refreshed.access_token,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "gmail");

  return refreshed.access_token;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractBodyByMimeType(part: GmailPart, mimeType: string): string | null {
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = extractBodyByMimeType(child, mimeType);
    if (found) return found;
  }
  return null;
}

export async function fetchTldrMessages(
  accessToken: string,
  maxResults = 20,
): Promise<GmailMessage[]> {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", `from:${TLDR_SENDER}`);
  listUrl.searchParams.set("maxResults", String(maxResults));

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail list request failed: ${listRes.status}`);
  }
  const listData: { messages?: { id: string }[] } = await listRes.json();
  const ids = (listData.messages ?? []).map((m) => m.id);

  const messages: GmailMessage[] = [];
  for (const id of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) continue;

    const msgData: {
      internalDate?: string;
      payload?: GmailPart & { headers?: { name: string; value: string }[] };
    } = await msgRes.json();
    const payload = msgData.payload;
    if (!payload) continue;

    const subject = payload.headers?.find((h) => h.name === "Subject")?.value ?? "";
    const html = extractBodyByMimeType(payload, "text/html") ?? "";
    const text = extractBodyByMimeType(payload, "text/plain") ?? "";

    // internalDate is epoch milliseconds as a string
    const date = msgData.internalDate
      ? new Date(Number(msgData.internalDate)).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    messages.push({ id, subject, html, text, date });
  }

  return messages;
}
