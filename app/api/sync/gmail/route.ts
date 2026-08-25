import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchTldrMessages, getValidGmailAccessToken } from "@/lib/gmail";
import { classifyNewsletter, parseTldrHtml } from "@/lib/parseTLDR";

export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidGmailAccessToken(userData.user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gmail not connected" },
      { status: 400 },
    );
  }

  const { data: integration } = await supabase
    .from("user_integrations")
    .select("last_synced_at")
    .eq("user_id", userData.user.id)
    .eq("provider", "gmail")
    .single();

  // Only fetch messages received since the last sync — falls back to the full
  // default window on first sync, when last_synced_at is null.
  const sinceEpochSeconds = integration?.last_synced_at
    ? Math.floor(new Date(integration.last_synced_at).getTime() / 1000)
    : undefined;

  let messages;
  try {
    messages = await fetchTldrMessages(accessToken, 50, sinceEpochSeconds);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Gmail messages" },
      { status: 502 },
    );
  }

  const { data: existing } = await supabase.from("articles").select("link");
  const existingLinks = new Set((existing ?? []).map((a) => a.link));

  let inserted = 0;
  let skipped = 0;

  for (const message of messages) {
    const source = classifyNewsletter(message.subject, message.html);
    if (!source) continue;

    const articles = parseTldrHtml(message.html);
    for (const article of articles) {
      if (existingLinks.has(article.link)) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from("articles").insert({
        user_id: userData.user.id,
        source,
        link: article.link,
        headline: article.headline,
        summary: article.summary,
        status: "pending",
        newsletter_date: message.date,
        order_index: article.orderIndex,
        section_label: article.sectionLabel,
      });

      if (error) {
        skipped++;
      } else {
        existingLinks.add(article.link);
        inserted++;
      }
    }
  }

  await supabase
    .from("user_integrations")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userData.user.id)
    .eq("provider", "gmail");

  return NextResponse.json({ inserted, skipped });
}
