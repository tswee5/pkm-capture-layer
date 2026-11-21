import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncTwitter } from "@/lib/twitter";

export const maxDuration = 30;

// Called by the dashboard on every load (throttled) and by the manual
// "Sync" button (?force=1). The capture path calls syncTwitterQuietly()
// directly via lib/capture.ts instead of going through this route.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const result = await syncTwitter(supabase, userData.user.id, {
      minIntervalMs: force ? undefined : 60 * 1000,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[twitter] sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Twitter sync failed" },
      { status: 502 },
    );
  }
}
