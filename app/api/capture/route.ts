// Token-authenticated capture endpoint for the iOS Shortcut (and any future
// non-browser client) — see docs/ios-shortcut.md. No session cookie, so
// this is exempted from the auth redirect in lib/supabase/middleware.ts and
// instead checks a static bearer token against CAPTURE_API_TOKEN.
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserId } from "@/lib/resolveUser";
import { captureItem } from "@/lib/capture";
import { parseTextFragment, resolveTextFragmentQuote } from "@/lib/textFragment";
import { fetchLinkMetadata } from "@/lib/linkMetadata";

const URL_RE = /https?:\/\/[^\s]+/i;
const NO_LINK_ERROR =
  "No link found. Share from Safari's toolbar Share button, not the text-selection menu.";

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface CaptureRequestBody {
  url?: string;
  text?: string;
  quote?: string;
  note?: string;
}

export async function POST(request: Request) {
  const expectedToken = process.env.CAPTURE_API_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: "Not configured" }, { status: 401 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: CaptureRequestBody = await request.json().catch(() => ({}));
  const directUrl = body.url?.trim() || undefined;
  const text = body.text?.trim() || undefined;
  const note = body.note?.trim() || undefined;
  let quote = body.quote?.trim() || undefined;

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
    const targetUserId = await resolveUserId(supabase);
    const result = await captureItem(supabase, targetUserId, {
      url: parsedUrl.toString(),
      note,
      quote,
    });

    return NextResponse.json({
      ok: true,
      merged: result.merged,
      quoteAdded: result.quoteAdded,
      noteAppended: result.noteAppended,
      title: result.item.headline,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Capture failed" },
      { status: 500 },
    );
  }
}
