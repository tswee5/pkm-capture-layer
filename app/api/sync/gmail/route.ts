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

  const messages = await fetchTldrMessages(accessToken);

  const { data: existing } = await supabase.from("articles").select("link");
  const existingLinks = new Set((existing ?? []).map((a) => a.link));

  let inserted = 0;
  let skipped = 0;

  for (const message of messages) {
    const source = classifyNewsletter(message.subject);
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
