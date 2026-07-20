import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchTldrMessages, getValidGmailAccessToken } from "@/lib/gmail";
import { classifyNewsletter, parseTldrHtml } from "@/lib/parseTLDR";

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getValidGmailAccessToken(userData.user.id);
  const messages = await fetchTldrMessages(accessToken, 3);

  const debug = messages.map((msg) => {
    const source = classifyNewsletter(msg.subject, msg.html);
    const articles = source ? parseTldrHtml(msg.html) : [];
    return {
      subject: msg.subject,
      source,
      articleCount: articles.length,
      articles: articles.slice(0, 5).map((a) => ({
        headline: a.headline,
        link: a.link,
        summaryPreview: a.summary.slice(0, 100),
      })),
    };
  });

  return NextResponse.json(debug);
}
