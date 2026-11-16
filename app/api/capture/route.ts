// Token-authenticated capture endpoint for the iOS Shortcut (and any future
// non-browser client) — see docs/ios-shortcut.md.
//
// Two ways to authenticate/send data, both calling the same captureItem():
//   - POST, Authorization: Bearer <token>, JSON body {url, text, quote, note}
//   - GET, ?token=<token>&url=&text=&quote=&note= (query string)
// The GET form exists because a corporate MDM profile's traffic inspection
// was silently dropping the POST+Bearer-header form on one device (no error,
// no response, ever) while leaving plain GETs alone — a workaround for that,
// not a replacement. Prefer POST where it works.
//
// No session cookie either way, so this is exempted from the auth redirect
// in lib/supabase/middleware.ts and instead checks a static bearer token
// against CAPTURE_API_TOKEN.
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserId } from "@/lib/resolveUser";
import { captureItem } from "@/lib/capture";
import { parseTextFragment, resolveTextFragmentQuote } from "@/lib/textFragment";
import { fetchLinkMetadata } from "@/lib/linkMetadata";

// fetchLinkMetadata alone has an 8s timeout; add resolveUserId's extra round
// trip (two accounts exist on this project) and captureItem's DB calls and
// the default serverless timeout can be too tight, killing the connection
// mid-request instead of returning a clean error.
export const maxDuration = 30;

const URL_RE = /https?:\/\/[^\s]+/i;
const NO_LINK_ERROR =
  "No link found. Share from Safari's toolbar Share button, not the text-selection menu.";

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface CaptureInput {
  token: string | null;
  url?: string;
  text?: string;
  quote?: string;
  note?: string;
}

async function handleCapture(input: CaptureInput): Promise<NextResponse> {
  const startedAt = Date.now();

  const expectedToken = process.env.CAPTURE_API_TOKEN;
  if (!expectedToken) {
    console.log("[capture] rejected: CAPTURE_API_TOKEN not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 401 });
  }

  if (!input.token || !tokensMatch(input.token, expectedToken)) {
    console.log(`[capture] rejected: bad token (had one: ${!!input.token})`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const directUrl = input.url?.trim() || undefined;
  const text = input.text?.trim() || undefined;
  const note = input.note?.trim() || undefined;
  let quote = input.quote?.trim() || undefined;
  console.log(`[capture] input parsed: url=${!!directUrl} text=${!!text} quote=${!!quote} note=${!!note}`);

  let resolvedUrl = directUrl;
  if (!resolvedUrl && text) {
    const match = text.match(URL_RE);
    if (match) resolvedUrl = match[0];
  }

  if (!resolvedUrl) {
    return NextResponse.json({ error: NO_LINK_ERROR }, { status: 422 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resolvedUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("not http(s)");
  } catch {
    return NextResponse.json({ error: NO_LINK_ERROR }, { status: 422 });
  }

  if (!quote) {
    const fragment = parseTextFragment(parsedUrl.toString());
    if (fragment) {
      if (fragment.textEnd) {
        const meta = await fetchLinkMetadata(parsedUrl.toString());
        quote = resolveTextFragmentQuote(fragment, meta.extractedText);
      } else {
        quote = fragment.textStart;
      }
    }
  }

  try {
    const supabase = createAdminClient();
    // Pinning CAPTURE_USER_ID skips the Supabase Auth Admin listUsers() call
    // entirely — that call was hanging indefinitely (no error, no timeout)
    // specifically for requests from one device, even with a race() against
    // a 10s timeout that never fired. Not calling it at all sidesteps
    // whatever that was, rather than continuing to chase it.
    const pinnedUserId = process.env.CAPTURE_USER_ID;
    const targetUserId = pinnedUserId
      ? pinnedUserId
      : await Promise.race([
          resolveUserId(supabase),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("resolveUserId timed out after 10s")), 10000),
          ),
        ]);
    console.log(`[capture] resolved user after ${Date.now() - startedAt}ms, capturing ${parsedUrl.toString()}`);
    const result = await captureItem(supabase, targetUserId, {
      url: parsedUrl.toString(),
      note,
      quote,
    });
    console.log(`[capture] done after ${Date.now() - startedAt}ms, merged=${result.merged}`);

    return NextResponse.json({
      ok: true,
      merged: result.merged,
      quoteAdded: result.quoteAdded,
      noteAppended: result.noteAppended,
      title: result.item.headline,
    });
  } catch (err) {
    console.log(
      `[capture] failed after ${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : err}`,
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Capture failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  console.log(
    `[capture] POST received, content-length=${request.headers.get("content-length") ?? "unknown"}`,
  );
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  interface CaptureRequestBody {
    url?: string;
    text?: string;
    quote?: string;
    note?: string;
  }
  const body: CaptureRequestBody = await request.json().catch((err) => {
    console.log(`[capture] failed to parse JSON body: ${err instanceof Error ? err.message : err}`);
    return {};
  });

  return handleCapture({ token, ...body });
}

export async function GET(request: Request) {
  console.log("[capture] GET received");
  const { searchParams } = new URL(request.url);
  return handleCapture({
    token: searchParams.get("token"),
    url: searchParams.get("url") ?? undefined,
    text: searchParams.get("text") ?? undefined,
    quote: searchParams.get("quote") ?? undefined,
    note: searchParams.get("note") ?? undefined,
  });
}
