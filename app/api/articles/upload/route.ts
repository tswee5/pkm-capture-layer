import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureItem } from "@/lib/capture";
import type { CaptureInput } from "@/types";

// Same headroom as /api/capture: fetchLinkMetadata's own 8s timeout plus DB
// round trips can exceed the default serverless timeout on a slow site.
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: CaptureInput = await request.json();
  if (!body.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const result = await captureItem(supabase, userData.user.id, {
      url: body.url,
      note: body.notes,
      quote: body.quote,
      depth_flag: body.depth_flag,
      tag_ids: body.tag_ids,
    });

    return NextResponse.json(
      {
        ...result.item,
        merged: result.merged,
        quoteAdded: result.quoteAdded,
        noteAppended: result.noteAppended,
      },
      { status: result.merged ? 200 : 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Capture failed" },
      { status: 500 },
    );
  }
}
